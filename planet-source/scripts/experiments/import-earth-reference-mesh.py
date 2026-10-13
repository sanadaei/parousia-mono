"""Bounded GSI reference import. Never fills NoData or marks it as water.
Metric scale is the acquisition manifest's local approximation, not a new CRS.
Only original sampled elevations are used; no erosion or random generation.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np


def reference_mesh(height, spacing, stride=4):
    if height.ndim != 2 or not np.isfinite(spacing) or spacing <= 0 or not isinstance(stride, int) or stride < 1:
        raise ValueError('2D elevations, positive spacing and integer stride required')
    z = height[::stride, ::stride]
    h, w = z.shape
    if min(h, w) < 2 or h*w > 65536:
        raise ValueError('Sampled grid must fit 65536 nodes and have positive area')
    valid = np.isfinite(z)
    triangles = []
    for y in range(h-1):
        for x in range(w-1):
            # Conservatively omit a whole coarse cell if ANY source sample in
            # its support is missing, including samples skipped by decimation.
            if not np.isfinite(height[y*stride:(y+1)*stride+1,x*stride:(x+1)*stride+1]).all():
                continue
            # North is +y; image rows advance south, so reverse winding.
            a, b, c, d = y*w+x, y*w+x+1, (y+1)*w+x, (y+1)*w+x+1
            for t in [(a,c,b),(b,c,d)]:
                if all(valid[i//w, i%w] for i in t):
                    triangles.append(t)
    if not triangles:
        raise ValueError('No fully observed triangle; no synthetic fallback')
    used = sorted(set(i for t in triangles for i in t))
    remap = {old:i for i,old in enumerate(used)}
    step = spacing*stride
    points = [[(i%w)*step, (h-1-i//w)*step] for i in used]
    return {'points':points,'triangles':[[remap[i] for i in t] for t in triangles]}, [float(z[i//w,i%w]) for i in used], {
        'sampleStride':stride,'sampleSpacingM':step,'sampledShape':[h,w],
        'sourceNoDataCells':int((~np.isfinite(height)).sum()),'sampledNoDataCells':int((~valid).sum()),
        'retainedVertices':len(used),'retainedTriangles':len(triangles),
        'coverage':'Only cells whose entire source support is observed; missing supports omitted, no fill or inferred water',
        'limitations':['Point decimation without antialias filtering; not a full-resolution DEM',
                       'Approximate local metric spacing, not a geodetic transformation',
                       'Missing source support conservatively omits whole coarse cells; covered area may be underestimated']}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input_npz');p.add_argument('manifest_json');p.add_argument('site');p.add_argument('output_json');p.add_argument('--stride',type=int,default=4)
    args=p.parse_args();output=Path(args.output_json)
    if output.exists():raise FileExistsError('Output exists; refusing overwrite')
    source=Path(args.input_npz)
    if source.stat().st_size>16*1024*1024:raise ValueError('Reference input exceeds 16 MiB')
    manifest=json.loads(Path(args.manifest_json).read_text());site=next((s for s in manifest['sites'] if s['name']==args.site),None)
    if site is None:raise ValueError('Site absent from provenance manifest')
    with np.load(source,allow_pickle=False) as a:
        height=a['height'];spacing=float(a['spacing'])
        if list(height.shape)!=site['shape'] or abs(spacing-site['approxPixelSpacingM'])>1e-9:raise ValueError('Reference geometry differs from manifest')
        mesh,z,diagnostics=reference_mesh(height,spacing,args.stride)
    result={'schema':'minimal-world-triangular-terrain@1','seed':'earth-reference/'+args.site,'revision':'gsi-reference-import@1',
            'frame':{'kind':'planar-metric','verticalDatum':'GSI source elevation; no datum transformation performed'},
            'mesh':mesh,'fields':{'groundElevationM':z},'references':{'earthReference':{
                'status':'Earth reference only; not procedurally generated terrain or planetary adoption',
                'source':manifest['source'],'specification':manifest['specification'],'license':manifest['license'],
                'site':site,'inputSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'diagnostics':diagnostics}}}
    with output.open('x') as stream:json.dump(result,stream,allow_nan=False)
    print(json.dumps(diagnostics))

if __name__=='__main__':main()
