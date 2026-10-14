// Minimal binary glTF 2.0 (.glb) writer for finalised meshes (see mesh.mjs).
// One node per mesh, vertex colours as COLOR_0, one matte material
// (metallic 0, roughness 1) so engines shade them consistently.

import { writeFileSync } from 'node:fs';

/** parts: [{ name, positions, normals, colors, indices, min, max, translation? }] */
export function encodeGlb(parts, { generator = 'parousia-terrain-assets', extras = {} } = {}) {
  const views = [], accessors = [], chunks = [];
  let offset = 0;
  const push = (arr, target, type, componentType, count, minmax) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad;
    accessors.push({ bufferView: views.length - 1, componentType, count, type, ...minmax });
    return accessors.length - 1;
  };
  const meshes = [], nodes = [];
  for (const p of parts) {
    const n = p.positions.length / 3;
    const POSITION = push(p.positions, 34962, 'VEC3', 5126, n, { min: p.min, max: p.max });
    const NORMAL = push(p.normals, 34962, 'VEC3', 5126, n);
    const COLOR_0 = push(p.colors, 34962, 'VEC3', 5126, n);
    const indices = push(p.indices, 34963, 'SCALAR', p.indices instanceof Uint32Array ? 5125 : 5123, p.indices.length);
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION, NORMAL, COLOR_0 }, indices, material: 0 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1, ...(p.translation ? { translation: p.translation } : {}) });
  }
  const json = {
    asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i), extras }], nodes, meshes,
    materials: [{ name: 'vertex-colour', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors, bufferViews: views, buffers: [{ byteLength: offset }],
  };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), total = 12 + 8 + js.length + 8 + bin.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
}

export const writeGlb = (path, parts, opts) => writeFileSync(path, encodeGlb(parts, opts));
