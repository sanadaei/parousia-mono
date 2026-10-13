import csv,json,hashlib,math
from pathlib import Path
p=Path(__file__).parent
raw=p/'data/tuscany.csv'; sha=hashlib.sha256(raw.read_bytes()).hexdigest()
assert sha=='eb3784fb884aeeddee74fd3f46abfeddf2c355db3c7c894d003b0d753e6a5dd1'
with raw.open() as f:
 r=csv.reader(f);next(r);next(r); a=[list(map(float,row)) for row in r]
lat=sorted(set(v[0] for v in a),reverse=True);lon=sorted(set(v[1] for v in a));assert len(lat)==len(lon)==121
lookup={(v[0],v[1]):v[2] for v in a};R=6371000;rad=math.pi/180
# Fixed metric grid at full-source mean latitude so every crop has EXACT same extent.
dx=R*rad*(lon[1]-lon[0])*math.cos(sum(lat)/len(lat)*rad);dy=R*rad*(lat[0]-lat[1])
full={'grid':{'columns':121,'rows':121,'cellSizeM':dx,'cellSizeYM':dy},'elevation':[lookup[(la,lo)] for la in lat for lo in lon]}
crops=[]
for name,x,y in [('NW',0,0),('NE',56,0),('SW',0,56),('SE',56,56),('C',28,28)]:
 crops.append({'name':name,'x0':x,'y0':y,'grid':{'columns':65,'rows':65,'cellSizeM':dx,'cellSizeYM':dy},'elevation':[lookup[(lat[j],lon[i])] for j in range(y,y+65) for i in range(x,x+65)],'bounds':{'north':lat[y],'south':lat[y+64],'west':lon[x],'east':lon[x+64]}})
obj={'schema':'real-dem-scale-inputs@1','rawSha256':sha,'source':'NOAA ETOPO2022 15 arcsecond terrain; not observed rivers','metricMethod':'Spherical approximation R6371000, dx at full-source mean latitude; no vertical normalization','full':full,'crops':crops,'factors':[2,4,8],'cropRule':'Five predetermined65x65 samples: four domain corners and center; equal physical extents; overlapping crops are not independent samples','fineInformation':'Every fine node is an actual raw source DEM value. Coarse values are nested decimations. Interpolation is only the no-new-information control.'}
(p/'data/inputs.json').write_text(json.dumps(obj));print(dx,dy)
