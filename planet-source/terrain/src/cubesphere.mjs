// Equal-angle cube-sphere grid. Cell index = face*N*N + j*N + i.
// Shared by the generator (Node) and the preview (browser).

export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const QP = Math.PI / 4;

/** Direction for face coordinates s,t in [-1,1] (equal-angle). Writes into out. */
export function faceDir(f, s, t, out = [0, 0, 0]) {
  const F = FACES[f], a = Math.tan(s * QP), b = Math.tan(t * QP);
  const x = F.n[0] + F.u[0] * a + F.v[0] * b, y = F.n[1] + F.u[1] * a + F.v[1] * b, z = F.n[2] + F.u[2] * a + F.v[2] * b;
  const l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}

/** Face and face coordinates (s,t in [-1,1]) of a direction. */
export function dirFace(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const f = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : (z > 0 ? 4 : 5);
  const F = FACES[f], dn = x * F.n[0] + y * F.n[1] + z * F.n[2];
  const a = (x * F.u[0] + y * F.u[1] + z * F.u[2]) / dn, b = (x * F.v[0] + y * F.v[1] + z * F.v[2]) / dn;
  return { f, s: Math.atan(a) / QP, t: Math.atan(b) / QP };
}

export function createGrid(N) {
  const n = 6 * N * N;
  const dirs = new Float32Array(n * 3);
  const tmp = [0, 0, 0];
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    faceDir(f, ((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1, tmp);
    const c = (f * N + j) * N + i;
    dirs[c * 3] = tmp[0]; dirs[c * 3 + 1] = tmp[1]; dirs[c * 3 + 2] = tmp[2];
  }
  const cellOf = (x, y, z) => {
    const { f, s, t } = dirFace(x, y, z);
    const i = Math.min(N - 1, Math.max(0, Math.floor((s + 1) * 0.5 * N)));
    const j = Math.min(N - 1, Math.max(0, Math.floor((t + 1) * 0.5 * N)));
    return (f * N + j) * N + i;
  };
  return { N, n, dirs, cellOf };
}

/** 8-neighbourhood across face seams; -1 padded. Also unit-sphere arc lengths. */
export function buildNeighbors(grid) {
  const { N, n, cellOf, dirs } = grid;
  const nb = new Int32Array(n * 8).fill(-1), dist = new Float32Array(n * 8);
  const tmp = [0, 0, 0], h = 2 / N;
  for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = (f * N + j) * N + i, s = ((i + 0.5) / N) * 2 - 1, t = ((j + 0.5) / N) * 2 - 1;
    let k = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      faceDir(f, s + di * h, t + dj * h, tmp);
      const m = cellOf(tmp[0], tmp[1], tmp[2]);
      if (m === c) continue;
      let dup = false;
      for (let q = 0; q < k; q++) if (nb[c * 8 + q] === m) dup = true;
      if (dup) continue;
      nb[c * 8 + k] = m;
      const d = dirs[c * 3] * dirs[m * 3] + dirs[c * 3 + 1] * dirs[m * 3 + 1] + dirs[c * 3 + 2] * dirs[m * 3 + 2];
      dist[c * 8 + k] = Math.acos(Math.min(1, d));
      k++;
    }
  }
  return { nb, dist };
}
