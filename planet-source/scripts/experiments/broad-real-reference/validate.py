from pathlib import Path
import gzip,json,hashlib,numpy as np
p=Path(__file__).resolve().parent
bridge_path=p/'generated-bridge.json'
storage=json.loads((p/'generated-bridge-storage.json').read_text())
chunks=[]
for part in storage['parts']:
 chunk=(p/part['file']).read_bytes()
 assert len(chunk)==part['bytes'] and hashlib.sha256(chunk).hexdigest()==part['sha256']
 chunks.append(chunk)
compressed=b''.join(chunks)
assert len(compressed)==storage['compressedBytes'] and hashlib.sha256(compressed).hexdigest()==storage['compressedSha256']
bridge_bytes=gzip.decompress(compressed)
assert len(bridge_bytes)==storage['uncompressedBytes'] and hashlib.sha256(bridge_bytes).hexdigest()==storage['uncompressedSha256']
b=json.loads(bridge_bytes)
checks=[]
for name,raw in [('apennines','etopo-tuscany-apennines.csv'),('paris','etopo-paris.csv')]:
 c=json.loads((p/name/'comparison.json').read_text());v=c['source'];assert hashlib.sha256((p/'raw'/raw).read_bytes()).hexdigest()==v['sha256'];assert hashlib.sha256(bridge_bytes).hexdigest()==v['generatedSourceSha256'];assert len(c['stages'])==7
 for k,s in enumerate(c['stages']):
  g=s['grid'];w=g['columns'];h=g['rows'];assert w==h==2**(k+1)+1
  assert abs(s['widthM']-113908.42189555817)<1e-7;assert abs(s['heightM']-156367.8655939107)<1e-7
  expected=b['parent']['context'] if k==0 else b['stages'][k-1]['surface'];assert s['generated']['elevation']==expected['elevation'];assert g==expected['grid']
  for n in ['real','generated']:
   z=np.array(s[n]['elevation']);r=np.array(s[n]['receiver']);area=np.array(s[n]['contributingAreaKm2']);assert len(z)==w*h;assert np.isfinite(z).all() and np.isfinite(area).all();assert (area>0).all();assert ((r>=-1)&(r<w*h)).all();ids=np.where(r>=0)[0];assert (np.abs(ids%w-r[ids]%w)<=1).all() and (np.abs(ids//w-r[ids]//w)<=1).all()
   assert abs(area[r<0].sum()-s['widthM']*s['heightM']/1e6)<1e-6
   if k:
    z0=np.array(c['stages'][k-1][n]['elevation']).reshape((w+1)//2,(w+1)//2);assert np.max(np.abs(z.reshape(h,w)[::2,::2]-z0))<1e-8
 checks.append(name+': hashes, metric footprint, stage sizes, source-exact generated arrays, finite values, adjacency, outlet-area budget, inherited nodes passed')
(p/'validation.json').write_text(json.dumps({'passed':True,'checks':checks},indent=2));print('\n'.join(checks))
