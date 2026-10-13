import{finiteNumber,validateElevationInterval}from'./contract-validation.mjs';
export const ROAD_CROSS_SECTION_SCHEMA='road-cross-section@1';
export function validateRoadCrossSection(section,lengthM=Infinity){
 if(section==null)return null;
 if(section.schema!==ROAD_CROSS_SECTION_SCHEMA)throw new TypeError('Unsupported road cross section');
 const{crownSlope,crossSlope,transitionLengthM,flatIntervals}=section;
 for(const[k,v]of Object.entries({crownSlope,crossSlope,transitionLengthM}))finiteNumber(v,k);
 if(crownSlope<0||crownSlope>0.25||Math.abs(crossSlope)>0.25||transitionLengthM<1||transitionLengthM>1000)throw new RangeError('Road cross slope or transition exceeds bounds');
 if(!Array.isArray(flatIntervals)||flatIntervals.length>32)throw new RangeError('Invalid flat road intervals');
 for(const p of flatIntervals)if(!p||![p.startM,p.endM].every(Number.isFinite)||p.startM<0||p.endM<p.startM||p.endM>lengthM+1e-7)throw new RangeError('Flat road interval outside the road');
 return section;
}
/** Left of the road's forward direction is positive. Centre elevation stays
 * authoritative. Junction/bridge intervals flatten both crown and cant. */
export function roadCrossSectionAt(section,stationM,lateralM){
 finiteNumber(stationM,'road station');finiteNumber(lateralM,'road lateral offset');
 if(!section)return{offsetM:0,alongSlope:0,acrossSlope:0,factor:0};
 let factor=1,derivative=0;
 for(const p of section.flatIntervals){const distance=stationM<p.startM?p.startM-stationM:stationM>p.endM?stationM-p.endM:0,sign=stationM<p.startM?-1:stationM>p.endM?1:0,t=Math.min(1,distance/section.transitionLengthM),weight=t*t*(3-2*t),slope=t<1?sign*6*t*(1-t)/section.transitionLengthM:0;
  derivative=derivative*weight+factor*slope;factor*=weight;
 }
 const raw=section.crossSlope*lateralM-section.crownSlope*Math.abs(lateralM);
 return{offsetM:factor===0?0:factor*raw,alongSlope:derivative===0?0:derivative*raw,acrossSlope:factor*(lateralM===0?Math.abs(section.crossSlope)+section.crownSlope:section.crossSlope-section.crownSlope*Math.sign(lateralM)),factor};
}
export function roadCrossSectionOffsetBound(section,halfWidthM,startM=-Infinity,endM=Infinity){
 if(!section||section.flatIntervals.some(p=>startM>=p.startM-1e-7&&endM<=p.endM+1e-7))return 0;
 return halfWidthM*(Math.abs(section.crossSlope)+section.crownSlope);
}
/** Certified offset over a station/lateral rectangle. Unlike a full-width
 * amplitude, this converges on one side of the crown as the region shrinks. */
export function roadCrossSectionOffsetInterval(section,stationRange,lateralRange){
 const [s0,s1]=validateElevationInterval(stationRange),[l0,l1]=validateElevationInterval(lateralRange);
 if(!section)return[0,0];
 validateRoadCrossSection(section);
 let factorLow=1,factorHigh=1;
 const smooth=d=>{const t=Math.max(0,Math.min(1,d/section.transitionLengthM));return t*t*(3-2*t);};
 for(const p of section.flatIntervals){
  const distance=s=>Math.max(p.startM-s,0,s-p.endM),
    low=s1<p.startM?p.startM-s1:s0>p.endM?s0-p.endM:0,
    high=Math.max(distance(s0),distance(s1));
  factorLow*=smooth(low);factorHigh*=smooth(high);
 }
 const raw=l=>section.crossSlope*l-section.crownSlope*Math.abs(l),values=[raw(l0),raw(l1)];
 if(l0<=0&&l1>=0)values.push(0);
 const low=Math.min(...values),high=Math.max(...values),products=[low*factorLow,low*factorHigh,high*factorLow,high*factorHigh];
 return[Math.min(...products),Math.max(...products)];
}

export function roadCrossSectionCurvatureBound(section,halfWidthM){
 if(!section)return 0;const n=section.flatIntervals.length;
 return halfWidthM*(Math.abs(section.crossSlope)+section.crownSlope)*(6*n+2.25*n*(n-1))/section.transitionLengthM**2;
}

/** Merge saved geometric exclusion intervals without inventing extra terrain. */
export function mergeFlatRoadIntervals(intervals,lengthM){
 const sorted=intervals.map(p=>({startM:Math.max(0,p.startM),endM:Math.min(lengthM,p.endM)})).sort((a,b)=>a.startM-b.startM),result=[];
 for(const p of sorted){if(p.endM<p.startM)continue;const last=result.at(-1);if(last&&p.startM<=last.endM+1e-7)last.endM=Math.max(last.endM,p.endM);else result.push(p);}
 return result;
}
