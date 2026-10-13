import { tileDirection, tileKey, parentTile } from './cube.mjs';
export function directionTile(d,level){
 const a=d.map(Math.abs),axis=a[0]>=a[1]&&a[0]>=a[2]?0:a[1]>=a[2]?1:2;
 const face=axis===0?(d[0]>=0?0:1):axis===1?(d[1]>=0?2:3):(d[2]>=0?4:5);
 const q=[[d[0],d[1],d[2]],[-d[0],-d[1],d[2]],[d[1],-d[0],d[2]],[-d[1],d[0],d[2]],[d[2],d[0],d[1]],[-d[2],d[0],-d[1]]][face],n=2**level;
 return {face,level,x:Math.max(0,Math.min(n-1,Math.floor((q[1]/q[0]+1)*n/2))),y:Math.max(0,Math.min(n-1,Math.floor((q[2]/q[0]+1)*n/2)))};
}
const adjacentDirection=(tile,edge)=>tileDirection(tile,...[[-1e-5,.5],[1+1e-5,.5],[.5,-1e-5],[.5,1+1e-5]][edge]);
// Cube adjacency is camera-independent. Bound this topology cache separately
// from terrain buffers; repeated balancing trials reuse the exact coordinates.
const adjacencyCache=new Map(),MAX_ADJACENCY=2048;
function adjacency(tile){const key=tileKey(tile);let value=adjacencyCache.get(key);if(value)return value;
 value=[0,1,2,3].map(edge=>directionTile(adjacentDirection(tile,edge),tile.level));
 if(adjacencyCache.size>=MAX_ADJACENCY)adjacencyCache.delete(adjacencyCache.keys().next().value);adjacencyCache.set(key,value);return value;}
export function neighborTopologyStats(){return{entries:adjacencyCache.size,maxEntries:MAX_ADJACENCY,estimatedBytes:adjacencyCache.size*512};}
export function* neighborViolationSteps(tiles){
 const map=new Map(tiles.map(t=>[tileKey(t),t])),out=[],levels=Array.from({length:6},()=>new Set());
 for(const t of tiles)levels[t.face].add(t.level);
 const sorted=levels.map(s=>[...s].sort((a,b)=>b-a));
 let inspected=0;for(const fine of tiles){if(++inspected%32===0)yield;for(let edge=0;edge<4;edge++){
 const neighbor=adjacency(fine)[edge];
 for(const level of sorted[neighbor.face]){if(level>fine.level-2)continue;
 const scale=2**(fine.level-level),coarse=map.get(`${neighbor.face}/${level}/${Math.floor(neighbor.x/scale)}/${Math.floor(neighbor.y/scale)}`);
 if(coarse){out.push({fine,coarse,edge,gap:fine.level-level});break;}}
 }}return out;
}
export function neighborViolations(tiles){const it=neighborViolationSteps(tiles);let next;do{next=it.next();}while(!next.done);return next.value;}

function descendant(t,p){return t.face===p.face&&t.level>=p.level&&Math.floor(t.x/2**(t.level-p.level))===p.x&&Math.floor(t.y/2**(t.level-p.level))===p.y;}
/** Coarsen, never overcommit the existing node budget. This enforces 2:1 in
 * the planned leaf set; in-flight renderer transitions are audited separately. */
export function* balancePlannedNeighborSteps(wanted,{isActive=()=>true,refineCoarse=null,allowCoarsen=true}={}){let collapsed=0;
 for(let iteration=0;iteration<25;iteration++){
 const leaves=[...wanted.values()].filter(e=>!e.refine&&isActive(e)).map(e=>e.tile),violations=yield* neighborViolationSteps(leaves);if(!violations.length)return{collapsed,remaining:0};
 let changed=false;
 for(const {fine,coarse} of violations){yield;if(!wanted.has(tileKey(fine))||wanted.get(tileKey(coarse))?.refine||!wanted.has(tileKey(coarse)))continue;if(refineCoarse?.(coarse)){changed=true;continue;}if(!allowCoarsen)continue;let parent=fine;while(parent.level>coarse.level+1)parent=parentTile(parent);
 const entry=wanted.get(tileKey(parent));if(!entry||!entry.refine)continue;
 entry.refine=false;for(const [key,e] of wanted)if(e.tile.level>parent.level&&descendant(e.tile,parent))wanted.delete(key);
 changed=true;collapsed++;
 }if(!changed)break;
 }
 return{collapsed,remaining:(yield* neighborViolationSteps([...wanted.values()].filter(e=>!e.refine&&isActive(e)).map(e=>e.tile))).length};
}
export function balancePlannedNeighbors(wanted,options){const it=balancePlannedNeighborSteps(wanted,options);let next;do{next=it.next();}while(!next.done);return next.value;}
/** Bits left/right/bottom/top whose displayed neighbor is one level coarser. */
export function stitchMasks(tiles){const map=new Map(tiles.map(t=>[tileKey(t),t])),masks=new Map();
 for(const tile of tiles){let mask=0;if(tile.level)for(let edge=0;edge<4;edge++){const n=adjacency(tile)[edge];if(map.has(`${n.face}/${tile.level-1}/${Math.floor(n.x/2)}/${Math.floor(n.y/2)}`))mask|=1<<edge;}masks.set(tileKey(tile),mask);}return masks;
}
export function vertexEdgeMask(tile,d){const axes=[[d[0],d[1],d[2]],[-d[0],-d[1],d[2]],[d[1],-d[0],d[2]],[-d[1],d[0],d[2]],[d[2],d[0],d[1]],[-d[2],d[0],-d[1]]][tile.face],n=2**tile.level,x=(axes[1]/axes[0]+1)*n/2-tile.x,y=(axes[2]/axes[0]+1)*n/2-tile.y;
 const eps=2e-7;return (Math.abs(x)<eps?1:0)|(Math.abs(x-1)<eps?2:0)|(Math.abs(y)<eps?4:0)|(Math.abs(y-1)<eps?8:0);
}
/** Streaming can expose an unbalanced subset even when the target plan is
 * balanced. Replace only offending fine subtrees with retained ancestors.
 * This may temporarily reduce detail; it never fabricates missing geometry. */
export function balanceDisplayedLeaves(leaves,{getAncestor}={}){
 const map=new Map(leaves.map(e=>[tileKey(e.tile),e]));let collapsed=0;
 for(let iteration=0;iteration<25;iteration++){
  const violations=neighborViolations([...map.values()].map(e=>e.tile));if(!violations.length)return{leaves:[...map.values()],collapsed,remaining:0};let changed=false;
  for(const {fine,coarse}of violations){if(!map.has(tileKey(fine))||!map.has(tileKey(coarse)))continue;let parent=fine;while(parent.level>coarse.level+1)parent=parentTile(parent);
   const replacement=getAncestor(parent);if(!replacement)continue;
   for(const[key,e]of map)if(descendant(e.tile,parent))map.delete(key);
   map.set(tileKey(parent),{...replacement,tile:parent});collapsed++;changed=true;
  }if(!changed)break;
 }
 return{leaves:[...map.values()],collapsed,remaining:neighborViolations([...map.values()].map(e=>e.tile)).length};
}

/** Starting from a balanced complete six-face tree, only children introduced by
 * a split can create a new >1 level gap. Repair their adjacent coarse ancestors
 * and recursively inspect those new children. This avoids rescanning every
 * leaf after each trial refinement. The caller rolls back an unaffordable trial. */
export function* balanceRefinedBranchSteps(wanted,childrenToCheck,{refineCoarse}={}){
 const queue=[...childrenToCheck];let refinements=0,inspected=0;
 for(let i=0;i<queue.length;i++){
  if(++inspected%8===0)yield;
  const fine=queue[i];if(!wanted.has(tileKey(fine)))continue;
  for(const sameLevel of adjacency(fine)){
   let coarse=sameLevel,entry;
   while(coarse){entry=wanted.get(tileKey(coarse));if(entry)break;coarse=parentTile(coarse);}
   if(!entry||entry.refine||fine.level-entry.tile.level<=1)continue;
   if(!refineCoarse(entry.tile))return{remaining:1,refinements,inspected};
   refinements++;
   // The refinement callback has added all four children to the complete tree.
   const t=entry.tile,l=t.level+1;
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)queue.push({face:t.face,level:l,x:t.x*2+dx,y:t.y*2+dy});
  }
 }
 return{remaining:0,refinements,inspected};
}

/** The edge halo needed to show a fine tile with at most a 2:1 gap. */
export function coarseEdgeNeighbors(tile){return tile.level?adjacency(tile).map(parentTile):[];}
