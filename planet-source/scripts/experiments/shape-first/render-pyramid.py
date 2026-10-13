#!/usr/bin/env python3
"""Render only the saved pyramid. Requires numpy and matplotlib; no new heights."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
p=argparse.ArgumentParser();p.add_argument('pyramid');p.add_argument('--output',default='shape-first-pyramid.png');args=p.parse_args()
d=json.loads(Path(args.pyramid).read_text());levels=d['levels'];W=d['extent']['widthM']/1000;H=d['extent']['heightM']/1000
native=np.array(levels[-1]['elevation']);lo=native.min();hi=native.max();ls=LightSource(315,45)
fig,axs=plt.subplots(1,len(levels),figsize=(4*len(levels),5.8),layout='constrained',squeeze=False)
for ax,l in zip(axs.flat,levels):
 g=l['grid'];z=np.array(l['elevation']).reshape(g['rows'],g['columns'])
 rgb=ls.shade(z,cmap=plt.colormaps['gist_earth'],vmin=lo,vmax=hi,vert_exag=2,dx=g['cellSizeM'],dy=g['cellSizeYM'],blend_mode='soft')
 ax.imshow(rgb,extent=[-g['cellSizeM']/2000,W+g['cellSizeM']/2000,H+g['cellSizeYM']/2000,-g['cellSizeYM']/2000],interpolation='bilinear')
 for river in d['riverConcept']['rivers']:
  xy=np.array([[p['xM']/1000,p['yM']/1000] for p in river]);ax.plot(xy[:,0],xy[:,1],color='#1878ba',lw=.45,alpha=.85)
 f=l['designFidelity'];ax.set_title(f"{g['columns']} × {g['rows']} nodes\nRMS {f['rmsErrorM']:.2f} m | max {f['maxAbsoluteErrorM']:.2f} m",fontsize=11)
 ax.set(xlim=(0,W),ylim=(H,0),xlabel='East (km)',ylabel='South from north edge (km)');ax.set_aspect('equal')
fig.suptitle('Detailed shape first → derived coarse views → same native shape\nExact 2× node hierarchy; common color scale; 2× hillshade exaggeration',fontsize=16)
fig.supxlabel('RMS / max: bilinear reconstruction loss relative to native heights, not physical approval. Rivers share the same metre-space concept.',fontsize=11)
fig.savefig(args.output,dpi=150)
