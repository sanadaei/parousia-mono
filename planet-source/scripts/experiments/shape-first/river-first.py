#!/usr/bin/env python3
"""River-first fictional heightfield. numpy/scipy/matplotlib; no DEM copied.
Run: python generate.py --out .
Units are metres. y increases northward. Path vertices run downstream to upstream.
This is a shape-design prototype, NOT a hydraulic/erosion validation.
"""
import argparse,json
from pathlib import Path
import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource,LinearSegmentedColormap

SEED=271828
W,H=8847.575822166944,9772.99159961942
NX,NY=161,129
rng=np.random.default_rng(SEED)
x=np.linspace(0,W,NX);y=np.linspace(0,H,NY);X,Y=np.meshgrid(x,y)
paths=[]
def path(name, controls, bed0, grade, order, parent=None):
    p=np.array(controls,dtype=float)*1000
    t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    tt=np.linspace(0,t[-1],max(15,int(t[-1]/22)))
    q=np.column_stack([PchipInterpolator(t,p[:,i])(tt) for i in range(2)])
    # Unequal bends at two resolved scales break the smooth drafting-curve look.
    tangent=np.gradient(q,axis=0);tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-9)
    normal=np.c_[-tangent[:,1],tangent[:,0]]
    taper=np.clip(np.sin(np.pi*tt/tt[-1]),0,1)**.65
    bend=(36*np.sin(tt/173+rng.uniform(0,6.28))+14*np.sin(tt/71+rng.uniform(0,6.28)))*taper
    q+=normal*bend[:,None]
    s=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))]
    # Smoothly steeper headwaters; exact matching bed at each confluence.
    bed=bed0+grade*s*(0.70+0.30*s/s[-1])
    obj=dict(name=name,xy=q,bed=bed,s=s,order=order,parent=parent)
    paths.append(obj);return obj

def branch(name,parent,f,controls,grade,order):
    j=int(f*(len(parent['xy'])-1));start=parent['xy'][j]/1000
    return path(name,[start,*controls],float(parent['bed'][j]),grade,order,parent['name'])

# Draw the desired valley system first. Mouth is at the eastern edge; the
# asymmetric, curving basin has a long northwestern headwater and eastern arm.
trunk=path('main',[(8.847575822,1.6),(7.7,1.95),(6.8,2.6),(5.5,3.1),(4.75,4.1),(4.35,5.5),(3.35,6.5),(3.0,7.8),(1.6,9.5)],74,.0068,3)
a=branch('western_fork',trunk,.44,[(3.5,3.3),(2.5,3.65),(1.3,4.8),(.3,5.3)],.0098,2)
b=branch('northeast_fork',trunk,.58,[(5.35,6.0),(6.25,7.0),(6.8,8.4),(7.8,9.6)],.0105,2)
c=branch('southwest_fork',trunk,.20,[(6.1,1.9),(4.7,1.7),(3.9,.85),(2.2,.25)],.011,2)
d=branch('east_fork',trunk,.34,[(6.65,4.1),(7.5,4.7),(8.65,5.3)],.013,2)
e=branch('upper_west',trunk,.79,[(2.1,6.9),(1.5,7.6),(.25,8.15)],.011,2)
f=branch('upper_east',trunk,.90,[(3.45,8.55),(4.15,9.5)],.012,2)
g=branch('lower_south',trunk,.07,[(7.8,.95),(7.4,.15)],.013,1)
# Tributary side gullies, designed to be unequal in spacing, length and angle.
configs=[
(a,.28,[(3.9,4.4),(3.25,5.1)],.021),(a,.57,[(2.5,4.7),(2.2,5.7)],.019),
(a,.77,[(1.05,3.9),(.3,3.7)],.024),(a,.32,[(3.4,2.7),(2.7,2.25)],.022),
(a,.9,[(.9,5.6),(.4,6.3)],.023),
(b,.23,[(5.9,5.6),(6.65,5.9)],.02),(b,.48,[(5.3,7.25),(4.65,7.9)],.02),
(b,.72,[(7.5,8.1),(8.4,8.6)],.018),(b,.86,[(6.35,9.1),(5.9,9.7)],.021),
(c,.26,[(5.8,.7),(5.3,.1)],.02),(c,.62,[(3.7,1.65),(2.75,1.25)],.023),
(d,.45,[(7.1,3.7),(8.0,3.3)],.022),(d,.72,[(7.25,5.3),(7.75,6.4),(8.5,6.85)],.02),
(e,.44,[(1.45,6.6),(.6,6.75)],.022),(e,.73,[(1.4,8.3),(.9,9.15)],.02),
(f,.37,[(4.05,8.5),(4.9,9.15)],.024),
(trunk,.69,[(3.9,7.0),(4.5,7.0)],.027),
(trunk,.10,[(8.15,2.7),(8.6,3.0)],.023)]
for i,(p,t,pts,g) in enumerate(configs):branch('side_%02d'%i,p,t,pts,g,1)
# Small, irregular upstream fingers produce interlocking secondary spurs.
for p in list(paths[8:]):
    if rng.random()<.78:
        j=int(rng.uniform(.45,.70)*(len(p['xy'])-1));q=p['xy'][j];v=p['xy'][min(j+5,len(p['xy'])-1)]-p['xy'][max(0,j-5)];v/=np.linalg.norm(v)
        side=rng.choice([-1,1]);n=np.array([-v[1],v[0]])*side
        u=.55*v+.83*n;length=rng.uniform(380,680)
        end=q+u*length
        if np.all(end>[60,60]) and np.all(end<[W-60,H-60]):
            # Avoid crossing any existing channel away from the confluence.
            test=np.linspace(q+u*200,end,12)
            other=np.concatenate([o['xy'] for o in paths if o is not p])
            if cKDTree(other).query(test)[0].min()>170:
                path('twig_'+p['name'],[q/1000,(q+u*length*.5+v*60)/1000,end/1000],float(p['bed'][j]),.032,0,p['name'])

def noise(sigma):
    a=gaussian_filter(rng.normal(size=(NY,NX)),sigma,mode='reflect');return a/np.std(a)
large=noise(15);medium=noise(5);small=noise(1.7)
# A broad irregular upland lid prevents conical distance surfaces from becoming
# unbounded mountains at the edge. It does not prescribe old ridge anchors.
upland=202+18*(Y/H)+17*large+7*medium
z=upland.copy();mind=np.full_like(X,np.inf)
for p in paths:
    d,j=cKDTree(p['xy']).query(np.c_[X.ravel(),Y.ravel()]);d=d.reshape(X.shape);j=j.reshape(X.shape)
    mind=np.minimum(mind,d);s=p['s'][j]/p['s'][-1]
    floor={3:110,2:52,1:18,0:5}[p['order']]*(1-.55*s)
    # Broad trunk floodplain grades into steep lower walls and rounded shoulders.
    dd=np.maximum(d-floor,0)
    rise=.006*np.minimum(d,floor)+.104*dd**.94
    rise*=np.clip(1+.12*large+.07*medium,.65,1.45)
    valley=p['bed'][j]+rise
    z=np.minimum(z,valley)
# Keep detail small-scale and coherent: texture fades toward channel floors.
z+=np.clip(mind/300,0,1)*(4.3*medium+2.5*small)
z=gaussian_filter(z,.60)
# A shallow explicit thalweg is part of the heightfield, not only a blue line.
for p in paths:
    d,j=cKDTree(p['xy']).query(np.c_[X.ravel(),Y.ravel()]);d=d.reshape(X.shape);j=j.reshape(X.shape)
    w={3:42,2:35,1:28,0:23}[p['order']]
    alpha=np.exp(-(d/w)**2)
    z=z*(1-alpha)+(p['bed'][j]-.6)*alpha

gy,gx=np.gradient(z,y,x);slope=np.degrees(np.arctan(np.hypot(gx,gy)))
args=argparse.ArgumentParser();args.add_argument('--out',default=str(Path(__file__).parent));out=Path(args.parse_args().out);out.mkdir(parents=True,exist_ok=True)
river=[]
for p in paths:
    sampled=map_coordinates(z,[p['xy'][:,1]/H*(NY-1),p['xy'][:,0]/W*(NX-1)],order=1,mode='nearest')
    river.append(dict(id=p['name'],parent=p['parent'],order=p['order'],direction='downstream_to_upstream',pointsM=np.round(p['xy'],3).tolist(),designBedElevationM=np.round(p['bed'],3).tolist(),sampledTerrainElevationM=np.round(sampled,3).tolist()))
obj=dict(schema='shape-first-river@1',seed=SEED,status='procedural shape concept; not hydraulic validation',grid=dict(columns=NX,rows=NY,widthM=W,heightM=H,dxM=W/(NX-1),dyM=H/(NY-1),rowOrder='south_to_north',origin='fictional local (0,0), metres'),elevationM=np.round(z,5).tolist(),rivers=river)
(out/'terrain.json').write_text(json.dumps(obj,separators=(',',':')))
candidate=dict(schema='shape-first-candidate@1',seed=SEED,grid=dict(columns=NX,rows=NY,cellSizeM=W/(NX-1),cellSizeYM=H/(NY-1),row0='north',yDirection='south'),elevation=np.round(z[::-1],5).ravel().tolist(),rivers=[[dict(xM=round(float(q[0]),3),yM=round(float(H-q[1]),3)) for q in p['xy']] for p in paths],notes='Fictional river-first shape design. Not hydraulic validation.')
(out/'candidate.json').write_text(json.dumps(candidate,separators=(',',':')))
np.savez_compressed(out/'terrain.npz',x_m=x,y_m=y,elevation_m=z,slope_degrees=slope)
summary=dict(seed=SEED,shape=[NY,NX],extentM=[W,H],elevationPercentilesM=np.percentile(z,[0,5,50,95,100]).tolist(),slopePercentilesDegrees=np.percentile(slope,[50,95,100]).tolist(),pathCount=len(paths),totalPathLengthKm=sum(p['s'][-1] for p in paths)/1000,reference='Reference read for scale/morphology only; no reference heights used by generator',limitation='Designed channel beds are monotonic. Sampled gridded beds, routing, discharge and erosion budgets are not certified.')
(out/'summary.json').write_text(json.dumps(summary,indent=2))
# Renders are computed from precisely the exported 161 x 129 height array.
cmap=LinearSegmentedColormap.from_list('land',['#7e9981','#a5b28c','#b8bd94','#c8c3a0','#b5a78d','#a18c78'])
ls=LightSource(azdeg=310,altdeg=38)
shade=ls.hillshade(z,vert_exag=2.7,dx=x[1]-x[0],dy=y[1]-y[0])
rgb=cmap((z-z.min())/(z.max()-z.min()))[...,:3]*(.46+.62*shade[...,None])
rgb=np.clip(rgb,0,1)
plt.rcParams.update({'font.family':'DejaVu Sans','axes.spines.top':False,'axes.spines.right':False})
fig,ax=plt.subplots(figsize=(10,11));fig.patch.set_facecolor('#f4f2eb')
ax.imshow(rgb,origin='lower',extent=[0,W/1000,0,H/1000],interpolation='bilinear')
for p in paths:
    ax.plot(p['xy'][:,0]/1000,p['xy'][:,1]/1000,color='#d9f1ec',lw=.7+p['order']*.60,alpha=.9)
    ax.plot(p['xy'][:,0]/1000,p['xy'][:,1]/1000,color='#246879',lw=.35+p['order']*.28,alpha=.95)
ax.set(xlabel='East (km)',ylabel='North (km)',title='River first / a fictional branching valley\nActual heightfield · 8.85 × 9.77 km · 161 × 129 nodes')
ax.text(.02,.025,'Seed 271828  |  Shape prototype, not hydraulic validation\nHillshade: NW light, 2.7× vertical shading exaggeration',transform=ax.transAxes,fontsize=9,bbox=dict(facecolor='#f4f2eb',alpha=.85,edgecolor='none',pad=7))
fig.tight_layout();fig.savefig(out/'hillshade-rivers.png',dpi=190);plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(18,7),constrained_layout=True)
ims=[axes[0].imshow(z,origin='lower',extent=[0,W/1000,0,H/1000],cmap='terrain',vmin=70,vmax=245),axes[1].imshow(slope,origin='lower',extent=[0,W/1000,0,H/1000],cmap='magma',vmin=0,vmax=15),axes[2].imshow(ls.hillshade(z,vert_exag=2.7,dx=x[1]-x[0],dy=y[1]-y[0]),origin='lower',extent=[0,W/1000,0,H/1000],cmap='gray',vmin=0,vmax=1)]
for ax,im,title,label in zip(axes,ims,['Elevation','Slope','Unpainted terrain relief'],['metres','degrees','shading']):
    ax.set(title=title,xlabel='East (km)',ylabel='North (km)');fig.colorbar(im,ax=ax,shrink=.65,label=label)
fig.suptitle('One exported height array · river skeleton shaped the valleys before terrain detail',fontsize=17)
fig.savefig(out/'height-slope-diagnostic.png',dpi=160);plt.close(fig)
print(json.dumps(summary,indent=2))
