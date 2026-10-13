#!/usr/bin/env python3
import hashlib,json,pathlib,sys
here=pathlib.Path(__file__).resolve().parent
manifest=here/(sys.argv[2] if len(sys.argv)>2 else 'SOURCE-MANIFEST.json')
if not manifest.exists():manifest=here/'PUBLICATION-MANIFEST.json'
root=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else here
items=json.loads(manifest.read_text())['files']
for item in items:
 p=pathlib.PurePosixPath(item['path'])
 assert not p.is_absolute() and '..' not in p.parts,'Unsafe path'
 f=root.joinpath(*p.parts);assert f.is_file() and not f.is_symlink(),item['path']
 b=f.read_bytes();assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256'] and hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==item['sha'],item['path']
print('PASS:',len(items),'files match byte lengths, SHA-256 and Git blob SHA-1')
