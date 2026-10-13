import {settlementStreetGate} from './settlement-districts.mjs';
import {offsetGeographic,greatCircle} from './spherical.mjs';
/** Shared dry segment anchors; never relocate a settlement. Candidate ordering
 * depends on the canonical point, not on the direction of traversal or LOD. */
export function resolveRoadEndpoint(base,point,toward){
 const R=base.frame.radiusM,gate=settlementStreetGate(point,toward,R),surface=p=>base.sampleSurfaceAt(p.latDeg,p.lonDeg),dry=p=>{const s=surface(p);return !(s.waterDepthM>0)&&!s.landReserved;};
 if(dry(gate))return gate;
 if(point.population){const allowed=point.economicContext?.streetPolicy==='network-led-village-streets@1'?point.economicContext.streetGates:null,candidates=[['east',10000,0],['west',-10000,0],['north',0,10000],['south',0,-10000]].filter(([name])=>!allowed||allowed.includes(name)).map(([,x,y])=>settlementStreetGate(point,offsetGeographic(point,x,y,R),R)).filter(dry);candidates.sort((a,b)=>greatCircle(a,toward,R).distanceM-greatCircle(b,toward,R).distanceM);return candidates[0]??gate;}
 const s=surface(point);if(!s.landReserved&&(!s.waterSourceIds?.length||s.waterSourceIds.some(id=>!id.startsWith('river:')&&!id.startsWith('lake:'))))return gate;
 for(let radius=25;radius<=(s.landReserved?4000:500);radius+=25)for(let i=0;i<16;i++){const angle=i*Math.PI/8,p=offsetGeographic(point,Math.sin(angle)*radius,Math.cos(angle)*radius,R);if(dry(p)&&(!s.landReserved||Array.from({length:8},(_,j)=>{const angle=j*Math.PI/4;return dry(offsetGeographic(p,Math.sin(angle)*15,Math.cos(angle)*15,R));}).every(Boolean)))return p;}
 return gate;
}
