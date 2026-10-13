"""Reproducible same-footprint comparison; no terrain synthesis or generator changes."""
from pathlib import Path
import csv, gzip, hashlib, json, math, heapq, shutil, sys
import numpy as np
from scipy.interpolate import RegularGridInterpolator
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
P=Path(__file__).resolve().parent
BASE=P
reference=sys.argv[1] if len(sys.argv)>1 else 'apennines'
P=BASE/reference;P.mkdir(exist_ok=True)
bridge_path=BASE/'generated-bridge.json'
storage=json.loads((BASE/'generated-bridge-storage.json').read_text())
chunks=[]
for part in storage['parts']:
 chunk=(BASE/part['file']).read_bytes()
 assert len(chunk)==part['bytes'] and hashlib.sha256(chunk).hexdigest()==part['sha256']
 chunks.append(chunk)
compressed=b''.join(chunks)
assert len(compressed)==storage['compressedBytes'] and hashlib.sha256(compressed).hexdigest()==storage['compressedSha256']
bridge_bytes=gzip.decompress(compressed)
assert len(bridge_bytes)==storage['uncompressedBytes'] and hashlib.sha256(bridge_bytes).hexdigest()==storage['uncompressedSha256']
b=json.loads(bridge_bytes)
raw=BASE/('raw/etopo-paris.csv' if reference=='paris' else 'raw/etopo-tuscany-apennines.csv'); provenance=json.loads((BASE/('raw/paris-provenance.json' if reference=='paris' else 'raw/provenance.json')).read_text())
assert hashlib.sha256(raw.read_bytes()).hexdigest()==provenance['sha256']
a=np.loadtxt(raw,delimiter=',',skiprows=2); lat=np.unique(a[:,0]);lon=np.unique(a[:,1]);z=np.empty((len(lat),len(lon)))
for la,lo,v in a:z[np.searchsorted(lat,la),np.searchsorted(lon,lo)]=v
R=6371000.;lat0=provenance['predeterminedCenterLatitude'];lon0=provenance['predeterminedCenterLongitude'];rad=np.pi/180
sx=(lon-lon0)*rad*R*np.cos(lat0*rad);sy=(lat-lat0)*rad*R
interp=RegularGridInterpolator((sy,sx),z,bounds_error=True)

def drainage(z,dx,dy):
 h,w=z.shape;n=z.size;filled=z.copy().ravel();seen=np.zeros(n,bool);parent=np.full(n,-1,int);heap=[]
 dirs=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
 for y in range(h):
  for x in range(w):
   if y in (0,h-1) or x in (0,w-1):
    i=y*w+x;seen[i]=True;heapq.heappush(heap,(filled[i],i))
 while heap:
  v,i=heapq.heappop(heap);y,x=divmod(i,w)
  for oy,ox in dirs:
   yy,xx=y+oy,x+ox
   if 0<=yy<h and 0<=xx<w:
    j=yy*w+xx
    if not seen[j]:
     seen[j]=True;parent[j]=i;filled[j]=max(v,filled[j]);heapq.heappush(heap,(filled[j],j))
 rec=parent.copy()
 for y in range(1,h-1):
  for x in range(1,w-1):
   i=y*w+x;best=0
   for oy,ox in dirs:
    j=(y+oy)*w+x+ox;s=(filled[i]-filled[j])/math.hypot(ox*dx,oy*dy)
    if s>best:best=s;rec[i]=j
 weight=np.ones((h,w));weight[[0,-1],:]*=.5;weight[:,[0,-1]]*=.5
 area=weight.ravel()*dx*dy/1e6;ind=np.bincount(rec[rec>=0],minlength=n);queue=list(np.where(ind==0)[0]);count=0
 while queue:
  i=queue.pop();count+=1;j=rec[i]
  if j>=0:
   area[j]+=area[i];ind[j]-=1
   if ind[j]==0:queue.append(j)
 assert count==n
 assert abs(area[rec<0].sum()-dx*dy*(w-1)*(h-1)/1e6)<1e-7
 return rec,area,filled-z.ravel()

def stats(z,dx,dy):
 gy,gx=np.gradient(z,dy,dx);slope=np.degrees(np.arctan(np.hypot(gx,gy)))
 rec,area,fill=drainage(z,dx,dy);h,w=z.shape
 edges=np.where((area>=100)&(rec>=0))[0]
 lens=[math.hypot((i%w-rec[i]%w)*dx,(i//w-rec[i]//w)*dy)/1000 for i in edges]
 d={'elevationMinM':float(z.min()),'elevationMaxM':float(z.max()),'reliefM':float(np.ptp(z)),'elevationP05P95M':np.percentile(z,[5,95]).tolist(),'slopeMedianDegrees':float(np.median(slope)),'slopeP95Degrees':float(np.percentile(slope,95)),'atOrBelowZeroNodes':int((z<=0).sum()),'nodeCount':z.size,'fillMaxM':float(fill.max()),'fillPositiveNodes':int((fill>1e-8).sum()),'channelAreaThresholdKm2':100,'channelLengthKm':sum(lens),'channelLinks':len(edges),'maxContributingAreaKm2':float(area.max()),'outletAreaSumKm2':float(area[rec<0].sum())}
 return d,rec,area

stages=[]
for k,s in enumerate([{'surface':b['parent']['context']},*b['stages']]):
 g=s['surface']['grid'];w=g['columns'];h=g['rows'];dx=g['cellSizeM'];dy=g.get('cellSizeYM',dx);width=(w-1)*dx;height=(h-1)*dy
 x=np.linspace(-width/2,width/2,w);y=np.linspace(height/2,-height/2,h);xx,yy=np.meshgrid(x,y)
 real=interp(np.stack([yy,xx],axis=-1));gen=np.array(s['surface']['elevation']).reshape(h,w)
 ds={'stage':k,'grid':g,'widthM':width,'heightM':height}
 for name,zz in [('real',real),('generated',gen)]:
  met,rec,area=stats(zz,dx,dy);ds[name]={'elevation':zz.ravel().tolist(),'metrics':met,'receiver':rec.tolist(),'contributingAreaKm2':area.tolist()}
 stages.append(ds)
selection=[0,3,len(stages)-1];lo=min(min(s[k]['elevation']) for s in stages for k in ['real','generated']);hi=max(max(s[k]['elevation']) for s in stages for k in ['real','generated'])
lo,hi=-100,1700
fig,ax=plt.subplots(3,2,figsize=(10,14),layout='constrained')
for row,idx in enumerate(selection):
 s=stages[idx];g=s['grid'];w=g['columns'];h=g['rows'];ext=[-s['widthM']/2000,s['widthM']/2000,-s['heightM']/2000,s['heightM']/2000]
 for col,name in enumerate(['real','generated']):
  zz=np.array(s[name]['elevation']).reshape(h,w);im=ax[row,col].pcolormesh(np.linspace(ext[0],ext[1],w),np.linspace(ext[3],ext[2],h),zz,vmin=lo,vmax=hi,cmap='terrain',shading='nearest');ax[row,col].set(xlim=ext[:2],ylim=ext[2:],aspect='equal');ax[row,col].set_title(f"{'ETOPO real reference' if col==0 else 'Generated bridge'} | {w} x {h} nodes\nspacing {g['cellSizeM']/1000:.2f} x {g.get('cellSizeYM',g['cellSizeM'])/1000:.2f} km");ax[row,col].set_xlabel('East (km)');ax[row,col].set_ylabel('North (km)')
fig.colorbar(im,ax=ax,shrink=.55,label='Elevation (m), shared absolute scale')
fig.suptitle('Same physical footprint, actual arrays at three stages\nPoint samples; bilinear real-data interpolation adds no surveyed detail',fontsize=14)
fig.savefig(P/'same-scale-stages.png',dpi=170);plt.close(fig)
s=stages[-1];g=s['grid'];w=g['columns'];h=g['rows'];x=np.linspace(-s['widthM']/2000,s['widthM']/2000,w);y=np.linspace(s['heightM']/2000,-s['heightM']/2000,h)
fig,ax=plt.subplots(1,2,figsize=(11,8),layout='constrained')
for col,name in enumerate(['real','generated']):
 zz=np.array(s[name]['elevation']).reshape(h,w);im=ax[col].pcolormesh(x,y,zz,vmin=lo,vmax=hi,cmap='terrain',shading='nearest');ax[col].set(xlim=ext[:2],ylim=ext[2:],aspect='equal');rec=np.array(s[name]['receiver']);area=np.array(s[name]['contributingAreaKm2']);ids=np.where((area>=100)&(rec>=0))[0];seg=[[(x[i%w],y[i//w]),(x[rec[i]%w],y[rec[i]//w])] for i in ids];ax[col].add_collection(LineCollection(seg,colors='#005bc8',linewidths=.8));ax[col].set_title(('Real reference' if col==0 else 'Generated bridge')+f"\nrelief {s[name]['metrics']['reliefM']:.0f} m");ax[col].set_xlabel('East (km)');ax[col].set_ylabel('North (km)')
fig.colorbar(im,ax=ax,shrink=.65,label='Elevation (m), shared absolute scale');fig.suptitle('Same D8 priority-flood drainage diagnostic\nBlue: contributing area >=100 km²; computed proxy, not mapped rivers',fontsize=14);fig.savefig(P/'same-scale-drainage.png',dpi=170)
if reference=='paris':
 for aa in ax:
  aa.collections[0].set_clim(0,250)
 fig.suptitle('Lowland-context comparison: shared 0–250 m color range\nSame dimensions and unmodified heights; D8 proxy area >=100 km²',fontsize=14)
 fig.savefig(P/'lowland-detail.png',dpi=170)
plt.close(fig)
provenance.update(metricMethod=f'Local spherical tangent coordinates R=6371000 m; x=R*cos({lat0}deg)*(lon-{lon0}deg), y=R*(lat-{lat0}deg), radians. No fitted scaling or vertical change.',metricCropCenter={'latitude':lat0,'longitude':lon0},metricCropSizeM=[width,height],metricCropBboxDegrees=[lon0-width/2/(R*rad*np.cos(lat0*rad)),lat0-height/2/(R*rad),lon0+width/2/(R*rad*np.cos(lat0*rad)),lat0+height/2/(R*rad)],queriedSpacingM=[float(np.diff(sx).mean()),float(np.diff(sy).mean())],nativeNominalSpacingM=[float(np.diff(sx).mean()/3),float(np.diff(sy).mean()/3)],sourceShape=[len(lat),len(lon)],sourceHasNegativeElevation=bool((z<0).any()),generatedSourceSha256=hashlib.sha256(bridge_bytes).hexdigest(),generatedSourceFile='generated-bridge.json')
(P/'provenance.json').write_text(json.dumps(provenance,indent=2))
(P/'comparison.json').write_text(json.dumps({'schema':'same-scale-broad-real@1','source':provenance,'stages':stages}))
summary=[{k:v for k,v in s.items() if k not in ('real','generated')}|{n:s[n]['metrics'] for n in ('real','generated')} for s in stages]
(P/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
