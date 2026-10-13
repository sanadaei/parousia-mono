"""Same-scale source-array comparison. Reference is never read by generator."""
import json,sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
from matplotlib.collections import LineCollection
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'scripts/experiments/shape-first/comparison'))
from diagnostic import drainage
out=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/seeded-river-regions')
real=np.load(ROOT/'scripts/experiments/fine-real-reference/actual-target-grid.npz')['elevation_m']
fields=[('Actual Maryland reference',real,None)]
for seed in [271828,314159,161803]:
 d=json.loads((out/f'candidate-{seed}.json').read_text());g=d['grid'];dx,dy=g['cellSizeM'],g['cellSizeYM'];fields.append((f'Seed {seed} / {d["generator"]["outlet"]["side"]} outlet',np.array(d['elevation']).reshape(g['rows'],g['columns']),d['rivers']))
lim=max(np.ptp(z) for _,z,_ in fields)
fig,axs=plt.subplots(2,2,figsize=(13,14),layout='constrained');ls=LightSource(315,45)
for ax,(title,z,rivers) in zip(axs.flat,fields):
 h,w=z.shape;rgb=ls.shade(z-z.min(),cmap=plt.colormaps['gist_earth'],vmin=0,vmax=lim,vert_exag=2,dx=dx,dy=dy,blend_mode='soft');ax.imshow(rgb,extent=[0,dx*(w-1)/1000,dy*(h-1)/1000,0])
 if rivers is None:
  rec,area,_=drainage(z,dx,dy);lines=[[(i%w*dx/1000,i//w*dy/1000),(j%w*dx/1000,j//w*dy/1000)] for i,j in enumerate(rec) if j>=0 and area[i]>=.7]
 else:lines=[[(p['xM']/1000,p['yM']/1000) for p in path] for path in rivers]
 ax.add_collection(LineCollection(lines,colors='#1878ba',linewidths=.85,alpha=.75));ax.set(title=f'{title}\nRelief {np.ptp(z):.0f} m',xlabel='East (km)',ylabel='South (km)');ax.set_aspect('equal')
fig.suptitle('One constructive generator, three distinct river/valley designs\nSame 8.85 × 9.77 km extent / 161 × 129 nodes / common color and 2× hillshade',fontsize=15)
fig.supxlabel('Blue: designed channels; actual reference: DEM-inferred drainage. No hydraulic certification. No reference heights copied.',fontsize=10)
fig.savefig(out/'multiseed-reference-comparison.png',dpi=145)
