import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildShapeFirstPyramid, renderShapeFirstPreview, sha256 } from '../scripts/experiments/shape-first/region-pyramid.mjs';
const text = readFileSync(new URL('../fixtures/shape-first/river-first-candidate.json', import.meta.url), 'utf8');
const source = JSON.parse(text);
const build = patch => buildShapeFirstPyramid(JSON.stringify({ ...source, ...patch }));

test('shape-first: native-first pyramid is deterministic and preserves the detailed field', () => {
  const p = buildShapeFirstPyramid(text);
  assert.deepEqual(p, buildShapeFirstPyramid(text));
  assert.equal(p.provenance.sourceSha256, sha256(text));
  assert.notEqual(p.provenance.sourceSha256, buildShapeFirstPyramid(text + '\n').provenance.sourceSha256);
  assert.deepEqual(p.levels.map(l => [l.grid.columns, l.grid.rows]), [[11,9],[21,17],[41,33],[81,65],[161,129]]);
  assert.deepEqual(p.levels.at(-1).elevation, source.elevation);
  assert.equal(p.levels.at(-1).sourceStride, 1);
  assert.equal(p.nativeGrid.row0, 'north');
  assert.equal(p.extent.widthM, 160 * source.grid.cellSizeM);
  assert.equal(p.extent.heightM, 128 * source.grid.cellSizeYM);
  assert.equal(p.status, 'new-region-shape-draft');
  assert.equal(p.provenance.recipe, null);
});

test('shape-first: every parent is an exact child-node subsample with shared metre coordinates', () => {
  const p = buildShapeFirstPyramid(text);
  for (let i = 0; i < p.levels.length - 1; i++) {
    const a = p.levels[i], b = p.levels[i + 1];
    assert.equal(b.grid.columns - 1, 2 * (a.grid.columns - 1));
    assert.equal(b.grid.rows - 1, 2 * (a.grid.rows - 1));
    assert.equal(a.grid.cellSizeM, b.grid.cellSizeM * 2);
    assert.equal(a.grid.cellSizeYM, b.grid.cellSizeYM * 2);
    for (let y = 0; y < a.grid.rows; y++) for (let x = 0; x < a.grid.columns; x++) {
      assert.equal(a.elevation[y * a.grid.columns + x], b.elevation[y * 2 * b.grid.columns + x * 2]);
      assert.equal(x * a.grid.cellSizeM, x * 2 * b.grid.cellSizeM);
      assert.equal(y * a.grid.cellSizeYM, y * 2 * b.grid.cellSizeYM);
    }
  }
});

test('shape-first: shared river concept is bounded and every projection reverses to metres', () => {
  const p = buildShapeFirstPyramid(text);
  assert.equal(p.riverConcept.rivers.length, source.rivers.length);
  assert(p.provenance.boundaryRounding.snappedPointCount > 0);
  assert(p.provenance.boundaryRounding.maxCorrectionM < 0.001);
  p.riverConcept.rivers.forEach((line, r) => line.forEach((q, i) => {
    assert(q.xM >= 0 && q.xM <= p.extent.widthM);
    assert(q.yM >= 0 && q.yM <= p.extent.heightM);
    assert(Math.hypot(q.xM-source.rivers[r][i].xM,q.yM-source.rivers[r][i].yM) < .001);
    for (const l of p.levels) {
      const v = l.riverProjection[r][i];
      assert(v.column >= 0 && v.column <= l.grid.columns - 1);
      assert(v.row >= 0 && v.row <= l.grid.rows - 1);
      assert(Math.abs(v.column * l.grid.cellSizeM - q.xM) < 1e-9);
      assert(Math.abs(v.row * l.grid.cellSizeYM - q.yM) < 1e-9);
    }
  }));
});

test('shape-first: only structural requirements gate drafts; no old anchors or physics thresholds', () => {
  const unusual = build({ elevation: source.elevation.map(() => -30), rivers: [] });
  assert.equal(unusual.levels.at(-1).elevation[0], -30);
  assert.deepEqual(unusual.riverConcept.rivers, []);
  assert.throws(() => build({ schema: 'unknown' }), /schema/);
  assert.throws(() => build({ elevation: [0] }), /elevation/);
  assert.throws(() => build({ elevation: source.elevation.map((z,i)=>i===0?null:z) }), /finite/);
  assert.throws(() => build({ grid: {...source.grid, row0:'south'} }), /row0/);
  assert.throws(() => build({ grid: {...source.grid, cellSizeYM:0} }), /spacing/);
  assert.throws(() => build({ rivers: [[{xM:0,yM:0},{xM:-1,yM:0}]] }), /domain/);
  assert.throws(() => buildShapeFirstPyramid(text,{levelCount:7}), /divide/);
  assert.throws(() => buildShapeFirstPyramid(text,{levelCount:0}), /levelCount/);
});

test('shape-first: generic rectangular import retains row-major orientation and bounded native extent', () => {
  const s = {schema:'shape-first-candidate@1',grid:{columns:5,rows:3,cellSizeM:10,cellSizeYM:20,row0:'north',yDirection:'south'},
    elevation:Array.from({length:15},(_,i)=>i),rivers:[[{xM:0,yM:0},{xM:40,yM:40}]]};
  const p = buildShapeFirstPyramid(JSON.stringify(s),{levelCount:2});
  assert.deepEqual(p.levels[0].elevation,[0,2,4,10,12,14]);
  assert.deepEqual(p.levels[0].riverProjection,[[{column:0,row:0},{column:2,row:1}]]);
  assert.equal(p.levels.at(-1).sourceStride,1);
  assert.equal(buildShapeFirstPyramid(JSON.stringify(s),{levelCount:1}).levels.length,1);
});

test('shape-first: CLI writes a reproducible saved pyramid and a self-contained preview', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shape-first-'));
  try {
    const cli = new URL('../scripts/experiments/shape-first/build-region-pyramid.mjs',import.meta.url);
    execFileSync(process.execPath,[fileURLToPath(cli),fileURLToPath(new URL('../fixtures/shape-first/river-first-candidate.json',import.meta.url)),dir]);
    const p = JSON.parse(readFileSync(join(dir,'region-pyramid.json'),'utf8'));
    assert.deepEqual(p,buildShapeFirstPyramid(text));
    const html=readFileSync(join(dir,'preview.html'),'utf8');
    assert(html.includes(p.provenance.sourceSha256));
    assert(!html.includes('<script src='));
    assert(!renderShapeFirstPreview({...p,sourceNotes:'</script><script>alert(1)</script>'}).includes('</script><script>alert'));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('shape-first: all three isolated alternatives import through the same contract', () => {
  for (const name of ['eroded','valley']) {
    const text=readFileSync(new URL(`../scripts/experiments/shape-first/alternatives/${name}/candidate.json`,import.meta.url),'utf8');
    const p=buildShapeFirstPyramid(text);
    assert.equal(p.levels.length,5);
    assert.deepEqual(p.levels.at(-1).elevation,JSON.parse(text).elevation);
    assert.equal(p.levels.at(-1).designFidelity.rmsErrorM,0);
    assert.equal(p.levels.at(-1).designFidelity.maxAbsoluteErrorM,0);
    assert(p.levels[0].designFidelity.rmsErrorM>0);
  }
});

test('shape-first: bilinear reconstruction is descriptive and exact on an affine plane', () => {
  const s={schema:'shape-first-candidate@1',grid:{columns:5,rows:3,cellSizeM:10,cellSizeYM:20,row0:'north',yDirection:'south'},elevation:Array.from({length:15},(_,i)=>2*(i%5)+4*Math.floor(i/5)),rivers:[]};
  const p=buildShapeFirstPyramid(JSON.stringify(s),{levelCount:2});
  assert.equal(p.levels[0].designFidelity.rmsErrorM,0);
  s.elevation[1]+=4;
  const q=buildShapeFirstPyramid(JSON.stringify(s),{levelCount:2});
  assert.equal(q.levels[0].designFidelity.maxAbsoluteErrorM,4);
  assert.equal(q.levels[0].designFidelity.rmsErrorM,Math.sqrt(16/15));
});
