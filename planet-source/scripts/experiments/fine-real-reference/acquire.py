from pathlib import Path
import json,urllib.request,urllib.parse,hashlib,math
from pyproj import Transformer
P=Path(__file__).resolve().parent
b=json.load(open(P/'selected-input.json'));g=b['context']['grid'];w=(g['columns']-1)*g['cellSizeM'];h=(g['rows']-1)*g['cellSizeYM'];x,y=Transformer.from_crs(4326,32618,always_xy=True).transform(-77.1,39.1)
nx=math.ceil((w+80)/10);ny=math.ceil((h+80)/10)
bbox=[x-nx*5,y-ny*5,x+nx*5,y+ny*5]
p=dict(f='json',bbox=','.join(map(str,bbox)),bboxSR='32618',imageSR='32618',size=f'{nx},{ny}',format='tiff',pixelType='F32',interpolation='+RSP_BilinearInterpolation',renderingRule=json.dumps({'rasterFunction':'None'}),mosaicRule=json.dumps({'mosaicMethod':'esriMosaicLockRaster','lockRasterIds':[5276],'mosaicOperation':'MT_FIRST'}),adjustAspectRatio='false')
p['interpolation']='RSP_BilinearInterpolation'
u='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?'+urllib.parse.urlencode(p)
(P/'request.json').write_text(json.dumps(dict(url=u,parameters=p,predeterminedCenter=[-77.1,39.1],centerUTM18N=[x,y],targetGrid=g,pointExtentM=[w,h],sourceDownloadLimitBytes=20000000),indent=2))
a=urllib.request.urlopen(u,timeout=90).read();(P/'raw/export-response.json').write_bytes(a);r=json.loads(a);print(r)
if 'href' not in r:raise Exception('Export failed')
resp=urllib.request.urlopen(r['href'],timeout=90);data=resp.read(20000001);assert len(data)<=20000000
(P/'raw/usgs13-maryland-10m.tif').write_bytes(data);print('bytes',len(data),'sha256',hashlib.sha256(data).hexdigest())
