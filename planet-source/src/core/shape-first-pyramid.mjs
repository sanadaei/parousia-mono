import { createHash } from './sha256.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new TypeError(`Shape-first candidate: ${message}`); };
const positive = value => Number.isFinite(value) && value > 0;

/** Import a shape draft; this checks its data contract, never physical approval. */
export function buildShapeFirstPyramid(sourceText, { levelCount = 5, recipe = null } = {}) {
  if (typeof sourceText !== 'string') fail('provide the original JSON text for byte provenance');
  const source = JSON.parse(sourceText);
  if (source.schema !== 'shape-first-candidate@1') fail('unsupported schema');
  const { columns, rows, cellSizeM, cellSizeYM, row0, yDirection } = source.grid ?? {};
  if (![columns, rows].every(v => Number.isSafeInteger(v) && v >= 2)
      || columns * rows > 2_000_000) fail('grid must contain 2..2,000,000 finite nodes');
  if (!positive(cellSizeM) || !positive(cellSizeYM)) fail('positive x/y spacing in metres is required');
  if (row0 !== 'north' || yDirection !== 'south') fail('row0=north and yDirection=south are required');
  if (!Array.isArray(source.elevation) || source.elevation.length !== columns * rows
      || !source.elevation.every(Number.isFinite)) fail('elevation must be a finite row-major array');
  if (!Number.isInteger(levelCount) || levelCount < 1 || levelCount > 12) fail('levelCount must be 1..12');
  const stride = 2 ** (levelCount - 1);
  if ((columns - 1) % stride || (rows - 1) % stride) fail('native intervals must divide exactly by the coarsest stride');
  const widthM = (columns - 1) * cellSizeM, heightM = (rows - 1) * cellSizeYM;
  if (!positive(widthM) || !positive(heightM)) fail('extent must be finite');
  if (!Array.isArray(source.rivers)) fail('rivers must be an array of polylines');
  // Candidate v1 exports may round metre coordinates to 3 decimals. Snap only
  // sub-millimetre endpoint overflow; reject genuine out-of-domain geometry.
  const toleranceM = 0.001;
  let snappedPointCount = 0, maxCorrectionM = 0;
  const rivers = source.rivers.map((points, riverIndex) => {
    if (!Array.isArray(points) || points.length < 2) fail(`river ${riverIndex} requires at least two points`);
    return points.map(point => {
      if (!point || !Number.isFinite(point.xM) || !Number.isFinite(point.yM)
          || point.xM < -toleranceM || point.yM < -toleranceM
          || point.xM > widthM + toleranceM || point.yM > heightM + toleranceM) fail(`river ${riverIndex} is outside the metre domain`);
      const xM = Math.max(0, Math.min(widthM, point.xM));
      const yM = Math.max(0, Math.min(heightM, point.yM));
      const correction = Math.hypot(xM - point.xM, yM - point.yM);
      if (correction) { snappedPointCount++; maxCorrectionM = Math.max(maxCorrectionM, correction); }
      return { xM, yM };
    });
  });
  const levels = Array.from({ length: levelCount }, (_, index) => {
    const sourceStride = 2 ** (levelCount - index - 1);
    const nx = (columns - 1) / sourceStride + 1, ny = (rows - 1) / sourceStride + 1;
    const dx = cellSizeM * sourceStride, dy = cellSizeYM * sourceStride;
    return {
      id: `shape-${index}`, sourceStride,
      grid: { columns: nx, rows: ny, cellSizeM: dx, cellSizeYM: dy, row0, yDirection },
      elevation: Array.from({ length: nx * ny }, (_, i) => source.elevation[Math.floor(i / nx) * sourceStride * columns + (i % nx) * sourceStride]),
      // Fractional grid coordinates preserve the same polylines; no rerouting.
      riverProjection: rivers.map(points => points.map(p => ({ column: p.xM / dx, row: p.yM / dy }))),
    };
  });
  // Descriptive reconstruction loss, not an acceptance threshold or physics gate.
  for (const level of levels) {
    const n = level.grid.columns, m = level.grid.rows, stride = level.sourceStride;
    let squared = 0, maxAbsoluteErrorM = 0;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = column / stride, y = row / stride;
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(m - 1, y0 + 1);
      const tx = x - x0, ty = y - y0, h = level.elevation;
      const reconstructed = (h[y0*n+x0]*(1-tx)+h[y0*n+x1]*tx)*(1-ty)
        + (h[y1*n+x0]*(1-tx)+h[y1*n+x1]*tx)*ty;
      const error = reconstructed - source.elevation[row*columns+column];
      squared += error * error; maxAbsoluteErrorM = Math.max(maxAbsoluteErrorM, Math.abs(error));
    }
    level.designFidelity = { comparison: 'bilinear reconstruction versus native chosen shape; descriptive only',
      rmsErrorM: Math.sqrt(squared / source.elevation.length), maxAbsoluteErrorM };
  }
  return {
    schema: 'shape-first-region-pyramid@1', status: 'new-region-shape-draft',
    provenance: { sourceSha256: sha256(sourceText), hashEncoding: 'UTF-8 original JSON bytes',
      sourceSchema: source.schema, seed: source.seed ?? null, recipe,
      derivation: 'exact native-node subsampling; coarse views derived after detailed shape design',
      boundaryRounding: { toleranceM, snappedPointCount, maxCorrectionM } },
    units: { horizontal: 'metres', elevation: 'metres' },
    coordinates: { origin: 'northwest', xDirection: 'east', yDirection: 'south', storage: 'row-major' },
    nativeGrid: { columns, rows, cellSizeM, cellSizeYM, row0, yDirection },
    extent: { widthM, heightM },
    riverConcept: { status: 'designed shape; discharge deferred', pointOrder: 'preserved from source, not inferred', rivers },
    limitations: ['Not a hydraulic, erosion, drainage or water-budget certification.',
      'Old anchors and outlets are revisable; this draft does not modify adopted worlds.',
      'No generated detail below the native grid; coarse views can alias narrow features.'],
    sourceNotes: source.notes ?? null, levels,
  };
}

/** Self-contained, offline inspection. Rendering uses saved arrays, not new terrain. */
export function renderShapeFirstPreview(pyramid) {
  const data = JSON.stringify(pyramid).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Shape-first region draft</title>
<style>body{background:#f3f0e8;color:#263634;font:16px system-ui;max-width:1000px;margin:24px auto;padding:0 16px}canvas{display:block;max-width:100%;height:auto;background:#d8deca;margin-top:16px}select{font:inherit;padding:6px}small{display:block;overflow-wrap:anywhere}#label{margin:12px 0}</style>
<h1>Shape first, hierarchy second</h1><p>New region draft. Select a view derived from the same detailed source. Rivers keep their metre positions.</p>
<label>Saved resolution <select id="level"></select></label><label> <input id="rivers" type="checkbox" checked> River concept</label>
<div id="label"></div><canvas id="map" width="800" height="884"></canvas>
<p>North ↑ · NW lighting · 2.7× shading exaggeration · common elevation color scale. Coarse views are exact subsamples, not independently generated terrain. Narrow valleys may alias.</p>
<p>Flow rates and physical explanations are deferred. No hydraulic certification or adopted-world change.</p><small id="source"></small>
<script>const p=${data}; const select=document.getElementById('level'), canvas=document.getElementById('map'),ctx=canvas.getContext('2d');
const aspect=p.extent.widthM/p.extent.heightM;canvas.width=Math.max(1,Math.round(1000*Math.min(1,aspect)));canvas.height=Math.max(1,Math.round(1000*Math.min(1,1/aspect)));
p.levels.forEach((l,i)=>select.add(new Option(l.grid.columns+' × '+l.grid.rows,i)));select.value=p.levels.length-1;
const native=p.levels.at(-1).elevation;let lo=Infinity,hi=-Infinity;for(const h of native){lo=Math.min(lo,h);hi=Math.max(hi,h)}
document.getElementById('source').textContent='Source SHA-256: '+p.provenance.sourceSha256;
function draw(){const l=p.levels[+select.value],g=l.grid,n=g.columns,m=g.rows,z=l.elevation;
const off=document.createElement('canvas');off.width=n;off.height=m;const oc=off.getContext('2d'),im=oc.createImageData(n,m);
for(let r=0;r<m;r++)for(let c=0;c<n;c++){const k=r*n+c,at=(x,y)=>z[Math.min(m-1,Math.max(0,y))*n+Math.min(n-1,Math.max(0,x))];
const sx=(at(c+1,r)-at(c-1,r))/((c===0||c===n-1?1:2)*g.cellSizeM)*2.7,sy=(at(c,r+1)-at(c,r-1))/((r===0||r===m-1?1:2)*g.cellSizeYM)*2.7;
const light=Math.max(0,(-sx*-.55-sy*-.55+.63)/Math.hypot(sx,sy,1)),t=(z[k]-lo)/(hi-lo||1),base=[132+59*t,159+20*t,130+18*t];
for(let j=0;j<3;j++)im.data[k*4+j]=Math.min(255,base[j]*(.48+.65*light));im.data[k*4+3]=255;}
oc.putImageData(im,0,0);ctx.imageSmoothingEnabled=true;
// Crop at endpoint-node centres so metre endpoints align with the image edge.
ctx.drawImage(off,.5,.5,n-1,m-1,0,0,canvas.width,canvas.height);
if(document.getElementById('rivers').checked){ctx.strokeStyle='#236f88';ctx.lineWidth=1.4;p.riverConcept.rivers.forEach(points=>{ctx.beginPath();points.forEach((q,i)=>{const x=q.xM/p.extent.widthM*canvas.width,y=q.yM/p.extent.heightM*canvas.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()})}
document.getElementById('label').textContent=g.columns+' × '+g.rows+' nodes · spacing '+g.cellSizeM.toFixed(1)+' × '+g.cellSizeYM.toFixed(1)+' m · '+(p.extent.widthM/1000).toFixed(2)+' × '+(p.extent.heightM/1000).toFixed(2)+' km · native-shape RMS loss '+l.designFidelity.rmsErrorM.toFixed(2)+' m, max '+l.designFidelity.maxAbsoluteErrorM.toFixed(2)+' m';}
select.onchange=draw;document.getElementById('rivers').onchange=draw;draw();</script></html>`;
}
