// Zero-dependency static server for previewing the visualizer:
//   node src/ui/server.mjs [port]      (or PORT=8080 node src/ui/server.mjs)
// Serves the package root (the UI imports ../core and fetches sample
// snapshots from examples/ and fixtures/) and redirects / to the UI.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_PATH = '/src/ui/index.html';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.log': 'text/plain; charset=utf-8',
};

/** Resolve a URL path inside `root`, or null if it escapes it. */
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':') || decoded.split('/').some(part => part.startsWith('.'))) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

export function createStaticServer({ root = ROOT, handler = null } = {}) {
  const realRoot=fs.realpathSync(root);
  return http.createServer((req, res) => {
    const requestURL=new URL(req.url,'http://localhost');
    if(handler?.(req,res,requestURL))return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(302, { Location: UI_PATH + url.search }).end(); return; }
    let file = resolveStaticPath(root, url.pathname);
    if (!file) { res.writeHead(403).end('Forbidden'); return; }
    fs.stat(file, (error, stat) => {
      if (!error && stat.isDirectory()) { file = path.join(file, 'index.html'); stat = fs.existsSync(file) ? fs.statSync(file) : null; }
      if (error || !stat?.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${url.pathname}`); return; }
      // The preview serves source and generated pages, not files reached by a
      // symlink outside the selected package (nor private dot directories).
      fs.realpath(file,(realError,realFile)=>{
        if(realError || !(realFile===realRoot||realFile.startsWith(realRoot+path.sep)) || path.relative(realRoot,realFile).split(path.sep).some(part=>part.startsWith('.'))){res.writeHead(403).end('Forbidden');return;}
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options':'nosniff' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(realFile).on('error', () => res.destroy()).pipe(res);
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
  createStaticServer().listen(port, '127.0.0.1', () => {
    console.log(`Terrain & water visualizer: http://localhost:${port}${UI_PATH}`);
    console.log(`Serving ${ROOT}`);
  });
}
