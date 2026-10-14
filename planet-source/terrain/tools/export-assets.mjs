// Export the procedural asset library to glTF (.glb) plus a catalogue for the gallery.
// usage: node terrain/tools/export-assets.mjs
// Output: terrain/out/assets/<category>-<name>-<variant>.glb (nodes <id>_LOD0, <id>_LOD1) and catalog.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outDir } from './ladder.mjs';
import { writeGlb } from '../assets/glb.mjs';

const dir = join(outDir, 'assets');
mkdirSync(dir, { recursive: true });
const STYLES = ['timber', 'stone', 'mediterranean', 'nordic'];
const sources = [['vegetation', 'VEGETATION'], ['buildings', 'BUILDINGS'], ['props', 'PROPS']];

const catalog = [];
for (const [category, key] of sources) {
  let lib;
  try { lib = (await import(`../assets/${category}.mjs`))[key]; } catch (e) { console.log(`skip ${category}: ${e.message}`); continue; }
  for (const [name, A] of Object.entries(lib)) {
    // Styled assets: one variant per style; others: three seeds.
    const variants = 'style' in (A.defaults ?? {}) ? STYLES.map((style) => ({ tag: style, seed: 1, p: { style } })) : [1, 2, 3].map((seed) => ({ tag: `s${seed}`, seed, p: {} }));
    for (const v of variants) {
      const id = `${category}-${name}-${v.tag}`;
      const m0 = A.make(v.seed, v.p).finalize(`${id}_LOD0`), m1 = A.lod1(v.seed, v.p).finalize(`${id}_LOD1`);
      writeGlb(join(dir, `${id}.glb`), [m0, m1], { extras: { category, name, variant: v.tag, desc: A.desc } });
      catalog.push({ id, category, name, variant: v.tag, file: `${id}.glb`, desc: A.desc, tris: [m0.triangles, m1.triangles],
        size: [0, 1, 2].map((c) => +(m0.max[c] - m0.min[c]).toFixed(2)), min: m0.min.map((x) => +x.toFixed(2)), max: m0.max.map((x) => +x.toFixed(2)) });
    }
  }
}
writeFileSync(join(dir, 'catalog.json'), JSON.stringify(catalog, null, 1));
for (const c of catalog) console.log(`${c.id.padEnd(40)} tris ${String(c.tris[0]).padStart(5)} / ${String(c.tris[1]).padStart(4)}  size ${c.size.join(' x ')} m`);
console.log(`${catalog.length} assets -> ${dir}`);
