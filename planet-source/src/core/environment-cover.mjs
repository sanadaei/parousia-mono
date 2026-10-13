/** Potential land cover, separate from biome (regional climate) and human
 * land use. These are bounded game-world rules, not surveyed ecology. */
export const ENVIRONMENT_POLICY='climate-water-cover@1';
export const VALLEY_ENVIRONMENT_POLICY='valley-water-cover@2';
export const usesEnvironmentPolicy=policy=>[ENVIRONMENT_POLICY,VALLEY_ENVIRONMENT_POLICY].includes(policy);
export const environmentRiverReach=(policy,sampler)=>policy===VALLEY_ENVIRONMENT_POLICY?(sampler?.environmentReachM??1000):200;
export const COVER_TYPES=Object.freeze({
 forest:{label:'森林',color:[.17,.32,.16],treeCover:.9,travelCost:1.8},
 woodland:{label:'疎林',color:[.32,.43,.20],treeCover:.45,travelCost:1.4},
 grassland:{label:'草原',color:[.55,.57,.29],treeCover:.02,travelCost:1},
 scrub:{label:'低木地',color:[.48,.47,.28],treeCover:.12,travelCost:1.5},
 desert:{label:'乾燥裸地',color:[.73,.65,.45],treeCover:0,travelCost:1.6},
 rock:{label:'露岩',color:[.51,.49,.44],treeCover:0,travelCost:2},
 tundra:{label:'寒冷草地',color:[.58,.59,.43],treeCover:0,travelCost:1.5},
 snow:{label:'雪氷域',color:[.86,.89,.88],treeCover:0,travelCost:3},
 riparian_woodland:{label:'河畔林',color:[.19,.40,.24],treeCover:.75,travelCost:1.8},
 wetland:{label:'湿地',color:[.31,.46,.37],treeCover:0,travelCost:5},
 water:{label:'水面',color:[.13,.36,.48],treeCover:0,travelCost:null}
});
const clamp=v=>Math.max(0,Math.min(1,v));
export function classifyEnvironment({biome,temperatureC,annualRainMm,soilMoisture,
 slopeMPerM=0,waterDepthM=0,riverDistanceM=null,heightAboveRiverM=null,patch=0,policy=ENVIRONMENT_POLICY,valleyFloorWidthM=0}){
 if(![temperatureC,annualRainMm,soilMoisture,slopeMPerM,waterDepthM,patch].every(Number.isFinite)||annualRainMm<0||soilMoisture<0||soilMoisture>1||slopeMPerM<0||waterDepthM<0||patch< -1||patch>1)
   throw new RangeError('Invalid environment conditions');
 for(const v of [riverDistanceM,heightAboveRiverM])if(v!==null&&!Number.isFinite(v))throw new RangeError('Invalid river proximity');
 if(riverDistanceM!==null&&riverDistanceM<0)throw new RangeError('Negative river distance');
 if(!usesEnvironmentPolicy(policy)||!Number.isFinite(valleyFloorWidthM)||valleyFloorWidthM<0||valleyFloorWidthM>5000)throw new RangeError('Invalid valley environment policy or width');
 // Keep the complete influence inside the bounded 1 km runtime query.
 const floorWidth=policy===VALLEY_ENVIRONMENT_POLICY?Math.min(820,valleyFloorWidthM):0;
 const riparian=riverDistanceM===null||heightAboveRiverM===null?0:
   clamp(1-Math.max(0,riverDistanceM-floorWidth)/180)*clamp(1-Math.max(0,heightAboveRiverM)/8);
 const wetness=clamp(soilMoisture+(.8-soilMoisture)*riparian),reasons=['regional-climate','soil-water-scenario'];
 if(floorWidth>0&&riparian>0)reasons.push('saved-valley-floor-context');
 let kind;
 if(waterDepthM>0){kind='water';reasons.push('existing-water-surface');}
 else if(biome==='ice'){kind='snow';reasons.push('cold-climate');}
 else if(slopeMPerM>.65){kind='rock';reasons.push('steep-exposure');}
 else if(riparian>.5&&slopeMPerM<.04&&temperatureC>0&&wetness>.65){kind='wetland';reasons.push('low-gentle-river-margin');}
 else if(riparian>.25&&temperatureC>3){kind='riparian_woodland';reasons.push('river-water-access');}
 else if(biome==='tundra'){kind='tundra';}
 else if(biome==='desert'){kind='desert';}
 else if(biome==='shrubland'||biome==='mediterranean'){kind=wetness+.12*patch>.6?'woodland':'scrub';}
 else if(biome==='grassland'){kind=wetness+.12*patch>.8?'woodland':'grassland';}
 else if(biome==='savanna'){kind=wetness+.2*patch>.5?'woodland':'grassland';}
 else if(['tropical_forest','temperate_forest','boreal'].includes(biome)){
   kind=wetness+.15*patch>.32?'forest':wetness+.15*patch>.12?'woodland':'grassland';
 }else{kind=annualRainMm<250?'desert':wetness>.5?'woodland':'grassland';}
 const type=COVER_TYPES[kind];
 return {kind,...type,wetness,riparianInfluence:riparian,reasons,policy,...(policy===VALLEY_ENVIRONMENT_POLICY?{valleyFloorWidthM:floorWidth}:{}),
   basis:'potential-cover-scenario; soil, disturbance and species not surveyed'};
}

export function climateTravelResistance(climate){
 const n=climate?.biome?.length;
 if(!n||n>32768||climate.catchmentWater?.meanSoilMoisture?.length!==n)throw new RangeError('Climate water data required');
 return climate.biome.map((biome,i)=>['ocean','lake'].includes(biome)?1:
   classifyEnvironment({biome,temperatureC:climate.annualMeanTemperatureC[i],annualRainMm:climate.annualPrecipitationMm[i],soilMoisture:climate.catchmentWater.meanSoilMoisture[i]}).travelCost);
}
