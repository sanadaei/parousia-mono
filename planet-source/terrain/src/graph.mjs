// Graph utilities over the cube-sphere neighbourhood: min-heap and
// multi-source geodesic distance (Dijkstra) carrying the source's label.

export class MinHeap {
  constructor(capacity) { this.k = new Float64Array(capacity); this.v = new Int32Array(capacity); this.size = 0; }
  push(key, val) {
    let i = this.size++;
    const k = this.k, v = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0];
    this.topKey = k[0];
    const n = --this.size, key = k[n], val = v[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= key) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = key; v[i] = val;
    return top;
  }
}

/** Geodesic distance (unit sphere radians) from sources; label[] = source id. */
export function distanceField(nbh, n, sources) {
  const { nb, dist } = nbh;
  const d = new Float32Array(n).fill(Infinity), src = new Int32Array(n).fill(-1);
  const heap = new MinHeap(n * 8);
  for (const s of sources) { d[s] = 0; src[s] = s; heap.push(0, s); }
  while (heap.size) {
    const c = heap.pop(), dc = heap.topKey;
    if (dc > d[c]) continue;
    for (let q = 0; q < 8; q++) {
      const m = nb[c * 8 + q];
      if (m < 0) break;
      const nd = dc + dist[c * 8 + q];
      if (nd < d[m]) { d[m] = nd; src[m] = src[c]; heap.push(nd, m); }
    }
  }
  return { d, src };
}
