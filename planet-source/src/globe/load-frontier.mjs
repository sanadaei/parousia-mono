import {children,parentTile,tileKey} from './cube.mjs';
import {coarseEdgeNeighbors} from './lod-neighbors.mjs';
/** Propagate a requested view's urgency only to its actual display dependencies:
 * ancestors, complete sibling groups and the one-level-coarser edge halo.
 * Loading every distant tile at a coarser level first starves local detail.
 * This changes scheduling only, never planned topology or canonical geometry. */
export function loadFrontierPriorities(wanted){
 const priorities=new Map(),seeds=[...wanted.values()].sort((a,b)=>a.priority-b.priority||a.tile.level-b.tile.level||tileKey(a.tile).localeCompare(tileKey(b.tile)));
 for(const entry of seeds){const queue=[entry.tile],priority=entry.priority;for(let i=0;i<queue.length;i++){
   const tile=queue[i],key=tileKey(tile);if(priorities.has(key)||!wanted.has(key))continue;
   priorities.set(key,priority);const parent=parentTile(tile);if(!parent)continue;
   queue.push(parent,...children(parent),...coarseEdgeNeighbors(tile));
 }}
 return priorities;
}
