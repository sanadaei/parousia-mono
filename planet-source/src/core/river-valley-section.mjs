import {greatCircle} from './spherical.mjs';
export const ALLUVIAL_RIVER_BED='c1-incision-alluvial-bench@3';
export const ALLUVIAL_SECTION_POLICY='gradient-weighted-valley-floor@1';
/** A declared game-scale cross-section scenario inspired by the separation of
 * channel, valley floor and bank in Riverscapes (Peytavie et al., 2019).
 * Not their full Rosgen classifier, sediment simulation or discharge law.
 * Nodes, centre lines and water levels stay fixed; only dry-bank sections change.
 */
export function withAlluvialValleySections(network){
 if(!network||!Number.isFinite(network.radiusM)||network.radiusM<=0||!Array.isArray(network.profiles)||network.profiles.some(p=>!Array.isArray(p.points)||p.points.length<2)||network.profiles.reduce((n,p)=>n+p.points.length,0)>131072)throw new RangeError('Bounded river network required for valley sections');
 if(network.bedMethod===ALLUVIAL_RIVER_BED)return network;
 if(network.bedMethod!=='c1-incision-smoothmax@2')throw new RangeError('Valley sections require the current bounded incision method');
 for(const profile of network.profiles)for(const p of profile.points)if(![p.latDeg,p.lonDeg,p.waterLevelElevationM,p.halfWidthM,p.bankWidthM].every(Number.isFinite)||Math.abs(p.latDeg)>90||p.halfWidthM<=0||p.bankWidthM<=0)throw new RangeError('Invalid valley section point');
 let decoratedPoints=0;
 const profiles=network.profiles.map(profile=>{
  const gradients=profile.points.slice(1).map((p,i)=>{const a=profile.points[i],distance=greatCircle(a,p,network.radiusM).distanceM;if(!distance)throw new RangeError('Degenerate valley section');if(p.waterLevelElevationM>a.waterLevelElevationM+1e-7)throw new RangeError('Uphill valley section');return Math.max(0,(a.waterLevelElevationM-p.waterLevelElevationM)/distance);});
  const points=profile.points.map((p,i)=>{
   const grade=Math.max(gradients[Math.max(0,i-1)],gradients[Math.min(gradients.length-1,i)]),t=Math.max(0,Math.min(1,(.005-grade)/.004)),weight=t*t*(3-2*t);
   const floodplainWidthM=Math.min(400,Math.max(20,4*p.halfWidthM))*weight,floodplainRiseM=1.5*weight;
   if(floodplainWidthM>0)decoratedPoints++;
   return{...p,bankWidthM:p.bankWidthM+floodplainWidthM,floodplainWidthM,floodplainRiseM};
  });
  return{...profile,points};
 });
 return{...network,bedMethod:ALLUVIAL_RIVER_BED,profiles,diagnostics:{...network.diagnostics,valleySections:{method:ALLUVIAL_SECTION_POLICY,decoratedPoints,fullWeightBelowGrade:.001,zeroWeightAboveGrade:.005,maximumFloorWidthM:400,maximumFloorRiseM:1.5,scope:'Explicit gentle-reach valley-floor scenario; symmetric dry-bank sections, no sediment balance or proven flood safety'}}};
}
