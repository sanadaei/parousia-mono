/** Shared geometry contract. Rendering and world restore use the same bounds,
 * elevations and identity; this is not a second building definition. */
export function validateBuildings(buildings = [], pads = null) {
  if(!Array.isArray(buildings)||buildings.length>512)throw new RangeError('Invalid building collection');
  const ids=new Set();
  for(const b of buildings){
    if(typeof b?.id!=='string'||!b.id||ids.has(b.id))throw new TypeError('Building IDs must be unique');ids.add(b.id);
    if(b.roofAxis!==undefined&&!['x','y'].includes(b.roofAxis))throw new RangeError('Invalid roof axis');
    if(b.entranceBearingDeg!=null&&(!Number.isFinite(b.entranceBearingDeg)||b.entranceBearingDeg<0||b.entranceBearingDeg>=360))throw new RangeError('Invalid entrance bearing');
    const box=b.bounds;
    if(!box||![box.minXM,box.maxXM,box.minYM,box.maxYM,b.baseElevationM,b.heightM,b.roofHeightM].every(Number.isFinite)||box.maxXM<=box.minXM||box.maxYM<=box.minYM||b.heightM<=0||b.roofHeightM<0)throw new RangeError('Invalid building dimensions');
    if(b.orientation&&buildingCorners(b).some(([x,y])=>x<box.minXM-1e-8||x>box.maxXM+1e-8||y<box.minYM-1e-8||y>box.maxYM+1e-8))throw new RangeError('Oriented building exceeds foundation');
    for(const color of [b.wallColor,b.roofColor].filter(v=>v!==undefined))if(!Array.isArray(color)||color.length!==3||!color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new RangeError('Invalid building color');
    if(pads){const pad=pads.find(p=>(p.id??p.buildingId)===b.id);
      if(!pad||Math.abs(pad.targetPadElevationM-b.baseElevationM)>1e-7||!pad.bounds||box.minXM<pad.bounds.minXM||box.maxXM>pad.bounds.maxXM||box.minYM<pad.bounds.minYM||box.maxYM>pad.bounds.maxYM)throw new RangeError('Building must match its foundation');
    }
  }
  return buildings;
}

/** Fixed oriented footprint inside an existing rectangular foundation envelope.
 * Heading is measured from local east towards north, unlike compass bearing. */
export function fitBuildingOrientation(bounds,entranceBearingDeg){
 if(!bounds||![bounds.minXM,bounds.maxXM,bounds.minYM,bounds.maxYM,entranceBearingDeg].every(Number.isFinite)||bounds.maxXM<=bounds.minXM||bounds.maxYM<=bounds.minYM)throw new RangeError('Invalid orientation envelope');
 const headingRad=-entranceBearingDeg*Math.PI/180,length=bounds.maxXM-bounds.minXM,width=bounds.maxYM-bounds.minYM,c=Math.abs(Math.cos(headingRad)),s=Math.abs(Math.sin(headingRad)),scale=Math.min(1,length/(c*length+s*width),width/(s*length+c*width))*(1-1e-12);
 return {headingRad,lengthM:length*scale,widthM:width*scale};
}
export function buildingPlanarBox(b){
 const box=b.bounds,o=b.orientation??{headingRad:0,lengthM:box.maxXM-box.minXM,widthM:box.maxYM-box.minYM};
 if(![o.headingRad,o.lengthM,o.widthM].every(Number.isFinite)||o.lengthM<=0||o.widthM<=0)throw new RangeError('Invalid oriented building');
 return {xM:(box.minXM+box.maxXM)/2,yM:(box.minYM+box.maxYM)/2,headingRad:o.headingRad,lengthM:o.lengthM,widthM:o.widthM};
}
export function buildingCorners(b){
 const p=buildingPlanarBox(b),c=Math.cos(p.headingRad),s=Math.sin(p.headingRad);
 return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,z])=>[p.xM+a*p.lengthM/2*c-z*p.widthM/2*s,p.yM+a*p.lengthM/2*s+z*p.widthM/2*c]);
}
