"""Explicit bounded research input; requires NumPy and SciPy, not Fastscapelib.
Fixed seed is used only here, never while requesting a render tile.
"""
import json, argparse
from pathlib import Path
import numpy as np
from scipy.spatial import Delaunay

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--nodes-per-side', type=int, default=129)
parser.add_argument('--extent-m', type=float, default=20000.0)
parser.add_argument('--seed', type=int, default=20261011)
args = parser.parse_args()
output = args.output
if output.exists():
    raise FileExistsError('Refusing to overwrite a saved mesh')
n, extent, seed = args.nodes_per_side, args.extent_m, args.seed
if not (3 <= n <= 255 and n % 2 == 1 and np.isfinite(extent) and 1 <= extent <= 100000 and 0 <= seed < 2**32):
    parser.error('Require odd nodes-per-side 3..255, extent 1..100000m and unsigned 32-bit seed')
yy, xx = np.mgrid[0:n, 0:n]
points = np.column_stack([xx.ravel(), yy.ravel()]) * extent / (n - 1) - extent / 2
interior = (xx.ravel() > 0) & (xx.ravel() < n-1) & (yy.ravel() > 0) & (yy.ravel() < n-1)
points[interior] += np.random.default_rng(seed).uniform(-.43, .43, (int(interior.sum()), 2)) * extent / (n-1)
triangles = Delaunay(points).simplices
with output.open('x') as stream:
    json.dump({'points': points.tolist(), 'triangles': triangles.tolist(),
               'provenance': {'seed': seed, 'n': n, 'extentM': extent,
                              'method': 'Seeded interior jitter and SciPy Delaunay; boundary points unchanged',
                              'status': 'Synthetic research mesh, not a planetary watershed'}}, stream)
print(f'{len(points)} nodes, {len(triangles)} triangles -> {output}')
