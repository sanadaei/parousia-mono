"""Predetermined same-scale real comparison, outside generator repository."""
from pathlib import Path
import json,hashlib,sys
import numpy as np
from osgeo import gdal,ogr
from scipy.interpolate import RegularGridInterpolator
from pyproj import Transformer,Geod
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from diagnostic import stats
P=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
src=P/'../fine-real-reference/raw/usgs13-maryland-10m.tif';up=json.loads((P/'../fine-real-reference/provenance.json').read_text());req=json.loads((P/'../fine-real-reference/request.json').read_text());identity=json.loads((P/'input-provenance.json').read_text())
assert sha(src)==up['rawSHA256']
ds=gdal.Open(str(src));z=ds.ReadAsArray().astype(float);gt=ds.GetGeoTransform();mask=ds.GetRasterBand(1).GetMaskBand().ReadAsArray();assert np.isfinite(z).all() and (mask==255).all()
sx=gt[0]+(np.arange(z.shape[1])+.5)*gt[1];sy=gt[3]+(np.arange(z.shape[0])+.5)*gt[5];interp=RegularGridInterpolator((sy[::-1],sx),z[::-1],bounds_error=True)
candidate=Path(sys.argv[1]) if len(sys.argv)>1 else P/'compared-input.json'
assert sha(candidate)==identity['compactSHA256']
b=json.loads(candidate.read_text());xc,yc=req['centerUTM18N'];surfaces=[('parent',b['cut']['context']),('child',b['context'])]
arrays={};result=[];checks={};native=up['sourceNativeSpacingMAtCenter'];ll=Transformer.from_crs(32618,4326,always_xy=True);merc=Transformer.from_crs(32618,3857,always_xy=True)
ring=ogr.Geometry(ogr.wkbLinearRing)
for x,y in up['sourceFootprint']['rings'][0]:ring.AddPoint(x,y)
poly=ogr.Geometry(ogr.wkbPolygon);poly.AddGeometry(ring)
for name,s in surfaces:
 g=s['grid'];w=g['columns'];h=g['rows'];dx=g['cellSizeM'];dy=g.get('cellSizeYM',dx);width=(w-1)*dx;height=(h-1)*dy
 xx=xc+np.linspace(-width/2,width/2,w);yy=yc+np.linspace(height/2,-height/2,h);x,y=np.meshgrid(xx,yy);real=interp(np.stack([y,x],-1));gen=np.asarray(s['elevation']).reshape(h,w)
 col=(x-gt[0])/gt[1]-.5;row=(y-gt[3])/gt[5]-.5
 margins=[x.min()-sx.min(),sx.max()-x.max(),y.min()-sy.min(),sy.max()-y.max()]
 corners=[(xx[0],yy[0]),(xx[-1],yy[0]),(xx[0],yy[-1]),(xx[-1],yy[-1])];cornersll=[ll.transform(*p) for p in corners]
 inside=[]
 for p in corners:
  a,c=merc.transform(*p);q=ogr.Geometry(ogr.wkbPoint);q.AddPoint(a,c);inside.append(bool(poly.Contains(q)))
 checks[name+'NativeFinerThanTarget']=max(native)<min(dx,dy)
 checks[name+'WithinLockedSourceFootprint']=all(inside)
 checks[name+'ExportSupportNoExtrapolation']=min(margins)>0
 checks[name+'ArraysFinite']=bool(np.isfinite(gen).all() and np.isfinite(real).all())
 rowinfo=dict(name=name,grid=g,pointExtentM=[width,height],areaKm2=width*height/1e6,sourceSupportMarginsM=margins,sourceExportPixelCenterCoordinates={'columnsMinMax':[float(col.min()),float(col.max())],'rowsMinMax':[float(row.min()),float(row.max())]},targetCornerLonLat=cornersll)
 geo=Geod(ellps='WGS84');rowinfo['geodesicTopAndLeftM']=[geo.inv(*cornersll[0],*cornersll[1])[2],geo.inv(*cornersll[0],*cornersll[2])[2]]
 for field,a in [('real',real),('generated',gen)]:
  met,slope,rec,area=stats(a,dx,dy);rowinfo[field]=met
  checks[name+field+'AreaClosure']=abs(met['outletAreaSumKm2']-width*height/1e6)<1e-9
  prefix=name+'_'+field
  arrays[prefix+'_elevation_m']=a;arrays[prefix+'_slope_degrees']=slope;arrays[prefix+'_receiver']=rec.reshape(h,w);arrays[prefix+'_area_km2']=area.reshape(h,w)
 arrays[name+'_x_utm18n_m']=xx;arrays[name+'_y_utm18n_m']=yy;arrays[name+'_source_export_columns']=col;arrays[name+'_source_export_rows']=row
 result.append(rowinfo)
checks['SameParentChildExtent']=np.array_equal(result[0]['pointExtentM'],result[1]['pointExtentM'])
checks['RealChildCoincidentParentNodesExact']=np.array_equal(arrays['parent_real_elevation_m'],arrays['child_real_elevation_m'][::2,::2])
checks['GeneratedChildCoincidentParentNodesExact']=np.array_equal(arrays['parent_generated_elevation_m'],arrays['child_generated_elevation_m'][::2,::2])
checks['RawHashMatchesRetained']=sha(src)==up['rawSHA256'];checks['RawAllPixelsFiniteValid']=bool(np.isfinite(z).all() and (mask==255).all())
np.savez_compressed(P/'comparison-arrays.npz',**arrays)
# Bounds computed jointly, not fitted independently. Actual absolute elevations retained.
cols=[('child','real','USGS fixed Maryland reference'),('parent','generated','Generated parent crop (actual nodes)'),('child','generated','Generated child (actual nodes)')]
lo=min(arrays[a+'_'+b+'_elevation_m'].min() for a,b,_ in cols);hi=max(arrays[a+'_'+b+'_elevation_m'].max() for a,b,_ in cols);smax=max(arrays[a+'_'+b+'_slope_degrees'].max() for a,b,_ in cols)
vmin=float(np.floor(lo/10)*10);vmax=float(np.ceil(hi/10)*10);smax=float(np.ceil(smax/5)*5)
fig,ax=plt.subplots(2,3,figsize=(14,9),layout='constrained')
for j,(n,f,title) in enumerate(cols):
 xx=(arrays[n+'_x_utm18n_m']-xc)/1000;yy=(arrays[n+'_y_utm18n_m']-yc)/1000
 im=ax[0,j].pcolormesh(xx,yy,arrays[n+'_'+f+'_elevation_m'],cmap='terrain',vmin=vmin,vmax=vmax,shading='nearest')
 sm=ax[1,j].pcolormesh(xx,yy,arrays[n+'_'+f+'_slope_degrees'],cmap='magma',vmin=0,vmax=smax,shading='nearest')
 ax[0,j].set_title(title,fontsize=10);ax[1,j].set_title('Slope from actual height nodes',fontsize=10)
 for aa in ax[:,j]:aa.set(xlabel='Projected east / domain x (km)',ylabel='Projected north / domain -y (km)',aspect='equal',xlim=[-width/2000,width/2000],ylim=[-height/2000,height/2000])
fig.colorbar(im,ax=ax[0],label=f'Absolute elevation m; shared {vmin:g}–{vmax:g}')
fig.colorbar(sm,ax=ax[1],label=f'Slope degrees; shared 0–{smax:g}')
fig.suptitle(f'Same {width/1000:.6f} × {height/1000:.6f} km footprint | fixed reference center 39.1 N, 77.1 W\nParent 37×27 nodes; reference and child 73×53 nodes. No vertical fit; descriptive, not class validation.',fontsize=12)
fig.savefig(P/'actual-height-comparison.png',dpi=160);plt.close(fig)
provenance=dict(schema='next-local-real-reference@1',candidateFile=candidate.name,candidateSHA256=sha(candidate),fullCandidateSHA256=identity['fullCandidateSHA256'],fullCandidateCanonicalContentHash=identity['fullCandidateCanonicalContentHash'],rawFile='../fine-real-reference/raw/usgs13-maryland-10m.tif',rawSHA256=sha(src),centerLonLat=[-77.1,39.1],centerUTM18N=[xc,yc],selection='Locked inherited reference center before observing child or sampling elevations; no outcome search.',sourceNativeSpacingMAtCenter=native,sourceNativeAngularSpacing=[up['source']['Resolution_X'],up['source']['Resolution_Y']],sourceNativeGridCoordinates='Not available from retained export: native raster pixel origin and indices were not retained. Export pixel-center coordinates are explicitly recorded; never presented as native indices.',sourceExport=dict(shape=list(z.shape),geoTransform=list(gt),epsg=32618,noData=ds.GetRasterBand(1).GetNoDataValue(),allPixelsValid=True),sourceObjectId=5276,upstreamProvenance='../fine-real-reference/provenance.json',sampling='Bilinear point sample from retained service-resampled 10m export; no extrapolation, NoData fill, vertical fitting or height injection into generator.',hydrology='Identical independent priority-flood / steepest D8 with all perimeter nodes open, area-weighted uniform unit runoff. No inherited outlets, imported upstream flow, climate, or generator routing head.',figureBounds=dict(elevationM=[vmin,vmax],slopeDegrees=[0,smax]),limitations=up['limitations']+['Parent and child have different resolutions on identical point extent; real DEM is evaluated at each exact resolution. Figure displays real at child resolution.','Generated axes are domain coordinates, not claimed real-world georeferencing.','All-open diagnostics are separate from inherited-outlet constrained generator metrics; no claim of class match.'])
checks={k:bool(v) for k,v in checks.items()}
(P/'provenance.json').write_text(json.dumps(provenance,indent=2));(P/'summary.json').write_text(json.dumps(result,indent=2));(P/'validation.json').write_text(json.dumps(dict(passed=all(checks.values()),checks=checks),indent=2));print(json.dumps(dict(summary=result,validation=checks),indent=2));assert all(checks.values())
