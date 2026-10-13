from pathlib import Path
import json,numpy as np,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
from matplotlib.collections import LineCollection
from diagnostic import drainage
P=Path(__file__).resolve().parent;R=P.parents[3]
plt.rcParams['font.family']='Noto Sans CJK JP'
w,h=161,129;dx,dy=8847.575822/160,9772.991600/128
real=np.load(R/'scripts/experiments/fine-real-reference/actual-target-grid.npz')['elevation_m']
fields=[('実地形：メリーランド州の丘陵地',real,None)]
for folder,title in [('shape-first-river','A：川の枝分かれから山・谷を作る'),('shape-first-eroded','B：丘陵を削って川筋を作る'),('shape-first-valley','C：大きな谷・尾根から組み立てる')]:
 d=json.loads((R / {'shape-first-river':'fixtures/shape-first/river-first-candidate.json','shape-first-eroded':'scripts/experiments/shape-first/alternatives/eroded/candidate.json','shape-first-valley':'scripts/experiments/shape-first/alternatives/valley/candidate.json'}[folder]).read_text());z=np.array(d['elevation']).reshape(h,w)
 assert np.isfinite(z).all()
 fields.append((title,z,d.get('rivers',[])))
lim=max(float(np.ptp(z)) for _,z,_ in fields)
fig,axs=plt.subplots(2,2,figsize=(13,14),layout='constrained'); ls=LightSource(315,45)
for ax,(title,z,rivers) in zip(axs.flat,fields):
 rel=z-z.min();rgb=ls.shade(rel,cmap=plt.colormaps['gist_earth'],vmin=0,vmax=lim,vert_exag=2,dx=dx,dy=dy,blend_mode='soft')
 ax.imshow(rgb,extent=[0,dx*(w-1)/1000,dy*(h-1)/1000,0])
 if rivers is None:
  rec,area,fill=drainage(z,dx,dy);lines=[]
  for i,j in enumerate(rec):
   if j>=0 and area[i]>=.7:lines.append([(i%w*dx/1000,i//w*dy/1000),(j%w*dx/1000,j//w*dy/1000)])
 else:
  lines=[[(p['xM']/1000,p['yM']/1000) for p in path] for path in rivers if len(path)>1]
 ax.add_collection(LineCollection(lines,colors='#1878ba',linewidths=.95,alpha=.8))
 ax.set_title(title+'\n'+f'高低差 {np.ptp(z):.0f} m',fontsize=13)
 ax.set(xlabel='東西 (km)',ylabel='南北 (km)',xlim=(0,dx*(w-1)/1000),ylim=(dy*(h-1)/1000,0));ax.set_aspect('equal')
fig.suptitle('地形と水系を一緒に作る：形を先に比較する試作\n全図 約8.85 × 9.77 km、161 × 129点、共通の陰影・色条件',fontsize=18)
fig.supxlabel('色：各範囲の最低地点からの高さ（共通尺度）／陰影の高さ強調 2倍\n青線：実地形はDEMから推定した排水経路、試作は各案の川筋。水理シミュレーションではありません。',fontsize=10)
fig.savefig(P/'shape-first-four-way.png',dpi=145)
(P/'display-conditions.json').write_text(json.dumps({'widthM':dx*(w-1),'heightM':dy*(h-1),'relativeHeightColorMaxM':lim,'hillshadeVerticalExaggeration':2,'nativeGrid':[w,h],'realReferenceRivers':'D8 inferred, not surveyed','candidateRivers':'procedural concept'},indent=2))
