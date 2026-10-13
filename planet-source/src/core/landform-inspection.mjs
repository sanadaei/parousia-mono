import {offsetGeographic,greatCircle} from './spherical.mjs';
/** Bounded navigation evidence, not a landform inventory or a summit detector.
 * Survey the saved surface, never modify terrain or infer relief from altitude alone. */
export function inspectLandforms(base,{perKind=3,candidateBudget=64}={}){
 if(!Number.isInteger(perKind)||perKind<0||perKind>8||!Number.isInteger(candidateBudget)||candidateBudget<1||candidateBudget>128)throw new RangeError('Invalid landform inspection budget');
 const snapshot=base.toSnapshot(),{columns,rows}=snapshot.grid,radiusM=snapshot.frame.radiusM,targets=[];
 let sampleCount=0,shapeSampleCount=0;
 for(const kind of ['hill','mountain']){
  if(!perKind)continue;
  const candidates=snapshot.fields.groundElevationM.map((z,i)=>({z,i})).filter(c=>Number.isFinite(c.z)&&(kind==='hill'?c.z>60&&c.z<1000:c.z>=1000)).sort((a,b)=>kind==='hill'?Math.abs(a.z-400)-Math.abs(b.z-400)||a.i-b.i:b.z-a.z||a.i-b.i).slice(0,candidateBudget);
  const surveyRadiusM=kind==='hill'?1000:2500;let accepted=0;
  for(const c of candidates){
   const surveyCenter={latDeg:90-(Math.floor(c.i/columns)+.5)*180/rows,lonDeg:(c.i%columns+.5)*360/columns};
   if(targets.some(p=>greatCircle(p,surveyCenter,radiusM).distanceM<100000))continue;
   const points=[];
   for(const distance of [0,surveyRadiusM*.5,surveyRadiusM])for(let k=0;k<(distance?16:1);k++){
    const p=offsetGeographic(surveyCenter,Math.cos(k*Math.PI/8)*distance,Math.sin(k*Math.PI/8)*distance,radiusM),q=base.sampleSurfaceAt(p.latDeg,p.lonDeg);sampleCount++;
    if(q.waterDepthM===0&&Number.isFinite(q.groundElevationM))points.push({...p,z:q.groundElevationM});
   }
   if(points.length<25)continue;
   const high=points.reduce((a,b)=>a.z>b.z?a:b),low=Math.min(...points.map(p=>p.z)),reliefM=high.z-low;
   if(kind==='hill'?(reliefM<30||reliefM>250):reliefM<250)continue;
   targets.push({id:`${kind}:${c.i}`,kind,name:`${kind==='hill'?'丘陵':'山地'}の起伏 ${++accepted}`,sourceCell:c.i,latDeg:high.latDeg,lonDeg:high.lonDeg,
    surveyCenter,surveyRadiusM,drySamples:points.length,totalSamples:33,minElevationM:low,maxElevationM:high.z,reliefM,viewAltitudeM:kind==='hill'?800:2000});
   const target=targets.at(-1),shapeCenter={latDeg:target.latDeg,lonDeg:target.lonDeg};
   const radiiM=[250,2500,25000].filter(r=>r<=radiusM*.02);
   if(radiiM.length){target.shapeContext=inspectLandformShape((east,north)=>{const q=offsetGeographic(shapeCenter,east,north,radiusM);return base.sampleSurfaceAt(q.latDeg,q.lonDeg).groundElevationM;},{radiiM});shapeSampleCount+=target.shapeContext.sampleCount;}
   if(accepted>=perKind)break;
  }
 }
 return {schema:'planet-landform-inspection@1',method:'bounded-dry-surface-samples',perKind,candidateBudget,sampleCount,shapeSampleCount,targets,
  limitation:'Sampled ranges are not exhaustive extrema. Hill/mountain labels are inspection categories, not geomorphological proof. Missing targets do not prove missing relief.'};
}

// Count-based ten-form grouping from the published GRASS geomorphon legend.
// This direct continuous-surface, finite-ray sampler is NOT a port of GRASS:
// no raster traversal, extended correction, flat-distance or 498-pattern output.
// https://grass.osgeo.org/grass-stable/manuals/r.geomorphon.html
const FORM_ROWS=[
 ['flat','flat','flat','footslope','footslope','valley','valley','valley','pit'],
 ['flat','flat','footslope','footslope','footslope','valley','valley','valley'],
 ['flat','shoulder','slope','slope','hollow','hollow','valley'],
 ['shoulder','shoulder','slope','slope','hollow','hollow'],
 ['shoulder','shoulder','spur','slope','slope'],
 ['ridge','ridge','spur','spur'],
 ['ridge','ridge','ridge'],
 ['ridge','ridge'],
 ['peak'],
];
export const LANDFORM_SHAPE_LABELS=Object.freeze({flat:'平坦面',peak:'頂部',ridge:'尾根状',shoulder:'斜面の肩',spur:'張り出した斜面',slope:'斜面',hollow:'くぼんだ斜面',footslope:'斜面の裾',valley:'谷状',pit:'くぼ地',unknown:'判定できない'});
export function classifyLandformDirections(signs){
 if(!Array.isArray(signs)||signs.length!==8||signs.some(v=>![-1,0,1].includes(v)))throw new RangeError('Eight ternary directions required');
 const above=signs.filter(v=>v>0).length,below=signs.filter(v=>v<0).length;
 return FORM_ROWS[below][above];
}
/** Query the SAME saved surface at fixed physical distances. No randomness,
 * terrain edits, camera LOD or geological-cause inference. All heights are
 * ground heights; a pit is not automatically a lake, nor a valley a river. */
export function inspectLandformShape(groundAt,{radiiM=[250,2500,25000],stepsPerRay=16,flatThresholdDeg=1}={}){
 if(typeof groundAt!=='function'||!Array.isArray(radiiM)||radiiM.length<1||radiiM.length>4||radiiM.some((v,i)=>!Number.isFinite(v)||v<1||v>100000||(i&&v<=radiiM[i-1]))||!Number.isSafeInteger(stepsPerRay)||stepsPerRay<2||stepsPerRay>64||!Number.isFinite(flatThresholdDeg)||flatThresholdDeg<=0||flatThresholdDeg>10)throw new RangeError('Invalid bounded landform shape survey');
 const center=groundAt(0,0);let sampleCount=1;
 const scales=radiiM.map(radiusM=>{
  const directions=[];let low=center,high=center,missing=0;
  for(let k=0;k<8;k++){
   let minAngle=Infinity,maxAngle=-Infinity,valid=0;
   for(let step=1;step<=stepsPerRay;step++){
    const distanceM=radiusM*step/stepsPerRay,angle=k*Math.PI/4,z=groundAt(distanceM*Math.cos(angle),distanceM*Math.sin(angle));sampleCount++;
    if(!Number.isFinite(z)||!Number.isFinite(center)){missing++;continue;}
    valid++;low=Math.min(low,z);high=Math.max(high,z);const a=Math.atan2(z-center,distanceM)*180/Math.PI;minAngle=Math.min(minAngle,a);maxAngle=Math.max(maxAngle,a);
   }
   const balance=valid===stepsPerRay?minAngle+maxAngle:null;
   directions.push({azimuthFromEastDeg:k*45,minAngleDeg:valid?minAngle:null,maxAngleDeg:valid?maxAngle:null,sign:balance===null?null:Math.abs(balance)<=flatThresholdDeg?0:Math.sign(balance)});
  }
  const form=missing?'unknown':classifyLandformDirections(directions.map(d=>d.sign));
  return{radiusM,stepM:radiusM/stepsPerRay,form,label:LANDFORM_SHAPE_LABELS[form],missingSamples:missing,sampledReliefM:missing?null:high-low,directions};
 });
 return{method:'finite-eight-ray-ground-shape@1',flatThresholdDeg,stepsPerRay,sampleCount,scales,
  scope:'Scale-dependent geometric ground shape, not Terrain22 regional classes or a GRASS reproduction. Finite radial samples can miss features. No geological cause, hydrology, land-cover or exhaustive extrema are inferred.'};
}
export function landformShapeSummary(shape){
 if(!shape?.scales?.length)return'';
 return ' 地盤の形（範囲別の参考判定）：'+shape.scales.map(s=>`${s.radiusM<1000?s.radiusM+'m':s.radiusM/1000+'km'} → ${LANDFORM_SHAPE_LABELS[s.form]??LANDFORM_SHAPE_LABELS.unknown}`).join('、')+'。成因や川・湖の存在を示す判定ではありません。';
}
