from pathlib import Path
import json,hashlib
import numpy as np
from osgeo import gdal
from scipy.interpolate import RegularGridInterpolator
P=Path(__file__).resolve().parent
p=json.loads((P/'provenance.json').read_text());raw=P/p['rawFile'];checks={}
checks['rawHashMatches']=hashlib.sha256(raw.read_bytes()).hexdigest()==p['rawSHA256']
a=gdal.Open(str(raw));z=a.ReadAsArray().astype(float);g=a.GetGeoTransform();mask=a.GetRasterBand(1).GetMaskBand().ReadAsArray();checks['allPixelsFiniteValid']=bool(np.isfinite(z).all() and (mask==255).all());checks['actualGridMatchesProvenance']=list(g)==p['exportGrid']['geoTransform'] and list(z.shape)==p['exportGrid']['shape']
sx=g[0]+(np.arange(a.RasterXSize)+.5)*g[1];sy=g[3]+(np.arange(a.RasterYSize)+.5)*g[5];grid=np.load(P/'actual-target-grid.npz');x,y=np.meshgrid(grid['x_utm18n_m'],grid['y_utm18n_m']);interp=RegularGridInterpolator((sy[::-1],sx),z[::-1],bounds_error=True);reference=interp(np.stack([y,x],axis=-1));checks['interpolationExactlyMatchesSaved']=bool(np.array_equal(reference,grid['elevation_m']));checks['noExtrapolation']=bool(x.min()>sx.min() and x.max()<sx.max() and y.min()>sy.min() and y.max()<sy.max());checks['nativeFinerThanTarget']=max(p['sourceNativeSpacingMAtCenter'])<min(p['targetGrid']['cellSizeM'],p['targetGrid']['cellSizeYM']);checks['downloadUnder20MB']=p['downloadBytes']<20000000
for path in P.glob('*/comparison.json'):
 c=json.loads(path.read_text());checks[path.parent.name+'RawIdentity']=c['rawSHA256']==p['rawSHA256'];checks[path.parent.name+'AreaClosure']=all(abs(s[n]['metrics']['outletAreaSumKm2']-s['pointExtentM'][0]*s['pointExtentM'][1]/1e6)<1e-8 for s in c['stages'] for n in ['real','generated']);checks[path.parent.name+'FineArrayIdentity']=bool(np.array_equal(np.array(c['stages'][-1]['real']['elevation']).reshape(reference.shape),reference))
result={'passed':all(checks.values()),'checks':checks};(P/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));assert result['passed']
