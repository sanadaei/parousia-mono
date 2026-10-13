#!/usr/bin/env python3
"""Inspect cached, hash-verified GSI DEM PNGs. Requires numpy and Pillow.
python scripts/inspect-gsi-reference.py CACHE_DIR OUTPUT_JSON
Missing pixels/tiles remain missing. No downloads or project-world changes.
"""
import argparse, hashlib, json, math, pathlib
import numpy as np
from PIL import Image

def decode_elevation(rgb):
    a=np.asarray(rgb)
    if a.shape!=(256,256,3) or a.dtype!=np.uint8:
        raise ValueError('Expected 256x256 RGB uint8 elevation tile')
    a=a.astype(np.int32)
    v=a[:,:,0]*65536+a[:,:,1]*256+a[:,:,2]
    h=np.where(v>2**23,v-2**24,v).astype(float)*.01
    h[v==2**23]=np.nan
    return h

def inspect_site(site,cache):
    if site['shape']!=[768,768] or site['zoom']!=15 or len(site['tiles'])!=9:
        raise ValueError('Expected bounded 3x3 zoom-15 reference')
    a=np.full((768,768),np.nan)
    cx,cy=site['centreTile'];seen=set()
    for e in site['tiles']:
        parts=e['url'].split('/');tx=int(parts[-2]);ty=int(parts[-1].split('.')[0])
        if not(cx-1<=tx<=cx+1 and cy-1<=ty<=cy+1) or (tx,ty) in seen:
            raise ValueError('Unexpected or repeated tile coordinate')
        seen.add((tx,ty))
        if e.get('status')==404:continue
        if pathlib.PurePath(e['file']).name!=e['file']:raise ValueError('Unsafe filename')
        path=cache/e['file'];b=path.read_bytes()
        if len(b)!=e['bytes'] or hashlib.sha256(b).hexdigest()!=e['sha256']:
            raise ValueError('Reference file differs from manifest')
        with Image.open(path) as im:
            if im.mode!='RGB':raise ValueError('Unexpected PNG mode')
            h=decode_elevation(np.asarray(im))
        a[(ty-cy+1)*256:(ty-cy+2)*256,(tx-cx+1)*256:(tx-cx+2)*256]=h
    spacing=2*math.pi*6378137*math.cos(math.radians(site['centre'][0]))/(2**15*256)
    good=a[np.isfinite(a)];dy,dx=np.gradient(a,spacing)
    slope=np.degrees(np.arctan(np.hypot(dx,dy)));slope=slope[np.isfinite(slope)]
    if not len(good) or not len(slope):raise ValueError('No usable reference surface')
    return {'name':site['name'],'pixelSpacingM':spacing,'finiteCells':int(len(good)),
        'missingCells':int(a.size-len(good)),'minM':float(good.min()),'maxM':float(good.max()),
        'reliefM':float(np.ptp(good)),'slopeMedianDeg':float(np.median(slope)),
        'slopeP95Deg':float(np.quantile(slope,.95)),'slopeValidCells':len(slope)}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('cache',type=pathlib.Path);p.add_argument('output',type=pathlib.Path);args=p.parse_args()
    path=pathlib.Path(__file__).resolve().parents[1]/'reference/earth-terrain/gsi-local-manifest.json'
    manifest=json.loads(path.read_text())
    result={'method':'central finite differences on valid 3x3-tile samples; local centre-latitude metric approximation','sourceResolutionM':5,'limitations':['PNG pixels are interpolated from 5m-source data, not independent finer measurements','Missing values are not sea level','Modern ground includes modifications and is not a medieval reconstruction','Height fields do not represent overhangs'],'sites':[inspect_site(s,args.cache) for s in manifest['sites']]}
    args.output.write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
