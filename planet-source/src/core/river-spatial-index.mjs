/** Sparse multi-resolution Cartesian boxes. A 4 m tributary must not scan
 * thousands of neighbours merely because another river has 5 km segments.
 * Query results preserve original segment order, including smooth unions. */
export function createRiverSpatialIndex(segments,radiusM){
 const boxes=new Float64Array(segments.length*6),levels=new Map(),key=(x,y,z)=>`${x},${y},${z}`;let entries=0;
 for(let i=0;i<segments.length;i++){
  const s=segments[i],support=Math.max(s.a.halfWidthM+s.a.bankWidthM,s.b.halfWidthM+s.b.bankWidthM),cellM=100*2**Math.ceil(Math.log2(Math.max(1,s.angle*radiusM/100,2*support/100))),pad=support+radiusM*(1-Math.cos(s.angle/2))+1e-6;
  let level=levels.get(cellM);if(!level){level={cellM,buckets:new Map(),all:[],recent:[]};levels.set(cellM,level);}level.all.push(i);
  const lo=s.av.map((v,k)=>Math.floor((Math.min(v,s.bv[k])*radiusM-pad)/cellM)),hi=s.av.map((v,k)=>Math.floor((Math.max(v,s.bv[k])*radiusM+pad)/cellM));
  for(let k=0;k<3;k++){boxes[i*6+k]=lo[k];boxes[i*6+3+k]=hi[k];}
  for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
   if(++entries>2000000)throw new RangeError('River spatial index exceeds memory budget');const k=key(x,y,z),list=level.buckets.get(k)??[];list.push(i);level.buckets.set(k,list);
  }
 }
 return{entries,levels:levels.size,boundsBytes:boxes.byteLength,query(center,reachM=0){
  const indices=new Set();
  for(const level of levels.values()){
   const lo=center.map(v=>Math.floor((v*radiusM-reachM)/level.cellM)),hi=center.map(v=>Math.floor((v*radiusM+reachM)/level.cellM));
   // Exact occupied-cell ranges recur across dense road probes. Keep two
   // ranges per level (ground and environmental reach), never sampled heights.
   const hit=level.recent.find(e=>lo.every((v,k)=>v===e.lo[k])&&hi.every((v,k)=>v===e.hi[k]));
   if(hit){for(const i of hit.indices)indices.add(i);continue;}
   const found=new Set();
   if(hi.reduce((n,v,k)=>n*(v-lo[k]+1),1)>4096){
    // A large query must not fall back to every tributary on the planet.
    // Compare the same conservative occupied-cell boxes without enumerating
    // the enormous query volume; relevant segments and their order are kept.
    for(const i of level.all){const j=i*6;if(boxes[j]<=hi[0]&&boxes[j+3]>=lo[0]&&boxes[j+1]<=hi[1]&&boxes[j+4]>=lo[1]&&boxes[j+2]<=hi[2]&&boxes[j+5]>=lo[2])found.add(i);}}else{
   for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++)for(const i of level.buckets.get(key(x,y,z))??[])found.add(i);
   }
   for(const i of found)indices.add(i);
   // Bound retained references even for a whole-planet query.
   if(found.size<=4096){level.recent.unshift({lo,hi,indices:[...found]});level.recent.length=Math.min(2,level.recent.length);}
  }
  return [...indices].sort((a,b)=>a-b);
 }};
}
