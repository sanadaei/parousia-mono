import json,hashlib,math
from pathlib import Path
p=Path(__file__).parent;s=json.loads((p/'results/summary.json').read_text());i=json.loads((p/'data/inputs.json').read_text())
assert hashlib.sha256((p/'data/tuscany.csv').read_bytes()).hexdigest()==i['rawSha256']==s['rawSha256']
checks=0
for row in s['results']:
 d=json.loads((p/f"results/case-{row['crop']}-f{row['factor']}.json").read_text());crop=next(c for c in i['crops'] if c['name']==row['crop']);assert d['elevation']==crop['elevation'];f=row['factor'];z=d['elevation'];w=65;cw=64//f+1
 assert d['parent']['elevation']==[z[y*f*w+x*f] for y in range(cw) for x in range(cw)]
 assert row['extentM']==[64*i['full']['grid']['cellSizeM'],64*i['full']['grid']['cellSizeYM']]
 endpoints={o['cell'] for o in d['reference']['outlets']}
 for name,r in {'reference':d['reference'],**d['methods']}.items():
  assert endpoints=={o['cell'] for o in r['outlets']}
  assert abs(sum(o['supplyM3PerYear'] for o in r['outlets'])-sum(d['localSupplyM3PerYear']))/sum(d['localSupplyM3PerYear'])<1e-9
  for start in range(w*w):
   at=start;seen=set()
   while r['receiver'][at]>=0:
    assert at not in seen;seen.add(at);to=r['receiver'][at]
    assert max(abs(at%w-to%w),abs(at//w-to//w))==1;at=to
   assert at in endpoints and at==r['outletCell'][start]
  if name.startswith('soft-divide'):
   assert all(abs(a-b)<1e-7 for a,b in zip(r['routingFillM'],d['reference']['routingFillM']))
  checks+=1
assert len(s['results'])==15
report={'status':'passed','cases':15,'routingArraysChecked':checks,'checks':['Exact raw DEM SHA256','Every target elevation equals source crop','Every coarse node exactly samples fine DEM','Same fixed physical extent for all cases','Every method has same declared receiving endpoints per gap','Global water supply conservation','All routing edges are8-neighbor adjacent','No routing cycles','Every route reaches its declared endpoint','Soft candidates add no routing-head fill vs joint reference'],'notValidated':['Observed rivers','Physical flood hydraulics','Independent global terrain regions','Below-source spatial detail','Production repository integration']}
(p/'results/validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
