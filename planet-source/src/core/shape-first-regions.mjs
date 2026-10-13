/** Shape first: partition one authored native domain, never synthesize seam detail.
 * Browser-safe, pure, JSON-roundtrippable. Coordinates are metres, north-west origin.
 */
import {createHash} from './sha256.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requireValue = (ok, message) => { if (!ok) throw new TypeError(`Shape-first regions: ${message}`); };
const same = (a,b) => a.xM===b.xM && a.yM===b.yM;
function intersection(a,b,axis,value) {
  const t=(value-a[axis])/(b[axis]-a[axis]);
  return {t, point:{xM:axis==='xM'?value:a.xM+(b.xM-a.xM)*t,yM:axis==='yM'?value:a.yM+(b.yM-a.yM)*t}};
}
function clipSegment(a,b,bounds) {
  let lo=0,hi=1; const hits=[];
  for(const [axis,min,max] of [['xM',bounds.x0,bounds.x1],['yM',bounds.y0,bounds.y1]]) {
    const delta=b[axis]-a[axis];
    if(delta===0){if(a[axis]<min||a[axis]>max)return null;continue;}
    const p=intersection(a,b,axis,min),q=intersection(a,b,axis,max);
    hits.push(p,q);lo=Math.max(lo,Math.min(p.t,q.t));hi=Math.min(hi,Math.max(p.t,q.t));
  }
  if(hi<=lo)return null;
  const point=t=>t===0?{...a}:t===1?{...b}:hits.find(h=>h.t===t)?.point??{xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t};
  return {start:point(lo),end:point(hi),t0:lo,t1:hi};
}
export function createShapeFirstRegions(candidate,{tileColumns=2,tileRows=1,levelCount=5,waterAnnotation=null,riverIds=null,pointOrder='preserved; direction unspecified',sourceSha256=null}={}) {
  const g=candidate?.grid;
  requireValue(candidate?.schema==='shape-first-candidate@1','unsupported candidate schema');
  requireValue(g&&[g.columns,g.rows].every(n=>Number.isSafeInteger(n)&&n>=2)&&g.columns*g.rows<=2000000,'invalid native grid');
  requireValue([g.cellSizeM,g.cellSizeYM].every(n=>Number.isFinite(n)&&n>0)&&g.row0==='north'&&g.yDirection==='south','invalid grid coordinates');
  requireValue(Array.isArray(candidate.elevation)&&candidate.elevation.length===g.columns*g.rows&&candidate.elevation.every(Number.isFinite),'invalid native elevations');
  requireValue([tileColumns,tileRows,levelCount].every(n=>Number.isSafeInteger(n)&&n>0)&&levelCount<=12,'invalid partition or levels');
  const nx=(g.columns-1)/tileColumns,ny=(g.rows-1)/tileRows,stride=2**(levelCount-1);
  requireValue(Number.isInteger(nx)&&Number.isInteger(ny)&&nx>0&&ny>0&&nx%stride===0&&ny%stride===0,'tile intervals must divide exactly by coarsest stride');
  const widthM=(g.columns-1)*g.cellSizeM,heightM=(g.rows-1)*g.cellSizeYM;
  requireValue(Number.isFinite(widthM)&&Number.isFinite(heightM),'nonfinite domain');
  requireValue(Array.isArray(candidate.rivers),'missing rivers');
  const ids=riverIds??candidate.rivers.map((_,i)=>`river-${i}`);
  requireValue(ids.length===candidate.rivers.length&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&id),'river IDs must be unique');
  const rivers=candidate.rivers.map((points,i)=>{
    requireValue(Array.isArray(points)&&points.length>=2,'invalid river polyline');
    return {id:ids[i],sourceRiverIndex:i,points:points.map(p=>{
      requireValue(p&&Number.isFinite(p.xM)&&Number.isFinite(p.yM)&&p.xM>=-.001&&p.yM>=-.001&&p.xM<=widthM+.001&&p.yM<=heightM+.001,'river outside native domain');
      return {xM:Math.max(0,Math.min(widthM,p.xM)),yM:Math.max(0,Math.min(heightM,p.yM))};
    })};
  });
  const flowById=new Map();
  if(waterAnnotation){
    requireValue(waterAnnotation.schema==='shape-first-water-annotation@1','unsupported water annotation');
    requireValue(waterAnnotation.preservation?.before?.height===digest(candidate.elevation)&&waterAnnotation.preservation?.before?.rivers===digest(candidate.rivers),'water annotation source geometry/hash mismatch');
    requireValue(JSON.stringify(waterAnnotation.assignment?.riverIds)===JSON.stringify(ids),'water annotation source river ID ordering mismatch');
    requireValue(waterAnnotation.assignment?.columns===g.columns-1&&waterAnnotation.assignment?.rows===g.rows-1&&waterAnnotation.accounting?.areaM2===widthM*heightM,'water annotation native footprint mismatch');
    for(const r of waterAnnotation.rivers??[])flowById.set(r.id,r.segmentFlowM3PerSecond);
    for(const r of rivers){const flow=flowById.get(r.id);requireValue(Array.isArray(flow)&&flow.length===r.points.length-1&&flow.every(q=>Number.isFinite(q)&&q>=0),'water annotation does not match source river segments');}
  }
  const flow=(r,i)=>flowById.get(r.id)?.[i]??null;
  const tiles=[];
  for(let row=0;row<tileRows;row++)for(let column=0;column<tileColumns;column++){
    const c0=column*nx,r0=row*ny,x0=c0*g.cellSizeM,y0=r0*g.cellSizeYM,x1=(c0+nx)*g.cellSizeM,y1=(r0+ny)*g.cellSizeYM;
    const levels=Array.from({length:levelCount},(_,i)=>{
      const sourceStride=2**(levelCount-i-1),columns=nx/sourceStride+1,rows=ny/sourceStride+1;
      return {id:`shape-${i}`,sourceStride,grid:{columns,rows,cellSizeM:g.cellSizeM*sourceStride,cellSizeYM:g.cellSizeYM*sourceStride,row0:'north',yDirection:'south'},elevation:Array.from({length:columns*rows},(_,k)=>candidate.elevation[(r0+Math.floor(k/columns)*sourceStride)*g.columns+c0+k%columns*sourceStride])};
    });
    const fragments=[];
    for(const river of rivers){
      let current=null;
      for(let i=0;i<river.points.length-1;i++){
        const clip=clipSegment(river.points[i],river.points[i+1],{x0,y0,x1,y1});
        if(!clip){current=null;continue;}
        if(!current||!same(current.points.at(-1),clip.start)){
          current={id:`${river.id}:tile-${column}-${row}:fragment-${fragments.length}`,riverId:river.id,sourceRiverIndex:river.sourceRiverIndex,points:[clip.start],segments:[]};fragments.push(current);
        }
        current.points.push(clip.end);current.segments.push({sourceSegmentIndex:i,t0:clip.t0,t1:clip.t1,flowM3PerSecond:flow(river,i)});
      }
    }
    tiles.push({id:`tile-${column}-${row}`,column,row,sourceWindow:{column:c0,row:r0,intervalsX:nx,intervalsY:ny},originM:{xM:x0,yM:y0},extent:{widthM:x1-x0,heightM:y1-y0},grid:levels.at(-1).grid,elevation:levels.at(-1).elevation,levels,rivers:fragments,ports:[]});
  }
  const seams=[];
  function seam(a,b,axis,value,start,end){
    const other=axis==='xM'?'yM':'xM',id=`${a.id}/${b.id}`,ports=[];
    for(const river of rivers)for(let i=0;i<river.points.length-1;i++){
      const p=river.points[i],q=river.points[i+1],s=p[axis]-value,t=q[axis]-value;
      // Half-open segment convention makes a shared source vertex one crossing.
      let hit=null;
      if(s*t<0)hit=intersection(p,q,axis,value);
      else if(s===0&&t!==0&&i>0){
        let j=i-1;while(j>=0&&river.points[j][axis]===value)j--;
        // Runs lying on a seam are shared geometry, not fictitious transfers.
        if(j===i-1&&(river.points[j][axis]-value)*t<0)hit={t:0,point:{...p}};
      }
      if(!hit||hit.point[other]<start||hit.point[other]>end)continue;
      const forward=t>0,from=forward?a.id:b.id,to=forward?b.id:a.id;
      const downstream=pointOrder==='downstream_to_upstream'?{fromTile:to,toTile:from}:pointOrder==='upstream_to_downstream'?{fromTile:from,toTile:to}:{fromTile:null,toTile:null};
      const port={id:`${id}:${river.id}:${i}`,riverId:river.id,sourceRiverIndex:river.sourceRiverIndex,sourceSegmentIndex:i,sourceT:hit.t,point:hit.point,flowM3PerSecond:flow(river,i),...downstream};
      ports.push(port);a.ports.push({...port,neighborTile:b.id,role:downstream.fromTile===a.id?'outgoing':downstream.toTile===a.id?'incoming':'undirected'});b.ports.push({...port,neighborTile:a.id,role:downstream.fromTile===b.id?'outgoing':downstream.toTile===b.id?'incoming':'undirected'});
    }
    const count=axis==='xM'?ny:nx,spacing=axis==='xM'?g.cellSizeYM:g.cellSizeM;
    const sourceColumn=axis==='xM'?b.sourceWindow.column:a.sourceWindow.column,sourceRow=axis==='yM'?b.sourceWindow.row:a.sourceWindow.row;
    const points=Array.from({length:count+1},(_,i)=>({xM:axis==='xM'?value:start+i*spacing,yM:axis==='yM'?value:start+i*spacing,elevationM:candidate.elevation[(sourceRow+(axis==='xM'?i:0))*g.columns+sourceColumn+(axis==='yM'?i:0)]}));
    seams.push({id,tiles:[a.id,b.id],axis,valueM:value,points,ports,maxElevationDifferenceM:0,derivation:'identical source node indices, not blended edges'});
  }
  for(const a of tiles){if(a.column+1<tileColumns){const b=tiles[a.row*tileColumns+a.column+1];seam(a,b,'xM',b.originM.xM,a.originM.yM,a.originM.yM+a.extent.heightM);}if(a.row+1<tileRows){const b=tiles[(a.row+1)*tileColumns+a.column];seam(a,b,'yM',b.originM.yM,a.originM.xM,a.originM.xM+a.extent.widthM);}}
  // A diagonal corner crossing is one transfer between the two occupied tiles,
  // not two fictitious transfers through each zero-length touching neighbor.
  const cornerTransfers=[],groups=new Map();
  for(const s of seams)for(const p of s.ports){const key=JSON.stringify([p.riverId,p.sourceSegmentIndex,p.sourceT,p.point]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
  for(const group of groups.values()){
    if(group.length<2)continue;
    const p=group[0],before=[],after=[];
    for(const tile of tiles)for(const fragment of tile.rivers){
      if(fragment.riverId!==p.riverId)continue;
      fragment.segments.forEach((segment,i)=>{
        if((segment.sourceSegmentIndex===p.sourceSegmentIndex&&segment.t0<p.sourceT&&segment.t1===p.sourceT)||(p.sourceT===0&&segment.sourceSegmentIndex===p.sourceSegmentIndex-1&&same(fragment.points[i+1],p.point)))before.push(tile.id);
        if(segment.sourceSegmentIndex===p.sourceSegmentIndex&&segment.t0===p.sourceT&&segment.t1>p.sourceT)after.push(tile.id);
      });
    }
    const a=[...new Set(before)],b=[...new Set(after)];
    requireValue(a.length===1&&b.length===1,'ambiguous river traversal along a tile corner');
    const ids=new Set(group.map(q=>q.id));
    for(const s of seams)s.ports=s.ports.filter(q=>!ids.has(q.id));
    for(const tile of tiles)tile.ports=tile.ports.filter(q=>!ids.has(q.id));
    const directed=pointOrder==='downstream_to_upstream'?[b[0],a[0]]:pointOrder==='upstream_to_downstream'?[a[0],b[0]]:[null,null];
    const port={...p,id:`corner:${p.riverId}:${p.sourceSegmentIndex}:${p.sourceT}`,fromTile:directed[0],toTile:directed[1],tiles:[a[0],b[0]]};cornerTransfers.push(port);
    for(const [tileId,neighborTile] of [[a[0],b[0]],[b[0],a[0]]])tiles.find(t=>t.id===tileId).ports.push({...port,neighborTile,role:port.fromTile===tileId?'outgoing':port.toTile===tileId?'incoming':'undirected'});
  }
  return {schema:'shape-first-adjacent-regions@1',status:'shape draft; provisional water annotations',sourceSha256,coordinates:{origin:'northwest of common domain',xDirection:'east',yDirection:'south',riverCoordinates:'global domain metres'},domain:{grid:{...g},extent:{widthM,heightM},elevation:[...candidate.elevation],rivers},partition:{tileColumns,tileRows,levelCount},pointOrder,waterStatus:waterAnnotation?.status??'discharge unspecified',limitations:['Tiles are cuts of one selected native shape, not newly generated adjacent terrain.','Coarse levels are exact subsamples; no new detail below native spacing.','Transfer flow is copied once from a shared source segment, not new supply or a per-tile water budget.','A seam-collinear river is shared geometry; a tangential touch is not a cross-boundary transfer.'],tiles,seams,cornerTransfers};
}
