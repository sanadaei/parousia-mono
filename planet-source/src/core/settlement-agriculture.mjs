import {fieldOwnedBy} from './settlement-land-reservations.mjs';
import {planSettlementDistricts} from './settlement-districts.mjs';
import {createSphericalProjection,sphereBasis} from './spherical.mjs';
/** Land allocations derived from the same explicit cereal scenario as population.
 * Fixed 250m field cells surround, rather than replace, the residential footprint. */
export function planSettlementAgriculture(site,radiusM){
 const c=site.economicContext;if(site.kind==='city'||site.kind==='town')return{count:0,groups:0,areaHa:0,status:'supplied-by-regional-agricultural-hinterland'};if(!c||!(c.netGrainKgPerHa>0)||!(c.foodKgPerPersonYear>0))return{count:0,groups:0,areaHa:0};
 const areaHa=(c.agriculturalDependentPopulation??site.population)*c.foodKgPerPersonYear/c.netGrainKgPerHa,count=Math.ceil(areaHa/6.25),city=planSettlementDistricts(site,radiusM),inner=Math.ceil(city.extentM/250),innerCount=(2*inner+1)**2;
 if(count>200000)return{count:0,groups:0,areaHa,status:'agricultural-area-exceeds-local-budget'};
 const projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM,maxRadiusM:Math.min(radiusM*.1,Math.max(2000,(Math.sqrt(count+innerCount)+2)*250))});
 function plot(i){if(!Number.isInteger(i)||i<0||i>=count)throw new RangeError('Agricultural plot outside plan');const index=i+innerCount,ring=Math.ceil((Math.sqrt(index+1)-1)/2),side=ring*2,d=(2*ring+1)**2-1-index;let x,y;if(d<side){x=ring-d;y=-ring;}else if(d<2*side){x=-ring;y=-ring+d-side;}else if(d<3*side){x=-ring+d-2*side;y=ring;}else{x=ring;y=ring-d+3*side;}return{id:`${site.id}/field:${i}`,xM:x*250,yM:y*250,areaHa:Math.min(6.25,areaHa-i*6.25),...projection.toGeographic(x*250,y*250)};}
 return{method:'cereal-field-allocation@1',count,groups:Math.ceil(count/16),areaHa,plot,projection,innerCount,inner,extentM:(Math.ceil(Math.sqrt(count+innerCount))+2)*250};
}
export function agricultureDescriptors(site,radiusM,bound){const plan=planSettlementAgriculture(site,radiusM),result=[];if(!plan.count)return result;
 const centerGeo={latDeg:Math.asin(Math.max(-1,Math.min(1,bound.center[2])))*180/Math.PI,lonDeg:Math.atan2(bound.center[1],bound.center[0])*180/Math.PI},p=plan.projection.toLocalIfWithin(centerGeo.latDeg,centerGeo.lonDeg);if(!p)return result;
 const reach=bound.angular*radiusM+180,outer=Math.ceil((Math.sqrt(plan.count+plan.innerCount)-1)/2);
 const minX=Math.max(-outer,Math.floor((p.xM-reach)/250)),maxX=Math.min(outer,Math.ceil((p.xM+reach)/250)),minY=Math.max(-outer,Math.floor((p.yM-reach)/250)),maxY=Math.min(outer,Math.ceil((p.yM+reach)/250));
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const r=Math.max(Math.abs(x),Math.abs(y));if(r<=plan.inner)continue;const d=y===-r?r-x:x===-r?2*r+y+r:y===r?4*r+x+r:6*r+r-y,index=(2*r+1)**2-1-d-plan.innerCount;if(index<0||index>=plan.count||Math.hypot(x*250-p.xM,y*250-p.yM)>reach)continue;const q=plan.plot(index),center=sphereBasis(q).up;result.push({path:`procedural:${q.id}`,site,agriculturePlot:index,center,angularRadius:180/radiusM,verticalAllowanceM:0,bytes:2048,procedural:true});}return result;}
export function createAgricultureRecipe(base,site,index,{nearbySettlements=[]}={}){const plan=planSettlementAgriculture(site,base.frame.radiusM),plot=plan.plot(index),points=[],steps=4;let dry=true,min=Infinity,max=-Infinity;
 for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){const xM=plot.xM-120+x*60,yM=plot.yM-120+y*60,p=plan.projection.toGeographic(xM,yM),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg);dry&&=s.waterDepthM===0;min=Math.min(min,s.groundElevationM);max=Math.max(max,s.groundElevationM);points.push({xM,yM,elevationM:s.groundElevationM+.035});}
 const corners=[[-125,-125],[125,-125],[125,125],[-125,125]].map(([x,y])=>plan.projection.toGeographic(plot.xM+x,plot.yM+y)),owned=fieldOwnedBy(site,corners,nearbySettlements,base.frame.radiusM);
 const suitable=dry&&(max-min)/240<.12&&owned;
 return{id:plot.id,projection:plan.projection.contract,bounds:{minXM:plot.xM-125,maxXM:plot.xM+125,minYM:plot.yM-125,maxYM:plot.yM+125},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},buildings:[],buildingPads:[],roadCenterlineProfiles:[],landParcels:suitable?[{id:plot.id,type:'grain_field',sector:1,points,steps,areaHa:plot.areaHa,color:index%3===0?[.40,.42,.16]:index%3===1?[.37,.31,.15]:[.48,.44,.21]}]:[],landUseStatus:{id:plot.id,status:suitable?'surveyed-cereal-field':'unsuitable-land',reason:!owned?'other-settlement-reservation':!dry?'water':!suitable?'slope':null,areaHa:plot.areaHa,provenance:site.economicContext,limitations:['Crop rotation colours are visual land use, not seasonal yield simulation','Soil and access rights remain scenario assumptions']}};
}
import {WATER_SCHEMA} from './water-model.mjs';
