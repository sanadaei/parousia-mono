#!/usr/bin/env python3
"""Shape-first constructive valley / ridge study. Not a physical drainage certificate.
Requires numpy, scipy, matplotlib. Run python generate.py; outputs beside this file.
Only reference scale/extent are used; reference elevations are never sampled.
"""
import os
from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--out',default=str(Path(__file__).resolve().parent/'generated'))
OUT=Path(parser.parse_args().out);OUT.mkdir(parents=True,exist_ok=True)
os.environ['MPLCONFIGDIR']=str(OUT/'.mplcache')
import json
import numpy as np
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource, LinearSegmentedColormap
W,H=8847.575822,9772.991600
NX,NY=161,129
SEED=91357
rng=np.random.default_rng(SEED)
x=np.linspace(0,W,NX); y=np.linspace(0,H,NY);X,Y=np.meshgrid(x,y);u=X/W;v=Y/H

def smooth(points,n=500):
    a=np.asarray(points,float);t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(a,axis=0),axis=1))];t/=t[-1]
    q=np.linspace(0,1,n)
    return np.c_[CubicSpline(t,a[:,0],bc_type='natural')(q)*W,CubicSpline(t,a[:,1],bc_type='natural')(q)*H]

# Central river bends intentionally change radius and valley width downstream.
main=smooth([[.43,0],[.47,.10],[.44,.20],[.35,.31],[.38,.42],[.53,.52],[.60,.62],[.56,.73],[.48,.80],[.55,.90],[.72,1]])
paths=[main]; parents=[None]; names=['Main stem']
beds=[106-31*main[:,1]/H]; widths=[170+150*np.exp(-((main[:,1]/H-.79)/.17)**2)+80*np.exp(-((main[:,1]/H-.28)/.11)**2)]
# Each child is attached at an exact parent point. Control points head downstream.
def tributary(name,control,parent,join,head,wide=70):
    target=paths[parent][int(join*(len(paths[parent])-1))]
    line=smooth(control+[list(target/[W,H])],300)
    t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(line,axis=0),axis=1))];t/=t[-1]
    end=beds[parent][int(join*(len(paths[parent])-1))]
    paths.append(line);parents.append(parent);names.append(name)
    beds.append(end+(head-end)*(1-t)**1.10)
    widths.append(wide*(.50+.50*t))
tributary('Northwest fork',[[.03,.04],[.12,.10],[.19,.14],[.24,.22]],0,.29,135,90)
tributary('Northeast fork',[[.94,.06],[.84,.14],[.72,.17],[.66,.27],[.55,.31]],0,.39,137,110)
tributary('Western hollow',[[.04,.41],[.15,.44],[.22,.50],[.34,.51]],0,.54,128,105)
tributary('Eastern fork',[[.97,.40],[.86,.44],[.78,.53],[.73,.60]],0,.65,129,105)
tributary('Southwest fork',[[.03,.66],[.16,.65],[.25,.69],[.34,.77]],0,.79,119,100)
tributary('Southeast hollow',[[.96,.77],[.86,.81],[.76,.88]],0,.94,115,85)
tributary('Northwestern headwater',[[.08,.24],[.15,.23],[.22,.26]],1,.80,132,50)
tributary('Northeastern headwater',[[.72,.02],[.70,.10],[.69,.19]],2,.46,139,55)
tributary('East lateral hollow',[[.97,.62],[.89,.63],[.83,.61]],4,.68,124,50)
tributary('West lateral hollow',[[.06,.89],[.16,.84],[.22,.78]],5,.64,116,60)
tributary('Upper western side brook',[[.04,.15],[.08,.17],[.12,.18]],7,.48,136,35)
tributary('West ridge brook',[[.22,.03],[.25,.08],[.25,.14]],1,.64,141,40)
tributary('East ridge brook',[[.93,.24],[.87,.28],[.76,.28]],2,.64,137,45)
tributary('East outer brook',[[.98,.30],[.94,.35],[.90,.39]],4,.30,135,40)
tributary('Middle west brook',[[.05,.54],[.14,.53],[.23,.55]],3,.64,130,40)
tributary('Lower west brook',[[.14,.97],[.22,.91],[.24,.85]],10,.50,121,40)
tributary('Lower east brook',[[.99,.89],[.93,.91],[.87,.88]],6,.62,117,35)
tributary('Western divide brook',[[.25,.38],[.26,.42],[.28,.47]],3,.55,139,40)
# Long rolling uplands, not a globally uniform roughness blanket.
noise=np.zeros_like(X)
for scale,amp in [(15,8),(7,3.8),(2.3,1.35)]:
    q=gaussian_filter(rng.normal(size=X.shape),scale);q/=q.std();noise+=amp*q
upland=137-11*v+13*np.sin(2*np.pi*(u*.71+v*.32))+noise
upland+=15*np.exp(-(((u-.78)/.20)**2+((v-.35)/.34)**2))
upland+=10*np.exp(-(((u-.16)/.21)**2+((v-.54)/.26)**2))
# A family of nested widening valley surfaces intersects the uplands. Soft-min
# rounds interfluves while preserving independent river and tributary geometry.
terrain=upland.copy(); surfaces=[]; distances=[]
flat=X.ravel(); query=np.c_[flat,Y.ravel()]
for i,(line,bed,width) in enumerate(zip(paths,beds,widths)):
    d,k=cKDTree(line).query(query);d=d.reshape(X.shape);k=k.reshape(X.shape)
    w=width[k];b=bed[k]
    # Wide low-gradient alluvium; asymmetric hillsides vary smoothly along bends.
    near=line[k];side=np.sign(X-near[:,:,0]); asym=1+.22*side*np.sin(4*v+1.3*i)
    outside=np.maximum(d-w,0)
    rise=.0035*np.minimum(d,w)+.030*outside*asym+.000014*outside**2
    # Tributary heads blend out into hills instead of leaving deep abrupt caps.
    s=b+rise
    surfaces.append(s);distances.append(d)
    terrain=-1.8*np.logaddexp(-terrain/1.8,-s/1.8)
# Fine texture belongs on slopes, not floodplain; bed remains low and smooth.
dmain=distances[0];rough=gaussian_filter(rng.normal(size=X.shape),1.0)
terrain+=.65*rough*np.clip((dmain-220)/500,0,1)
terrain=gaussian_filter(terrain,.55)
# Keep elevations in reference-like low hill range without copying its surface.
river_objects=[]
for name,parent,line,bed in zip(names,parents,paths,beds):
    river_objects.append({'name':name,'parent':parent,'points':[{'xM':round(float(a),3),'yM':round(float(b),3),'designBedM':round(float(c),3)} for (a,b),c in zip(line,bed)]})
candidate={'schema':'shape-first-candidate@1','name':'Valley and asymmetric spurs','kind':'shape-first constructive landforms, not physically certified','seed':SEED,'extentM':{'width':W,'height':H},'grid':{'columns':NX,'rows':NY,'cellSizeM':W/(NX-1),'cellSizeYM':H/(NY-1),'row0':'north','yDirection':'south'},'elevation':np.round(terrain,4).ravel().tolist(),'rivers':[[{'xM':p['xM'],'yM':p['yM']} for p in r['points']] for r in river_objects],'riverMetadata':river_objects,'method':'Construct valley/river geometry together, intersect variable-width asymmetric valley surfaces with rolling uplands; seeded small-scale texture. No DEM-height copying; no flow solver.'}
(OUT/'candidate.json').write_text(json.dumps(candidate,separators=(',',':')))
np.savez_compressed(OUT/'candidate.npz',elevation_m=terrain,x_m=x,y_m=y)
# High-resolution, restrained shaded-relief map. Vertical exaggeration is display-only.
cmap=LinearSegmentedColormap.from_list('earth',['#d6ddbf','#a9bba0','#859875','#c0b294','#ddd1b7'])
ls=LightSource(azdeg=315,altdeg=42)
rgb=ls.shade(terrain,cmap=cmap,vert_exag=4,dx=W/(NX-1),dy=H/(NY-1),blend_mode='soft',vmin=72,vmax=169)
fig=plt.figure(figsize=(10.5,12),facecolor='#f7f5ef');ax=fig.add_axes([.05,.07,.90,.85]);ax.imshow(rgb,extent=[0,W,H,0],interpolation='bilinear')
ax.contour(X,Y,terrain,levels=np.arange(80,180,10),colors='#465247',linewidths=.3,alpha=.23)
for i,p in reversed(list(enumerate(paths))):
    lw=2.3 if i==0 else 1.25 if parents[i]==0 else .85
    ax.plot(p[:,0],p[:,1],color='#e6f7fc',lw=lw+1,alpha=.85,solid_capstyle='round')
    ax.plot(p[:,0],p[:,1],color='#217caa',lw=lw,alpha=.95,solid_capstyle='round')
ax.set_xlim(0,W);ax.set_ylim(H,0);ax.set_aspect('equal');ax.set_xticks([]);ax.set_yticks([])
for s in ax.spines.values():s.set_visible(False)
ax.plot([450,2450],[H-450,H-450],color='#26372d',lw=3);ax.text(1450,H-580,'2 km',ha='center',fontsize=9,color='#26372d')
ax.text(W-350,450,'N ↑',ha='right',fontsize=12,color='#26372d')
fig.text(.06,.955,'Winding valley · asymmetric spurs',fontsize=22,color='#233a32',weight='bold')
fig.text(.06,.928,'Shape-first prototype  |  8.85 × 9.77 km  |  161 × 129 samples',fontsize=11,color='#5a6458')
fig.text(.06,.035,'Constructed landforms + river network. Hillshade ×4 exaggeration. No physical-flow certification.',fontsize=9,color='#5a6458')
fig.savefig(OUT/'preview.png',dpi=190,facecolor=fig.get_facecolor());plt.close(fig)
# Simple neutral relief useful for comparison, no frame.
plt.imsave(OUT/'hillshade.png',ls.hillshade(terrain,vert_exag=4,dx=W/160,dy=H/128),cmap='gray')
slope=np.hypot(*np.gradient(terrain,H/128,W/160))
summary={'heightMinM':float(terrain.min()),'heightMaxM':float(terrain.max()),'slopeMedian':float(np.median(slope)),'slope90':float(np.quantile(slope,.9)),'riverCount':len(paths),'seed':SEED,'physicalValidation':'not performed; shape-first sketch'}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
