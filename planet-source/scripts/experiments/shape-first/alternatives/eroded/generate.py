#!/usr/bin/env python3
"""Deterministic shape-first hills, implicit stream-power incision, and routed rivers.
No reference elevations, outlet anchors, inherited river paths, or ledger constraints.
Requires Python 3, numpy, scipy, matplotlib. Typical runtime < 60 s.
"""
import os
os.environ.setdefault('MPLCONFIGDIR','/tmp/shape-first-mpl')
import argparse, heapq, json, time
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter, zoom
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource, LinearSegmentedColormap
from matplotlib.collections import LineCollection

W,H=161,129
LX,LY=8847.575822,9772.991600
DX,DY=LX/(W-1),LY/(H-1)
OFFSETS=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1),(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]

def route(z):
    """Priority flood supplies a strictly descending routing surface. Original elevations retained."""
    nr,nc=z.shape;n=z.size;f=z.ravel().copy();seen=np.zeros(n,bool);heap=[]
    boundary=np.unique(np.r_[np.arange(nc),np.arange(n-nc,n),np.arange(0,n,nc),np.arange(nc-1,n,nc)])
    for i in boundary:seen[i]=True;heapq.heappush(heap,(f[i],int(i)))
    order=[]
    while heap:
        h,i=heapq.heappop(heap);order.append(i);r,c=divmod(i,nc)
        for dr,dc in OFFSETS:
            rr,cc=r+dr,c+dc
            if 0<=rr<nr and 0<=cc<nc:
                j=rr*nc+cc
                if not seen[j]:
                    seen[j]=True;f[j]=max(f[j],h+1e-5);heapq.heappush(heap,(f[j],j))
    f=f.reshape(z.shape);recv=np.full(z.shape,-1,np.int32);best=np.zeros(z.shape);distance=np.ones(z.shape)
    ids=np.arange(n).reshape(z.shape)
    for dr,dc in OFFSETS:
        src=(slice(max(0,-dr),min(nr,nr-dr)),slice(max(0,-dc),min(nc,nc-dc)))
        dst=(slice(max(0,dr),min(nr,nr+dr)),slice(max(0,dc),min(nc,nc+dc)))
        d=np.hypot(dc*DX,dr*DY);s=(f[src]-f[dst])/d;take=s>best[src]
        best[src][take]=s[take];recv[src][take]=ids[dst][take];distance[src][take]=d
    recv=recv.ravel();area=np.full(n,DX*DY)
    order=np.array(order,dtype=np.int32)
    for i in order[::-1]:
        j=recv[i]
        if j>=0:area[j]+=area[i]
    return recv,area,order,distance.ravel(),f

def field(rng,shape,sigma):
    a=gaussian_filter(rng.normal(size=shape),sigma,mode='reflect');return (a-a.mean())/a.std()

def smooth_path(points):
    # Two corner-cutting passes, endpoints fixed; displacement stays within a cell.
    p=np.asarray(points,dtype=float)
    for _ in range(2):
        a=.75*p[:-1]+.25*p[1:];b=.25*p[:-1]+.75*p[1:]
        p=np.vstack([p[0],np.stack([a,b],axis=1).reshape(-1,2),p[-1]])
    return p.tolist()

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',default=str(Path(__file__).parent/'generated'));p.add_argument('--seed',type=int,default=24117);p.add_argument('--steps',type=int,default=60);args=p.parse_args()
    start=time.monotonic();out=Path(args.output);out.mkdir(parents=True,exist_ok=True);rng=np.random.default_rng(args.seed)
    # A padded landscape keeps artificial edge drainage outside the reviewed window.
    pad=24;shape=(H+2*pad,W+2*pad);yy,xx=np.mgrid[-pad:H+pad,-pad:W+pad];x=xx*DX;y=yy*DY
    broad=field(rng,shape,(17,23));middle=field(rng,shape,(5,7));small=field(rng,shape,(1.6,2.2))
    z=145+0.008*x+0.004*y+13*broad+14*middle+4*small
    # A slowly varying rock-strength field makes branches unequal without drawing rivers.
    resistance=1+0.20*np.tanh(field(rng,shape,(11,13)))
    uplift=0.13+0.05*np.tanh(broad)
    initial=z.copy();history=[]
    for step in range(args.steps):
        recv,area,order,dist,filled=route(z)
        # Permit water to cross initial closed depressions, then let incision replace flats.
        # Breach spill barriers along the computed receiver graph; do not fill
        # entire basins into flat plates. Small grade prevents ambiguous routing.
        flat=z.ravel()
        for i in order[::-1]:
            j=recv[i]
            if j>=0 and flat[j]>=flat[i]-0.025:flat[j]=flat[i]-0.025
        old=z.ravel().copy();new=old.copy();u=uplift.ravel();rock=resistance.ravel()
        for i in order:
            j=recv[i]
            if j>=0:
                c=0.065*(area[i]/(DX*DY))**0.45/rock[i]
                # Stable implicit n=1 stream power (distance-normalized).
                c*=np.sqrt(DX*DY)/dist[i]
                new[i]=(old[i]+u[i]+c*new[j])/(1+c)
        z=new.reshape(shape)
        # Gentle hillslope soil creep rounds interfluves without flattening valleys.
        z+=0.32*(gaussian_filter(z,0.8)-z)
        if step%20==0:history.append({'step':step,'relief_m':float(z.max()-z.min())})
    # Displayed window and lowland relief comparable in scale, never copied in shape.
    crop=z[pad:pad+H,pad:pad+W];lo,hi=np.percentile(crop,[0,100]);z=74+(z-lo)*98/(hi-lo)
    recv,area,order,dist,filled=route(z)
    crop=z[pad:pad+H,pad:pad+W];ac=area.reshape(shape)[pad:pad+H,pad:pad+W]
    receiver=np.full((H,W),-1,np.int32);flow=np.zeros((H,W,2));segments=[];widths=[];rivers=[]
    threshold=0.22e6
    for r in range(H):
        for c in range(W):
            i=(r+pad)*shape[1]+c+pad;j=recv[i]
            if j<0:continue
            rr,cc=divmod(int(j),shape[1]);rr-=pad;cc-=pad
            flow[r,c]=[(cc-c)*DX,(rr-r)*DY]
            if 0<=rr<H and 0<=cc<W:
                receiver[r,c]=rr*W+cc
                if ac[r,c]>=threshold:
                    segments.append([(c*DX,r*DY),(cc*DX,rr*DY)])
                    widths.append(0.5+1.9*min(1,(ac[r,c]/6e6)**0.45))
    # Each river path runs from a source/junction to the next junction or window exit.
    active=ac.ravel()>=threshold;rc=receiver.ravel();indeg=np.zeros(H*W,int)
    for i in np.flatnonzero(active):
        if rc[i]>=0 and active[rc[i]]:indeg[rc[i]]+=1
    for i in np.flatnonzero(active & (indeg!=1)):
        path=[int(i)];j=int(rc[i]);seen={int(i)}
        while j>=0 and j not in seen:
            path.append(j);seen.add(j)
            if not active[j] or indeg[j]!=1:break
            j=int(rc[j])
        if len(path)>1:rivers.append({'cell_indices':path,'xy_m':[[round((q%W)*DX,3),round((q//W)*DY,3)] for q in path],'start_area_km2':round(float(ac.ravel()[i]/1e6),5)})
    for river in rivers:river['display_xy_m']=smooth_path(river['xy_m'])
    stats={'seed':args.seed,'erosion_steps':args.steps,'elapsed_seconds':round(time.monotonic()-start,2),'relief_m':float(crop.max()-crop.min()),'height_min_m':float(crop.min()),'height_max_m':float(crop.max()),'slope_median_p95':np.percentile(np.hypot(*np.gradient(crop,DY,DX)),[50,95]).tolist(),'river_threshold_km2':threshold/1e6,'river_segments':len(segments),'river_paths':len(rivers),'max_upstream_area_km2':float(ac.max()/1e6),'routing_fill_p95_m':float(np.percentile((filled-z)[pad:pad+H,pad:pad+W],95))}
    data={'recipe':'shape-first-eroded-hills-v1','dimensions':{'width':W,'height':H,'extent_x_m':LX,'extent_y_m':LY,'row_zero':'south','dx_m':DX,'dy_m':DY},'height_m':np.round(crop,5).tolist(),'flow_accumulation_m2':np.round(ac,2).tolist(),'receiver_index':receiver.tolist(),'flow_vector_m':np.round(flow,5).tolist(),'river_paths':rivers,'stats':stats}
    (out/'terrain-rivers.json').write_text(json.dumps(data,separators=(',',':')))
    candidate={'schema':'shape-first-candidate@1','seed':args.seed,'name':'Eroded hills','recipe':'shape-first-eroded-hills-v1','grid':{'columns':W,'rows':H,'cellSizeM':DX,'cellSizeYM':DY,'row0':'north','yDirection':'south'},'elevation':np.round(crop[::-1],5).ravel().tolist(),'flowAccumulationM2':np.round(ac[::-1],2).ravel().tolist(),'rivers':[[{'xM':point[0],'yM':round(LY-point[1],3)} for point in river['display_xy_m']] for river in rivers],'stats':stats}
    (out/'candidate.json').write_text(json.dumps(candidate,separators=(',',':')))
    np.savez_compressed(out/'terrain-rivers.npz',height_m=crop,flow_accumulation_m2=ac,receiver_index=receiver,flow_vector_m=flow,x_m=np.linspace(0,LX,W),y_m=np.linspace(0,LY,H))
    (out/'metrics.json').write_text(json.dumps(stats,indent=2));print(json.dumps(stats,indent=2),flush=True)
    cmap=LinearSegmentedColormap.from_list('earth',['#c4d3b3','#a4bc8d','#899d72','#b4ae88','#d2c6a7'])
    up=zoom(crop,4,order=3);norm=(up-crop.min())/np.ptp(crop);rgb=cmap(norm)[:,:,:3]
    hill=LightSource(315,42).hillshade(up,vert_exag=5,dx=DX/4,dy=DY/4)
    rgb=np.clip(rgb*(0.52+0.64*hill[...,None]),0,1)
    for name,overlay in [('terrain-preview.png',False),('terrain-rivers-preview.png',True)]:
        fig,ax=plt.subplots(figsize=(11.0,11.3),facecolor='#f5f2e9');fig.subplots_adjust(left=.08,right=.96,bottom=.075,top=.905)
        ax.imshow(rgb,origin='lower',extent=[0,LX/1000,0,LY/1000],interpolation='bilinear')
        if overlay:
            lines=[np.asarray(river['display_xy_m'])/1000 for river in rivers]
            widths=[0.5+1.9*min(1,(river['start_area_km2']/6)**.45) for river in rivers]
            ax.add_collection(LineCollection(lines,colors='#e0f0e5',linewidths=np.array(widths)+1.1,alpha=.68,zorder=4))
            ax.add_collection(LineCollection(lines,colors='#1b6378',linewidths=widths,alpha=.94,zorder=5))
        ax.set_aspect('equal');ax.set_xlabel('East / km');ax.set_ylabel('North / km');ax.spines[['top','right']].set_visible(False)
        fig.text(.08,.957,'ERODED HILLS / SHAPE FIRST',fontsize=20,fontweight='bold',color='#243d39');fig.text(.08,.928,'Terrain evolves first. Watersheds and river branches are read from its slopes.',fontsize=11,color='#4b5d52')
        fig.text(.08,.029,f'8.85 × 9.77 km  •  161 × 129 samples  •  seed {args.seed}  •  {args.steps} erosion steps',fontsize=10,color='#526254')
        fig.savefig(out/name,dpi=200,facecolor=fig.get_facecolor());plt.close(fig)
    # Neutral grayscale preview for fair morphology comparisons.
    fig,ax=plt.subplots(figsize=(8.85,9.77));ax.imshow(LightSource(315,40).hillshade(crop,vert_exag=4,dx=DX,dy=DY),origin='lower',cmap='gray',extent=[0,LX,0,LY]);ax.axis('off');fig.subplots_adjust(0,0,1,1);fig.savefig(out/'hillshade.png',dpi=160);plt.close(fig)
if __name__=='__main__':main()
