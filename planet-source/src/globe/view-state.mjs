import {sphereBasis} from '../core/spherical.mjs';
import {normalize,cross,length} from './cube.mjs';
export function saveView(worldId,state){return validateView({schema:'planet-view@1',worldId,point:{...state.point},altitude:state.altitude,tilt:state.tilt,heading:state.heading},worldId);}
export function validateView(input,worldId){const s=typeof input==='string'?JSON.parse(input):input;
 if(s?.schema!=='planet-view@1'||s.worldId!==worldId)throw new TypeError('View belongs to another world');
 if(!s.point||![s.point.latDeg,s.point.lonDeg,s.altitude,s.tilt,s.heading].every(Number.isFinite)||Math.abs(s.point.latDeg)>90||s.altitude<3||s.altitude>40000000||s.tilt<0||s.tilt>70*Math.PI/180)throw new RangeError('Invalid saved camera');
 return {schema:s.schema,worldId,point:{latDeg:s.point.latDeg,lonDeg:((s.point.lonDeg+180)%360+360)%360-180},altitude:s.altitude,tilt:s.tilt,heading:s.heading};
}

/** Plain-language status for the ground actually drawn, not only a future plan.
 * This deliberately makes no claim about water edges, buildings or frame rate. */
export function groundDisplaySummary(stats,{drawTiles=0,software=false}={}){
 if(!stats||!drawTiles)return '地面の表示を準備しています';
 if(stats.workerRecovery?.some(w=>w.failures>0&&!w.ready))return '地形の読み込みを再試行しています';
 const q=stats.displayedQuality;
 const waterReady=!q?.submergedGroundTiles||(q.constantWaterOverTargetTiles===0&&Number.isFinite(q.maxConstantWaterErrorPixels)&&q.maxConstantWaterErrorPixels<=2);
 const subject=q?.submergedGroundTiles?'地面・一様な水面':'地面';
 if(q&&waterReady&&q.unknownGroundTiles===0&&q.groundOverTargetTiles===0&&Number.isFinite(q.maxGroundErrorPixels)&&q.maxGroundErrorPixels<=2)
  return software?`${subject}：診断解像度で目標の細かさに到達`:`${subject}：目標の細かさに到達`;
 const pending=stats.activeWorkers>0||stats.pendingUploads>0||stats.planningActive||stats.planningQueued;
 if(stats.lodQuality?.budgetLimited)return '地面：現在の表示予算では細部を表示しきれていません'+(pending?'（予算内の地形は読み込み中）':'');
 if(pending)return '近くの地面を細かく読み込んでいます';
 return '地面：この視点では目標の細かさに未到達';
}

/** North-up at zero tilt; orbit toward the viewer, so local up stays upward.
 * Putting the eye in front of the target inverted the oblique horizon and
 * made near houses appear above distant ones. This changes the camera only. */
export function createOrbitCamera(state,{radiusM,heightScale=1,aspect=1}){
 const basis=sphereBasis(state.point),horizontal=basis.north.map((v,i)=>v*Math.cos(state.heading)+basis.east[i]*Math.sin(state.heading));
 const eye=basis.up.map((v,i)=>v*(radiusM+state.ground*heightScale+state.altitude*Math.cos(state.tilt))-horizontal[i]*state.altitude*Math.sin(state.tilt)),forward=normalize(basis.up.map((v,i)=>v*(radiusM+state.ground*heightScale)-eye[i])),right=normalize(cross(forward,horizontal)),up=cross(right,forward);
 return{heightScale,eye,eyeUnit:normalize(eye),targetUp:basis.up,forward,right,up,altitude:state.altitude,focal:1/Math.tan(Math.PI/8),near:Math.max(.02,Math.min(1000,state.altitude*.002)),far:length(eye)+radiusM*2,aspect,groundReference:state.groundReference};
}

/** A referral is a pending transport decision, never a constructed crossing. */
export function roadDisplaySummary(routes=[]){
 if(!routes.length)return '';
 const surveyed=routes.filter(r=>r.status==='surveyed-local-route').length,crossings=routes.filter(r=>r.status==='requires-regional-crossing-plan').length,other=routes.length-surveyed-crossings;
 return `付近の道路：地形測量済み ${surveyed} / 川を渡る計画が必要 ${crossings} / その他の未解決 ${other}${crossings?'（渡し船・大型橋・迂回路は未建設）':''}`;
}
