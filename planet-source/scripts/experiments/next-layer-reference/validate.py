from pathlib import Path
import json,hashlib
import numpy as np
from scipy.interpolate import RegularGridInterpolator
from osgeo import gdal
from diagnostic import stats
P=Path(__file__).resolve().parent;p=json.loads((P/'provenance.json').read_text());s=json.loads((P/'summary.json').read_text());a=np.load(P/'comparison-arrays.npz');checks={}
sha=lambda q:hashlib.sha256(q.read_bytes()).hexdigest()
checks['candidateHash']=sha((P/p['candidateFile']))==p['candidateSHA256'];checks['rawHash']=sha(P/p['rawFile'])==p['rawSHA256']
ds=gdal.Open(str(P/p['rawFile']));z=ds.ReadAsArray().astype(float);gt=ds.GetGeoTransform();sx=gt[0]+(np.arange(z.shape[1])+.5)*gt[1];sy=gt[3]+(np.arange(z.shape[0])+.5)*gt[5];interp=RegularGridInterpolator((sy[::-1],sx),z[::-1],bounds_error=True)
b=json.loads((P/p['candidateFile']).read_text())
for r,src in zip(s,[b['cut']['context'],b['context']]):
 n=r['name'];g=r['grid'];dx=g['cellSizeM'];dy=g.get('cellSizeYM',dx);x,y=np.meshgrid(a[n+'_x_utm18n_m'],a[n+'_y_utm18n_m']);real=interp(np.stack([y,x],-1))
 checks[n+'ExactInterpolation']=np.array_equal(real,a[n+'_real_elevation_m']);checks[n+'CandidateArrayExact']=np.array_equal(np.array(src['elevation']).reshape(real.shape),a[n+'_generated_elevation_m'])
 checks[n+'SourcePixelCoordinatesExact']=np.array_equal((x-gt[0])/gt[1]-.5,a[n+'_source_export_columns']) and np.array_equal((y-gt[3])/gt[5]-.5,a[n+'_source_export_rows'])
 checks[n+'SpacingExactWithinFloatingPrecision']=np.allclose(np.diff(x[0]),dx,rtol=0,atol=1e-9) and np.allclose(np.diff(y[:,0]),-dy,rtol=0,atol=1e-9)
 for f in ['real','generated']:
  met,slope,rec,area=stats(a[n+'_'+f+'_elevation_m'],dx,dy)
  checks[n+f+'MetricsExact']=met==r[f]
  checks[n+f+'ArraysExact']=np.array_equal(slope,a[n+'_'+f+'_slope_degrees']) and np.array_equal(rec.reshape(real.shape),a[n+'_'+f+'_receiver']) and np.array_equal(area.reshape(real.shape),a[n+'_'+f+'_area_km2'])
checks={k:bool(v) for k,v in checks.items()};out={'passed':all(checks.values()),'checks':checks};(P/'independent-validation.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2));assert out['passed']
