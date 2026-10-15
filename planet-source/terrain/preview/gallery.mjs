// Asset gallery: every exported asset (out/assets/*.glb) on a grass plane under
// the shared look (render/look.mjs): sun + sky light, shadow map, aerial haze, ACES.
// Rows are asset types, columns their variants (seeds or regional styles).
// URL: ?cat=all|vegetation|buildings|props&lod=0|1&sunAz=235&sunEl=35&cam=x,y,yaw,pitch,dist&labels=0

import { LOOK } from '../render/look.mjs';

const qs = new URLSearchParams(location.search), $ = (id) => document.getElementById(id);
const canvas = $('gl'), gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
const HEAD = `#version 300 es
precision highp float; precision highp sampler2DShadow;
`;

// Assets are glTF Y-up (+Z front); the world here is Z-up with +Y north, fronts face the camera (south).
const VS = HEAD + `
in vec3 aPos, aNrm, aCol;
uniform mat4 uVP, uLight; uniform vec3 uOff;
out vec3 vW, vN, vC, vLS;
void main() {
  vec3 p = vec3(aPos.x, -aPos.z, aPos.y) + uOff;
  vW = p; vN = vec3(aNrm.x, -aNrm.z, aNrm.y); vC = aCol;
  vLS = (uLight * vec4(p, 1.0)).xyz * 0.5 + 0.5;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const FS = HEAD + LOOK + `
uniform vec3 uEye; uniform sampler2DShadow uShadow; uniform float uGround, uTexel;
in vec3 vW, vN, vC, vLS; out vec4 frag;
float sunVis(vec3 n) {
  if (any(lessThan(vLS.xy, vec2(0.0))) || any(greaterThan(vLS.xy, vec2(1.0))) || vLS.z > 1.0) return 1.0; // outside the light box: lit
  float c = clamp(dot(n, uSun), 0.0, 1.0), tn = min(sqrt(1.0 - c * c) / max(c, 0.05), 8.0);
  float z = vLS.z - uTexel * (2.5 + 2.0 * tn), s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(uShadow, vec3(vLS.xy + vec2(x, y) / 4096.0, z));
  return s / 9.0;
}
void main() {
  vec3 n = normalize(vN), alb = pow(vC, vec3(2.2));
  if (!gl_FrontFacing) n = -n; // thin double-sided parts (leaves, fronds)
  if (uGround > 0.5) { // grass plane: mottled albedo so scale reads
    float m = vnoise(vW.xy * 0.35) * 0.6 + vnoise(vW.xy * 2.1) * 0.4;
    alb = pow(mix(vec3(0.21, 0.27, 0.13), vec3(0.31, 0.35, 0.19), m), vec3(2.2));
  }
  if (uGround > 2.5) alb = pow(vec3(0.42, 0.38, 0.30), vec3(2.2)); // sea bed (sand) under the water
  vec3 d = vW - uEye; float dist = length(d); vec3 v = d / dist;
  if (uGround > 1.5 && uGround < 2.5) { // water surface: small waves, Fresnel sky reflection over dark green-blue depth
    vec2 q = vW.xy * 0.8;
    vec3 wn = normalize(vec3((vnoise(q) - 0.5) * 0.12, (vnoise(q + 17.0) - 0.5) * 0.12, 1.0)), r = reflect(v, wn);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(wn, -v), 0.0), 5.0);
    vec3 c = mix(vec3(0.010, 0.030, 0.035) * (sunColor(0.0) * 0.5 + ambient(wn, 0.0)), skyColor(vec3(r.xy, abs(r.z)), 0.0, false), F);
    c += sunColor(0.0) * pow(max(dot(r, uSun), 0.0), 300.0) * 2.0 * sunVis(wn);
    aerial(c, v, dist, uEye.z, vW.z);
    frag = vec4(present(c), mix(0.75, 1.0, F)); return;
  }
  float dif = max(dot(n, uSun), 0.0);
  vec3 c = alb * (sunColor(0.0) * dif * sunVis(n) + ambient(n, 0.0));
  aerial(c, v, dist, uEye.z, vW.z);
  frag = vec4(present(c), 1.0);
}`;
const SVS = HEAD + `in vec3 aPos; uniform mat4 uLight; uniform vec3 uOff;
void main() { gl_Position = uLight * vec4(vec3(aPos.x, -aPos.z, aPos.y) + uOff, 1.0); }`;
const SFS = HEAD + `void main() {}`;
const SKY_VS = `#version 300 es
out vec2 vNdc; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); vNdc = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const SKY_FS = HEAD + LOOK + `uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan; in vec2 vNdc; out vec4 frag;
void main() { vec3 d = normalize(uFwd + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y); frag = vec4(present(skyColor(d, 2.0)), 1.0); }`;

function program(vs, fs) {
  const p = gl.createProgram();
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 2, 'aCol');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; for (let k = 0; k < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); k++) { const n = gl.getActiveUniform(p, k).name; u[n] = gl.getUniformLocation(p, n); }
  return { p, u };
}

/** Parse our own .glb layout (glb.mjs): meshes with POSITION/NORMAL/COLOR_0 + indices. */
function parseGlb(buf) {
  const dv = new DataView(buf), jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOff = 20 + jsonLen + 8;
  const acc = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], C = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    const n = a.count * { VEC3: 3, SCALAR: 1 }[a.type];
    return new C(buf.slice(binOff + v.byteOffset, binOff + v.byteOffset + n * C.BYTES_PER_ELEMENT));
  };
  return json.meshes.map((m) => { const pr = m.primitives[0]; return { name: m.name, pos: acc(pr.attributes.POSITION), nrm: acc(pr.attributes.NORMAL), col: acc(pr.attributes.COLOR_0), idx: acc(pr.indices), min: json.accessors[pr.attributes.POSITION].min, max: json.accessors[pr.attributes.POSITION].max }; });
}

function upload(m) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  [m.pos, m.nrm, m.col].forEach((a, i) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 0, 0); });
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
  return { vao, count: m.idx.length, type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

// --- matrices (column-major)
const mul = (A, B) => { const C = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k]; C[c * 4 + r] = s; } return C; };
const sub = (a, b) => a.map((v, i) => v - b[i]), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); }, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(eye, at, up) {
  const f = nrm(sub(at, eye)), r = nrm(cross(f, up)), u = cross(r, f);
  return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
}
const perspective = (fy, asp, n, f) => { const t = 1 / Math.tan(fy / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); };
const ortho = (h, n, f) => new Float32Array([1 / h, 0, 0, 0, 0, 1 / h, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]);

// --- state
const view = { sunAz: +(qs.get('sunAz') ?? 235), sunEl: +(qs.get('sunEl') ?? 35), lod: +(qs.get('lod') ?? 0), cat: qs.get('cat') ?? 'all', clouds: +(qs.get('clouds') ?? 0.45), labels: qs.get('labels') !== '0' };
let items = [], prog, sprog, sky, ground, shadow, cam = null, bounds;

async function load() {
  const catalog = await (await fetch('../out/assets/catalog.json')).json();
  prog = program(VS, FS); sprog = program(SVS, SFS); sky = program(SKY_VS, SKY_FS);
  for (const e of catalog) {
    const meshes = parseGlb(await (await fetch(`../out/assets/${e.file}`)).arrayBuffer());
    items.push({ ...e, lods: meshes.map(upload), lodBounds: meshes.map((m) => [m.min, m.max]) });
  }
  { // ground: 64x64 grid (two huge triangles interpolate badly at grazing angles)
    const G = 2000, N = 64, pos = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(-G + 2 * G * i / N, 0, -G + 2 * G * j / N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); }
    const nv = pos.length / 3;
    ground = upload({ pos: new Float32Array(pos), nrm: new Float32Array(nv * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), col: new Float32Array(nv * 3).fill(0.5), idx: new Uint16Array(idx) });
  }
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, 4096, 4096);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  shadow = { tex, fb };
  const cats = ['all', ...new Set(catalog.map((e) => e.category))];
  $('cat').innerHTML = cats.map((c) => `<option ${c === view.cat ? 'selected' : ''}>${c}</option>`).join('');
  layout(); ui(); draw();
}

/** Rows = asset types (front to back), columns = variants; spacing from footprints. */
function layout() {
  const shown = items.filter((e) => view.cat === 'all' || e.category === view.cat);
  items.forEach((e) => { e.visible = shown.includes(e); });
  const rows = new Map(); for (const e of shown) { const k = `${e.category}/${e.name}`; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(e); }
  let y = 0, maxX = 0;
  for (const row of rows.values()) {
    const depth = Math.max(...row.map((e) => e.size[2])), gap = Math.max(1.5, 0.35 * Math.max(...row.map((e) => e.size[0])));
    let x = 0;
    for (const e of row) { e.off = [x - e.min[0], y + depth / 2 + 0.5, 0]; x += e.size[0] + gap; }
    const w = x - gap; for (const e of row) e.off[0] -= w / 2; // centre each row
    maxX = Math.max(maxX, w); y += depth + Math.max(3, 0.6 * depth) + Math.max(...row.map((e) => e.size[1])) * 0.8; // tall rows need room to be seen over
  }
  bounds = { w: maxX, d: y, h: Math.max(...shown.map((e) => e.size[1])) };
  const c = (qs.get('cam') ?? '').split(',').map(Number);
  cam = c.length === 5 && c.every(isFinite) ? { tx: c[0], ty: c[1], yaw: c[2], pitch: c[3], dist: c[4] } : { tx: 0, ty: bounds.d * 0.42, yaw: 0, pitch: 24, dist: Math.max(bounds.w * 0.75, bounds.d * 1.1, 20) };
}

function draw() { requestAnimationFrame(render); }
function render() {
  const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const az = view.sunAz * Math.PI / 180, el = view.sunEl * Math.PI / 180, sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
  const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)], target = [cam.tx, cam.ty, bounds.h * 0.25];
  const eye = target.map((t, i) => t - fwd[i] * cam.dist); eye[2] = Math.max(eye[2], 1.6);
  const V = lookAt(eye, target, [0, 0, 1]), P = perspective(45 * Math.PI / 180, w / h, 0.1, 20000), VP = mul(P, V);
  // Light: ortho box over the shown assets.
  const ctr = [0, bounds.d / 2, 0], R = Math.max(bounds.w, bounds.d) * 0.62 + bounds.h;
  const L = mul(ortho(R, 0, 4 * R), lookAt(ctr.map((c, i) => c + sun[i] * 2 * R), ctr, Math.abs(sun[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1]));
  const shown = items.filter((e) => e.visible);
  const drawAll = (U, withGround) => {
    for (const e of shown) { const m = e.lods[Math.min(view.lod, e.lods.length - 1)]; gl.uniform3fv(U.uOff, e.off); if (U.uGround) gl.uniform1f(U.uGround, 0); gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, m.type, 0); }
    if (!withGround) return;
    const sea = view.cat === 'waterfront'; // water level y=0, sandy bed below
    gl.uniform3fv(U.uOff, [0, 0, sea ? -2.6 : 0]); gl.uniform1f(U.uGround, sea ? 3 : 1); gl.bindVertexArray(ground.vao); gl.drawElements(gl.TRIANGLES, ground.count, ground.type, 0);
    if (sea) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform3fv(U.uOff, [0, 0, 0]); gl.uniform1f(U.uGround, 2); gl.drawElements(gl.TRIANGLES, ground.count, ground.type, 0);
      gl.disable(gl.BLEND);
    }
  };
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fb); gl.viewport(0, 0, 4096, 4096); gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(sprog.p); gl.uniformMatrix4fv(sprog.u.uLight, false, L); drawAll(sprog.u, false);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
  // Sky
  const r = nrm(cross(nrm(sub(target, eye)), [0, 0, 1])), f = nrm(sub(target, eye)), u = cross(r, f), tanY = Math.tan(22.5 * Math.PI / 180);
  gl.disable(gl.DEPTH_TEST); gl.useProgram(sky.p);
  gl.uniform3fv(sky.u.uSun, sun); gl.uniform1f(sky.u.uHaze, 1); gl.uniform1f(sky.u.uClouds, view.clouds); gl.uniform3fv(sky.u.uFwd, f); gl.uniform3fv(sky.u.uRight, r); gl.uniform3fv(sky.u.uUp, u); gl.uniform2f(sky.u.uTan, tanY * w / h, tanY);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog.p); const U = prog.u;
  gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniformMatrix4fv(U.uLight, false, L); gl.uniform3fv(U.uSun, sun); gl.uniform1f(U.uHaze, 1); gl.uniform1f(U.uClouds, view.clouds);
  gl.uniform3fv(U.uEye, eye); gl.uniform1f(U.uTexel, 1.5 / (4 * R) * (2 * R / 4096)); // ~1.5 shadow texels in depth units
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadow.tex); gl.uniform1i(U.uShadow, 0);
  drawAll(U, true);
  // Labels
  const box = $('labels'); box.innerHTML = '';
  if (view.labels) for (const e of shown) {
    const p = [e.off[0] + (e.min[0] + e.max[0]) / 2, e.off[1] - e.max[2] - 0.3, 0]; // just in front of the asset
    const c = [0, 1, 2, 3].map((i) => VP[i] * p[0] + VP[4 + i] * p[1] + VP[8 + i] * p[2] + VP[12 + i]);
    if (c[3] <= 0) continue;
    const d = document.createElement('div'); d.textContent = `${e.name} ${e.variant} · ${e.tris[view.lod] ?? ''}`;
    d.style.left = `${(c[0] / c[3] * 0.5 + 0.5) * 100}%`; d.style.top = `${(0.5 - c[1] / c[3] * 0.5) * 100}%`; box.append(d);
  }
  window.__frames = (window.__frames ?? 0) + 1;
}

function ui() {
  const bind = (id, key, re) => { const el = $(id); el.value = view[key]; el.oninput = () => { view[key] = el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value); if (re) re(); draw(); }; };
  bind('sunAz', 'sunAz'); bind('sunEl', 'sunEl'); bind('lod', 'lod'); bind('cat', 'cat', layout);
  $('showLabels').checked = view.labels; $('showLabels').onchange = (e) => { view.labels = e.target.checked; draw(); };
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) { const s = cam.dist * 0.0015, y = cam.yaw * Math.PI / 180; cam.tx += (-dx * Math.cos(y) + dy * Math.sin(y)) * s; cam.ty += (dx * Math.sin(y) + dy * Math.cos(y)) * s; }
    else { cam.yaw = (cam.yaw + dx * 0.3 + 360) % 360; cam.pitch = Math.min(89, Math.max(1, cam.pitch + dy * 0.25)); }
    draw();
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.min(5000, Math.max(2, cam.dist * Math.exp(e.deltaY * 0.0012))); draw(); }, { passive: false });
  addEventListener('resize', draw);
}

load().catch((e) => { $('err').style.display = 'grid'; $('err').textContent = String(e?.stack ?? e); window.__error = String(e); });
