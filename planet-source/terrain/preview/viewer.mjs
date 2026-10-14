// Minimal WebGL2 preview of a nested terrain scene (tools/export-scene.mjs).
//
// Each ladder level is one 512² heightfield mesh drawn coarse to fine. A level
// discards the fragments its child covers; the child morphs its outer band to
// the parent's height and hangs a skirt, so the joins stay closed. Curvature,
// sun + sky ambient, water Fresnel, and height-dependent haze (aerial
// perspective) are applied; there are sun shadows come from one 2048² ortho shadow map around the orbit target.
//
// URL: ?scene=planet-1-N512-mountain&preset=3&exag=1&sunAz=250&sunEl=30&haze=1&shadows=1&ui=0

import { LOOK } from '../render/look.mjs';

const qs = new URLSearchParams(location.search);
const sceneName = qs.get('scene') ?? 'planet-1-N512-mountain';
const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DShadow;
` + LOOK;

// Vertex code shared by the main and shadow programs so they cannot drift.
const TERRAIN_COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DShadow;
uniform sampler2D uH, uC, uPH;
uniform int uRes, uPRes, uHasParent;
uniform float uDx, uSize, uPDx, uPSize, uExag, uRadius, uSkirt;
uniform vec2 uOrigin, uPOrigin;
uniform mat4 uLight; uniform vec3 uLC; // light ortho matrix, light centre (world)
float hAt(ivec2 p) { return texelFetch(uH, clamp(p, ivec2(0), ivec2(uRes - 1)), 0).r; }
float pAt(ivec2 p) { return texelFetch(uPH, clamp(p, ivec2(0), ivec2(uPRes - 1)), 0).r; }
float parentH(vec2 xy) {
  vec2 f = vec2((xy.x - uPOrigin.x + uPSize * 0.5) / uPDx - 0.5, (uPOrigin.y + uPSize * 0.5 - xy.y) / uPDx - 0.5);
  vec2 fi = floor(f), t = f - fi; ivec2 b = ivec2(fi);
  return mix(mix(pAt(b), pAt(b + ivec2(1, 0)), t.x), mix(pAt(b + ivec2(0, 1)), pAt(b + ivec2(1, 1)), t.x), t.y);
}
// Shared terrain vertex: world position (curved, skirted), normal, xy, height, cell.
void terrain(out vec3 pos, out vec3 N, out vec2 xy, out float h, out ivec2 ij) {
  int G = uRes + 2, vi = gl_VertexID % G, vj = gl_VertexID / G;
  bool skirt = vi == 0 || vj == 0 || vi == G - 1 || vj == G - 1;
  int i = clamp(vi - 1, 0, uRes - 1), j = clamp(vj - 1, 0, uRes - 1);
  float hs = uSize * 0.5;
  vec2 local = vec2((float(i) + 0.5) * uDx - hs, hs - (float(j) + 0.5) * uDx);
  if (i == 0) local.x = -hs; if (i == uRes - 1) local.x = hs;
  if (j == 0) local.y = hs; if (j == uRes - 1) local.y = -hs;
  xy = uOrigin + local;
  h = hAt(ivec2(i, j)); ij = ivec2(i, j);
  float gx = (hAt(ivec2(i + 1, j)) - hAt(ivec2(i - 1, j))) / (2.0 * uDx);
  float gy = (hAt(ivec2(i, j - 1)) - hAt(ivec2(i, j + 1))) / (2.0 * uDx);
  if (uHasParent == 1) { // geomorph the outer band onto the parent surface (height and slope)
    float e = hs - max(abs(local.x), abs(local.y)), w = 1.0 - smoothstep(0.0, 0.08 * uSize, e);
    if (w > 0.0) {
      vec2 ox = vec2(uPDx, 0.0), oy = vec2(0.0, uPDx);
      h = mix(h, parentH(xy), w);
      gx = mix(gx, (parentH(xy + ox) - parentH(xy - ox)) / (2.0 * uPDx), w);
      gy = mix(gy, (parentH(xy + oy) - parentH(xy - oy)) / (2.0 * uPDx), w);
    }
  }
  float z = h * uExag - dot(xy, xy) / (2.0 * uRadius);
  if (skirt) z -= uSkirt * uExag;
  N = normalize(vec3(-gx * uExag + xy.x / uRadius, -gy * uExag + xy.y / uRadius, 1.0));
  pos = vec3(xy, z);
}`;

const TERRAIN_VS = TERRAIN_COMMON + `
uniform vec3 uEye; uniform mat4 uVP;
out vec3 vRel; out vec3 vN; out vec4 vCol; out vec2 vXY; out float vH; out float vLogZ; out vec3 vLS;
void main() {
  vec3 pos; ivec2 ij; terrain(pos, vN, vXY, vH, ij);
  vRel = pos - uEye;
  gl_Position = uVP * vec4(vRel, 1.0);
  vLogZ = 1.0 + gl_Position.w;
  vCol = texelFetch(uC, ij, 0);
  vLS = (uLight * vec4(pos - uLC, 1.0)).xyz * 0.5 + 0.5; // light-space uv + depth
}`;

const SHADOW_VS = TERRAIN_COMMON + `
out vec2 vXY;
void main() { vec3 pos, n; float h; ivec2 ij; terrain(pos, n, vXY, h, ij); gl_Position = uLight * vec4(pos - uLC, 1.0); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
uniform vec4 uHole; uniform int uHasHole; in vec2 vXY;
void main() { if (uHasHole == 1 && vXY.x > uHole.x && vXY.x < uHole.z && vXY.y > uHole.y && vXY.y < uHole.w) discard; }`;

const TERRAIN_FS = COMMON + `
uniform vec4 uHole; uniform int uHasHole; uniform float uFC, uEyeH;
uniform sampler2DShadow uShadow; uniform vec3 uShP; // shadow: on, texel size (m), 1 / (2 * depth half-range m)
in vec3 vRel; in vec3 vN; in vec4 vCol; in vec2 vXY; in float vH; in float vLogZ; in vec3 vLS;
// Sun visibility: 3x3 PCF (hardware-bilinear taps) with a slope-scaled bias; outside the map is lit.
float sunVis(vec3 n) {
  if (uShP.x < 0.5 || any(lessThan(vLS.xy, vec2(0.0))) || any(greaterThan(vLS.xy, vec2(1.0))) || vLS.z > 1.0) return 1.0;
  float c = clamp(dot(n, uSun), 0.0, 1.0), tn = min(sqrt(1.0 - c * c) / max(c, 0.05), 12.0);
  float z = vLS.z - uShP.y * uShP.z * (1.5 + 2.0 * tn);
  vec2 t = vec2(1.0 / 2048.0); float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(uShadow, vec3(vLS.xy + vec2(x, y) * t, z));
  return s / 9.0;
}
out vec4 frag;
void main() {
  if (uHasHole == 1 && vXY.x > uHole.x && vXY.x < uHole.z && vXY.y > uHole.y && vXY.y < uHole.w) discard;
  gl_FragDepth = log2(vLogZ) * uFC * 0.5;
  float dist = length(vRel); vec3 v = vRel / dist;
  vec3 n = normalize(vN);
  vec3 alb = pow(vCol.rgb, vec3(2.2));
  if (vCol.a < 0.5) { // ground mottling (world space, faded with distance): breaks the flat per-texel colour
    float m = (vnoise(vXY / 9.0) - 0.5) * 0.6 + (vnoise(vXY / 45.0) - 0.5) * 0.8 + (vnoise(vXY / 230.0) - 0.5) * 0.6;
    float fade = 1.0 - smoothstep(1500.0, 9000.0, dist);
    alb *= mix(vec3(1.0), vec3(1.0 + 0.35 * m, 1.0 + 0.28 * m, 1.0 + 0.18 * m), fade);
  }
  float dif = max(dot(n, uSun), 0.0);
  vec3 sunL = sunColor(max(vH, 0.0)), amb = ambient(n, max(vH, 0.0));
  float vis = sunVis(n);
  vec3 c = alb * (sunL * dif * vis + amb);
  if (vCol.a > 0.5) { // water: Fresnel sky reflection and sun glint on a near-flat surface
    vec3 wn = normalize(mix(n, vec3(0, 0, 1), 0.85)), r = reflect(v, wn);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(wn, -v), 0.0), 5.0);
    c = mix(alb * (sunL * dif * vis * 0.35 + amb * 0.8), skyColor(vec3(r.xy, abs(r.z)), max(vH, 0.0), false), F) + sunL * vis * pow(max(dot(r, uSun), 0.0), 400.0) * 3.0;
  }
  aerial(c, v, dist, max(uEyeH, 0.0), max(vH, 0.0)); // Rayleigh + Mie haze: distant ridges turn blue
  frag = vec4(present(c), 1.0);
}`;

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); vNdc = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const SKY_FS = COMMON + `
uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan; uniform float uEyeH;
in vec2 vNdc; out vec4 frag;
void main() { vec3 d = normalize(uFwd + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y); frag = vec4(present(skyColor(d, max(uEyeH, 0.0))), 1.0); }`;

function program(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let k = 0; k < nu; k++) { const name = gl.getActiveUniform(p, k).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

function fail(e) { $('err').style.display = 'grid'; $('err').textContent = String(e?.stack ?? e); window.__error = String(e); }

// --- Scene state
let scene, levels, terrainProg, skyProg, vao;
const view = { tx: 0, ty: 0, yaw: 0, pitch: 25, dist: 1000, exag: +(qs.get('exag') ?? 1), sunAz: +(qs.get('sunAz') ?? 250), sunEl: +(qs.get('sunEl') ?? 30), haze: +(qs.get('haze') ?? 1), clouds: +(qs.get('clouds') ?? 0.45), shadows: qs.get('shadows') !== '0' };
const SM = 2048; let shadowTex, shadowFbo, shadowProg;

async function load() {
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  scene = await (await fetch(`../out/scene-${sceneName}.json`)).json();
  const bin = await (await fetch(`../out/scene-${sceneName}.bin`)).arrayBuffer();
  terrainProg = program(TERRAIN_VS, TERRAIN_FS);
  skyProg = program(SKY_VS, SKY_FS);
  shadowProg = program(SHADOW_VS, SHADOW_FS);
  shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, SM, SM);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  shadowFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  vao = gl.createVertexArray();
  const indexCache = new Map();
  levels = scene.levels.map((L, k) => {
    const n = L.res * L.res, heights = new Float32Array(bin, L.height.offset, n);
    const tex = (internal, format, type, data) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, L.res, L.res, 0, format, type, data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      return t;
    };
    if (!indexCache.has(L.res)) indexCache.set(L.res, gridIndices(L.res + 2));
    return {
      ...L, k, heights, visible: true, index: indexCache.get(L.res),
      hTex: tex(gl.R32F, gl.RED, gl.FLOAT, heights),
      cTex: tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(bin, L.color.offset, n * 4)),
    };
  });
  buildUi();
  applyPreset(+(qs.get('preset') ?? 3));
}

function gridIndices(G) {
  const idx = new Uint32Array((G - 1) * (G - 1) * 6); let o = 0;
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
    const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const buf = gl.createBuffer(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return { buf, count: idx.length };
}

/** Surface height (m, unexaggerated) from the finest visible level covering (x, y). */
function heightAt(x, y) {
  for (let k = levels.length - 1; k >= 0; k--) {
    const L = levels[k]; if (!L.visible) continue;
    const fx = (x - L.origin[0] + L.sizeM / 2) / L.dx - 0.5, fy = (L.origin[1] + L.sizeM / 2 - y) / L.dx - 0.5;
    if (fx < 0 || fy < 0 || fx > L.res - 1 || fy > L.res - 1) continue;
    const i = Math.min(L.res - 2, Math.floor(fx)), j = Math.min(L.res - 2, Math.floor(fy)), u = fx - i, v = fy - j, h = L.heights, c = j * L.res + i;
    return (h[c] * (1 - u) + h[c + 1] * u) * (1 - v) + (h[c + L.res] * (1 - u) + h[c + L.res + 1] * u) * v;
  }
  return 0;
}
const surfaceZ = (x, y) => heightAt(x, y) * view.exag - (x * x + y * y) / (2 * scene.radiusM);

// Presets: one oblique view per level, plus low-angle views for judging the near field.
const PRESETS = [
  { label: 'L1', level: 0, dist: 0.65, pitch: 32, yaw: 15 },
  { label: 'L2', level: 1, dist: 0.75, pitch: 26, yaw: 15 },
  { label: 'L3', level: 2, dist: 0.8, pitch: 24, yaw: 15 },
  { label: 'L4', level: 3, dist: 0.8, pitch: 24, yaw: 15 },
  { label: 'L3 low', level: 2, dist: 0.6, pitch: 12, yaw: 15 },
  { label: 'ground', level: 3, dist: 0.15, pitch: 4, yaw: 15 },
];
function applyPreset(p) {
  const P = PRESETS[Math.min(PRESETS.length, Math.max(1, p)) - 1], L = levels[Math.min(P.level, levels.length - 1)];
  Object.assign(view, { tx: L.origin[0], ty: L.origin[1], dist: L.sizeM * P.dist, pitch: P.pitch, yaw: P.yaw });
  draw();
}

function camera() {
  const yaw = view.yaw * Math.PI / 180, pitch = view.pitch * Math.PI / 180;
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  const target = [view.tx, view.ty, surfaceZ(view.tx, view.ty)];
  const eye = target.map((t, m) => t - f[m] * view.dist);
  const ground = surfaceZ(eye[0], eye[1]) + 1.7;
  if (eye[2] < ground) eye[2] = ground;
  const d = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]], dl = Math.hypot(...d);
  const fwd = d.map((v) => v / dl);
  let r = [fwd[1], -fwd[0], 0]; const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl);
  const up = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
  return { eye, fwd, right: r, up };
}

function draw() {
  if (!levels) return;
  requestAnimationFrame(render);
}

/** Draw every visible level coarse to fine, setting per-level uniforms on program uniforms U. */
function drawLevels(U) {
  for (const L of levels) {
    if (!L.drawn) continue;
    const parent = levels[L.k - 1], child = levels[L.k + 1];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.hTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.cTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, (parent ?? L).hTex);
    gl.uniform1i(U.uRes, L.res); gl.uniform1f(U.uDx, L.dx); gl.uniform1f(U.uSize, L.sizeM); gl.uniform2fv(U.uOrigin, L.origin);
    gl.uniform1i(U.uHasParent, parent && parent.drawn ? 1 : 0);
    if (parent) { gl.uniform1i(U.uPRes, parent.res); gl.uniform1f(U.uPDx, parent.dx); gl.uniform1f(U.uPSize, parent.sizeM); gl.uniform2fv(U.uPOrigin, parent.origin); }
    gl.uniform1f(U.uSkirt, parent ? Math.max(2, 0.3 * parent.dx) : 0);
    const hole = child && child.drawn;
    gl.uniform1i(U.uHasHole, hole ? 1 : 0);
    if (hole) { const s = child.sizeM / 2; gl.uniform4f(U.uHole, child.origin[0] - s, child.origin[1] - s, child.origin[0] + s, child.origin[1] + s); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.index.buf);
    gl.drawElements(gl.TRIANGLES, L.index.count, gl.UNSIGNED_INT, 0);
  }
}

function render() {
  const w = Math.round(canvas.clientWidth * devicePixelRatio), h = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  const cam = camera(), fovY = 50 * Math.PI / 180, tanY = Math.tan(fovY / 2), tanX = tanY * w / h;
  const near = 0.25, far = 4e6;
  // View (rotation only; geometry is eye-relative) times perspective, column-major.
  const { right: r, up: u, fwd: f } = cam;
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1];
  const P = [1 / tanX, 0, 0, 0, 0, 1 / tanY, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0];
  const VP = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + rr] * V[c * 4 + k]; VP[c * 4 + rr] = s; }
  const az = view.sunAz * Math.PI / 180, el = view.sunEl * Math.PI / 180;
  const sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const eyeH = (cam.eye[2] + (cam.eye[0] ** 2 + cam.eye[1] ** 2) / (2 * scene.radiusM)) / view.exag;

  // LOD: a level is drawn only while the eye is within a few of its widths;
  // further away its sub-pixel relief would only alias.
  for (const L of levels) {
    const ex = Math.max(0, Math.abs(cam.eye[0] - L.origin[0]) - L.sizeM / 2), ey = Math.max(0, Math.abs(cam.eye[1] - L.origin[1]) - L.sizeM / 2);
    L.drawn = L.visible && (L.k === 0 || Math.hypot(ex, ey, eyeH - heightAt(L.origin[0], L.origin[1])) < 2 * L.sizeM);
  }
  // Shadow map: ortho light camera along -sun, centred on the orbit target (target-relative for precision).
  let shP = [0, 0, 0];
  const tgt = [view.tx, view.ty, surfaceZ(view.tx, view.ty)], R = Math.min(3e5, Math.max(200, view.dist * 1.5)), D = Math.max(R, 2e4);
  const lx0 = Math.hypot(sun[0], sun[1]) > 1e-4 ? [sun[1], -sun[0], 0] : [1, 0, 0], ll = Math.hypot(...lx0), lx = lx0.map((v) => v / ll);
  const ly = [sun[1] * lx[2] - sun[2] * lx[1], sun[2] * lx[0] - sun[0] * lx[2], sun[0] * lx[1] - sun[1] * lx[0]];
  const LM = new Float32Array(16);
  for (let m = 0; m < 3; m++) { LM[m * 4] = lx[m] / R; LM[m * 4 + 1] = ly[m] / R; LM[m * 4 + 2] = -sun[m] / D; } LM[15] = 1;
  const setLight = (p) => { gl.uniformMatrix4fv(p.u.uLight, false, LM); gl.uniform3fv(p.u.uLC, tgt); };
  if (view.shadows) {
    shP = [1, 2 * R / SM, 1 / (2 * D)];
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo); gl.viewport(0, 0, SM, SM);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadowProg.p); setLight(shadowProg);
    gl.uniform1f(shadowProg.u.uExag, view.exag); gl.uniform1f(shadowProg.u.uRadius, scene.radiusM);
    gl.uniform1i(shadowProg.u.uH, 0); gl.uniform1i(shadowProg.u.uPH, 2);
    drawLevels(shadowProg.u);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
  }

  gl.bindVertexArray(vao);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  gl.useProgram(skyProg.p);
  gl.uniform3fv(skyProg.u.uSun, sun); gl.uniform1f(skyProg.u.uHaze, view.haze); gl.uniform1f(skyProg.u.uClouds, view.clouds);
  gl.uniform3fv(skyProg.u.uFwd, f); gl.uniform3fv(skyProg.u.uRight, r); gl.uniform3fv(skyProg.u.uUp, u); gl.uniform2f(skyProg.u.uTan, tanX, tanY); gl.uniform1f(skyProg.u.uEyeH, eyeH);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  const T = terrainProg, U = T.u; gl.useProgram(T.p);
  gl.uniformMatrix4fv(U.uVP, false, VP); gl.uniform3fv(U.uEye, cam.eye); gl.uniform3fv(U.uSun, sun);
  gl.uniform1f(U.uHaze, view.haze); gl.uniform1f(U.uClouds, view.clouds); gl.uniform1f(U.uExag, view.exag); gl.uniform1f(U.uRadius, scene.radiusM);
  gl.uniform1f(U.uFC, 2 / Math.log2(far + 1)); gl.uniform1f(U.uEyeH, eyeH);
  gl.uniform1i(U.uH, 0); gl.uniform1i(U.uC, 1); gl.uniform1i(U.uPH, 2); gl.uniform1i(U.uShadow, 3); gl.uniform3fv(U.uShP, shP); setLight(T);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  drawLevels(U);
  updateInfo(cam, eyeH);
  window.__frames = (window.__frames ?? 0) + 1;
}

function updateInfo(cam, eyeH) {
  const ground = heightAt(cam.eye[0], cam.eye[1]);
  const lat = scene.latDeg + view.ty / scene.radiusM * 180 / Math.PI;
  const lon = scene.lonDeg + view.tx / (scene.radiusM * Math.cos(scene.latDeg * Math.PI / 180)) * 180 / Math.PI;
  const fmt = (m) => (Math.abs(m) >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`);
  $('info').textContent = [
    `target  ${lat.toFixed(3)}°, ${lon.toFixed(3)}°  h ${fmt(heightAt(view.tx, view.ty))}`,
    `eye     ${fmt(eyeH)} asl, ${fmt(eyeH - ground)} agl`,
    `dist    ${fmt(view.dist)}  yaw ${view.yaw.toFixed(0)}°  pitch ${view.pitch.toFixed(0)}°`,
    `drawn   ${levels.filter((L) => L.drawn).map((L) => L.name).join(' ')}`,
  ].join('\n');
}

function buildUi() {
  $('title').textContent = `${scene.tag} · ${scene.site}`;
  if (qs.get('ui') === '0') $('panel').style.display = 'none';
  PRESETS.forEach((p, i) => { const b = document.createElement('button'); b.textContent = `${i + 1} ${p.label}`; b.onclick = () => applyPreset(i + 1); $('presets').append(b); });
  levels.forEach((L) => {
    const l = document.createElement('label'); l.style.margin = '0';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true;
    c.onchange = () => { L.visible = c.checked; draw(); };
    l.append(c, L.name); $('levels').append(l);
  });
  const bind = (id, key, fmt) => { const el = $(id); el.value = view[key]; el.oninput = () => { view[key] = +el.value; if (fmt) $(fmt).textContent = view[key].toFixed(1); draw(); }; if (fmt) $(fmt).textContent = view[key].toFixed(1); };
  $('shadows').checked = view.shadows; $('shadows').onchange = () => { view.shadows = $('shadows').checked; draw(); };
  bind('exag', 'exag', 'exagV'); bind('sunAz', 'sunAz'); bind('sunEl', 'sunEl'); bind('haze', 'haze');
  $('toggle').onclick = () => $('panel').classList.toggle('hidden');
  addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= String(PRESETS.length)) applyPreset(+e.key);
    if (e.key === 'h' || e.key === 'H') $('panel').classList.toggle('hidden');
  });
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const s = view.dist * 0.0015, yaw = view.yaw * Math.PI / 180;
      view.tx += (-dx * Math.cos(yaw) + dy * Math.sin(yaw)) * s; view.ty += (dx * Math.sin(yaw) + dy * Math.cos(yaw)) * s;
    } else { view.yaw = (view.yaw + dx * 0.3 + 360) % 360; view.pitch = Math.min(89, Math.max(-5, view.pitch + dy * 0.25)); }
    draw();
  });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.min(2e6, Math.max(5, view.dist * Math.exp(e.deltaY * 0.0012))); draw(); }, { passive: false });
  addEventListener('resize', draw);
}

load().catch(fail);
