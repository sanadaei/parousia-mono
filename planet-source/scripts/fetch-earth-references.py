#!/usr/bin/env python3
"""Recover bounded, cited Earth reference data. Downloads data only; no execution.
Usage: python scripts/fetch-earth-references.py OUTPUT_DIR [--classification] [--local-landforms]
"""
import argparse, hashlib, json, pathlib, urllib.parse, urllib.request

def fetch_reference(entry, destination, max_bytes):
    url=entry['url']; parts=urllib.parse.urlparse(url)
    if parts.scheme!='https' or parts.hostname not in {'coastwatch.pfeg.noaa.gov','gisstar.gsi.go.jp','cyberjapandata.gsi.go.jp'}:
        raise ValueError('Unexpected source host')
    name=entry.get('file') or pathlib.PurePosixPath(parts.path).name
    if pathlib.PurePath(name).name!=name or name in {'','.','..'}:
        raise ValueError('Unsafe data filename')
    target=destination/name
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']:
            return {'file':name,'status':'verified-cache','bytes':target.stat().st_size}
        raise ValueError('Existing cache differs; choose a new output directory')
    pending=target.with_suffix(target.suffix+'.part')
    if pending.exists():raise ValueError('Partial download exists; inspect it before retrying')
    digest=hashlib.sha256(); total=0
    with urllib.request.urlopen(url,timeout=60) as response,pending.open('xb') as out:
        while True:
            block=response.read(1024*1024)
            if not block:break
            total+=len(block)
            if total>max_bytes:raise ValueError('Download byte budget exceeded')
            digest.update(block);out.write(block)
    if digest.hexdigest()!=entry['sha256'] or total!=entry['bytes']:
        raise ValueError('Source changed or response incomplete; .part retained for inspection')
    pending.rename(target)
    return {'file':name,'status':'downloaded-and-verified','bytes':total}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output_dir',type=pathlib.Path);parser.add_argument('--classification',action='store_true');parser.add_argument('--local-landforms',action='store_true');args=parser.parse_args()
    manifest=json.loads((pathlib.Path(__file__).resolve().parents[1]/'reference/earth-terrain/acquisition-manifest.json').read_text())
    entries=manifest['elevation']+(manifest['classification'] if args.classification else [])
    if args.local_landforms:
        local=json.loads((pathlib.Path(__file__).resolve().parents[1]/'reference/earth-terrain/gsi-local-manifest.json').read_text())
        entries += [tile for site in local['sites'] for tile in site['tiles'] if tile.get('status')!=404]
    if sum(e['bytes'] for e in entries)>128*1024*1024:raise ValueError('Total reference budget exceeded')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for entry in entries:print(json.dumps(fetch_reference(entry,args.output_dir,64*1024*1024)),flush=True)
if __name__=='__main__':main()
