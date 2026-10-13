export const VILLAGE_PORTAL_POLICY='bearing-led-boundary-portals@1';
const names=['west','east','south','north'];
/** Boundary coordinates shared by local streets and regional roads. A snapped
 * bearing aggregate, not a historical street plan or a dry-access guarantee. */
export function validateVillagePortals(portals){
 if(!Array.isArray(portals)||!portals.length||portals.length>4)throw new RangeError('Invalid village portals');const seen=new Set();
 for(const p of portals){if(!names.includes(p.name)||seen.has(p.name)||![p.xM,p.yM].every(n=>Number.isFinite(n)&&n%10===0)||Math.abs(p.xM)>200||Math.abs(p.yM)>230||(p.name==='east'?p.xM!==200:p.name==='west'?p.xM!==-200:p.name==='north'?p.yM!==230:p.yM!==-230))throw new RangeError('Invalid village portal coordinates');seen.add(p.name);}
 return portals;
}
export function bearingVillagePortals(directions){
 const groups=new Map(names.map(n=>[n,[]]));for(const p of directions){const length=Math.hypot(p.xM,p.yM);if(!Number.isFinite(length)||length<1)continue;const name=Math.abs(p.xM)>=Math.abs(p.yM)?p.xM>=0?'east':'west':p.yM>=0?'north':'south';groups.get(name).push({x:p.xM/length,y:p.yM/length});}
 const out=[];for(const name of names){const rows=groups.get(name);if(!rows.length)continue;rows.sort((a,b)=>a.x-b.x||a.y-b.y);const x=rows.reduce((n,p)=>n+p.x,0),y=rows.reduce((n,p)=>n+p.y,0),east=name==='east'||name==='west',scale=east?200/Math.abs(x):230/Math.abs(y);out.push({name,xM:Math.max(-200,Math.min(200,Math.round(x*scale/10)*10))||0,yM:Math.max(-230,Math.min(230,Math.round(y*scale/10)*10))||0});}
 return out.length?validateVillagePortals(out):[];
}
