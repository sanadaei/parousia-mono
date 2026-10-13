"""Compare actual input heights with one predetermined DEM; no generator modifications."""
from pathlib import Path
import json,hashlib,sys,heapq,math,ast
import numpy as np
from scipy.interpolate import RegularGridInterpolator
from osgeo import gdal
from pyproj import Transformer,Geod,Proj
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
P=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
request=json.loads((P/'request.json').read_text());src=P/'raw/usgs13-maryland-10m.tif';ds=gdal.Open(str(src));z=ds.ReadAsArray().astype(float);gt=ds.GetGeoTransform();mask=ds.GetRasterBand(1).GetMaskBand().ReadAsArray();assert np.isfinite(z).all() and np.all(mask==255)
sx=gt[0]+(np.arange(ds.RasterXSize)+.5)*gt[1];sy=gt[3]+(np.arange(ds.RasterYSize)+.5)*gt[5]
interp=RegularGridInterpolator((sy[::-1],sx),z[::-1],bounds_error=True)
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
def stats(a,dx,dy):
 gy,gx=np.gradient(a,dy,dx);slope=np.degrees(np.arctan(np.hypot(gx,gy)));rec,area,fill=drainage(a,dx,dy)
 interior=a[1:-1,1:-1]; lower=np.zeros(interior.shape,bool)
 for oy,ox in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]:
  lower |= a[1+oy:a.shape[0]-1+oy,1+ox:a.shape[1]-1+ox] < interior
 return dict(rawDirectD8InteriorNoLowerNeighborFraction=float(np.mean(~lower)), boundaryCondition='all perimeter nodes open; no inherited outlets or imports',minM=float(a.min()),maxM=float(a.max()),reliefM=float(np.ptp(a)),elevationP05P50P95M=np.percentile(a,[5,50,95]).tolist(),slopeP50P95Degrees=np.percentile(slope,[50,95]).tolist(),fillMaxM=float(fill.max()),fillP95M=float(np.percentile(fill,95)),fillPositiveFraction=float(np.mean(fill>1e-8)),outletAreaSumKm2=float(area[rec<0].sum()),maxContributingAreaKm2=float(area.max())),slope,rec,area
candidate=Path(sys.argv[1]) if len(sys.argv)>1 else P/'selected-input.json'
label=sys.argv[2] if len(sys.argv)>2 else 'reproduced';out=P/label;out.mkdir(exist_ok=True)
b=json.loads(candidate.read_text());xc,yc=request['centerUTM18N'];stages=[]
for i,s in enumerate([{'surface':b['cut']['context']},*b['stages']]):
 s=s['surface'];g=s['grid'];w=g['columns'];h=g['rows'];dx=g['cellSizeM'];dy=g.get('cellSizeYM',dx);width=(w-1)*dx;height=(h-1)*dy
 xx=xc+np.linspace(-width/2,width/2,w);yy=yc+np.linspace(height/2,-height/2,h);x,y=np.meshgrid(xx,yy);a=interp(np.stack([y,x],axis=-1));gen=np.asarray(s['elevation']).reshape(h,w)
 row=dict(stage=i,grid=g,pointExtentM=[width,height],sourceSupportMarginsM=[xx.min()-sx.min(),sx.max()-xx.max(),yy.min()-sy.min(),sy.max()-yy.max()])
 for name,zz in [('real',a),('generated',gen)]:
  met,slope,rec,area=stats(zz,dx,dy);row[name]=dict(elevation=zz.ravel().tolist(),metrics=met,receiver=rec.tolist(),contributingAreaKm2=area.tolist())
 stages.append(row)
last=stages[-1];g=last['grid'];w=g['columns'];h=g['rows'];extent=[-width/2000,width/2000,-height/2000,height/2000]
fig,axes=plt.subplots(2,2,figsize=(11,10),layout='constrained')
for col,name in enumerate(['real','generated']):
 a=np.array(last[name]['elevation']).reshape(h,w);_,slope,rec,area=stats(a,dx,dy)
 im=axes[0,col].pcolormesh((xx-xc)/1000,(yy-yc)/1000,a,cmap='terrain',vmin=0,vmax=200,shading='nearest');sm=axes[1,col].pcolormesh((xx-xc)/1000,(yy-yc)/1000,slope,cmap='magma',vmin=0,vmax=20,shading='nearest')
 axes[0,col].set_title(('USGS Maryland reference' if name=='real' else f'Generated {label}')+' | actual heights')
 axes[1,col].set_title('Slope of the same input heights')
 for ax in axes[:,col]:ax.set(xlabel='Projected east (km)',ylabel='Projected north (km)',aspect='equal',xlim=extent[:2],ylim=extent[2:])
fig.colorbar(im,ax=axes[0],label='Elevation m; shared 0–200 scale');fig.colorbar(sm,ax=axes[1],label='Slope degrees; shared 0–20 scale');fig.suptitle('Same 8.85 × 9.77 km footprint, 161 × 129 nodes\nNo vertical fitting; descriptive diagnostic, not morphological validation')
fig.savefig(out/'actual-height-comparison.png',dpi=160);plt.close(fig)
summary=[{k:v for k,v in s.items() if k not in ['real','generated']}|{n:s[n]['metrics'] for n in ['real','generated']} for s in stages]
(out/'summary.json').write_text(json.dumps(summary,indent=2));(out/'comparison.json').write_text(json.dumps(dict(schema='same-scale-fine-real@1',candidateFile=str(candidate),candidateSHA256=sha(candidate),rawSHA256=sha(src),stages=stages)))
print(json.dumps(summary[-1],indent=2))
# Preserve actual node coordinates, not just requested dimensions.
np.savez_compressed(P/'actual-target-grid.npz',x_utm18n_m=xx,y_utm18n_m=yy,elevation_m=np.array(last['real']['elevation']).reshape(h,w))
to_ll=Transformer.from_crs(32618,4326,always_xy=True);ll=[to_ll.transform(X,Y) for X,Y in [(xx[0],yy[0]),(xx[-1],yy[0]),(xx[0],yy[-1]),(xx[-1],yy[-1])]];geo=Geod(ellps='WGS84');d=1/10800;native=[geo.inv(-77.1-d/2,39.1,-77.1+d/2,39.1)[2],geo.inv(-77.1,39.1-d/2,-77.1,39.1+d/2)[2]]
cat=json.loads((P/'raw/catalog.json').read_text());selected=next(f for f in cat['features'] if f['attributes']['OBJECTID']==5276)
provenance=dict(schema='fine-real-provenance@1',selection='Center and modest rolling-hill class predetermined before elevation download; no outcome search.',centerLonLat=[-77.1,39.1],source=selected['attributes'],sourceFootprint=selected['geometry'],sourceNativeSpacingMAtCenter=native,sourceNativeArcSeconds=1/3,rawFile=str(src.relative_to(P)),rawSHA256=sha(src),downloadBytes=src.stat().st_size,exportGrid=dict(shape=list(z.shape),geoTransform=list(gt),epsg=32618,units='metres',nodata=ds.GetRasterBand(1).GetNoDataValue(),allPixelsValid=bool(np.all(mask==255))),targetGrid=g,targetPointExtentM=[width,height],targetCornerLonLat=ll,targetSupportMarginsM=last['sourceSupportMarginsM'],targetGeodesicTopAndLeftLengthM=[geo.inv(*ll[0],*ll[1])[2],geo.inv(*ll[0],*ll[2])[2]],method='Service bilinear resampling of locked 1/3-arc-second DEM to 10 m Float32 UTM; local bilinear point sampling at exact generated grid spacings. Projected metres retained; geodesic discrepancy disclosed. No vertical offset, fitted amplitude, fill of source NoData, or extrapolation.',waterDiagnostic='Same independent priority-flood and D8, all perimeter nodes open on both fields, uniform unit runoff, no inherited fixed outlets, imported flows or climate fields; reports contributing area and fill burden, not mapped rivers.',limitations=['One predetermined suburban Maryland Piedmont reference, not an ensemble or pristine landscape. Bare-earth product can retain roads, embankments, grading and drainage engineering.','Regional Piedmont setting supported by MGS; exact local landform class and match to fictional generated class not independently verified. No morphology ranking permitted.','NAVD88 real absolute elevations versus fictional generated datum; no elevation equality expected.','Bilinear point downsampling is not an area-average or anti-aliasing filter; subgrid features may alias.','10 m export grid does not imply new 10 m surveyed information beyond native 1/3-arc-second DEM; service source overviews are not separately documented.'],permissions='USGS states 3DEP products are free of charge and without use restrictions.',sources=['https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer','https://www.usgs.gov/3d-elevation-program/about-3dep-products-services','https://www.usgs.gov/faqs/what-types-elevation-datasets-are-available-what-formats-do-they-come-and-where-can-i-download','https://developers.arcgis.com/rest/services-reference/enterprise/export-image/','https://developers.arcgis.com/rest/services-reference/enterprise/mosaic-rules/','https://www.mgs.md.gov/geology/physiographic_map.html','https://www.mgs.md.gov/geology/EarthMRI_PotomacTerrane.html'])
(P/'provenance.json').write_text(json.dumps(provenance,indent=2))
