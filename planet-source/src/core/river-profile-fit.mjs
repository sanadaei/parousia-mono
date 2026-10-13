/** Feasible monotone water profile inside per-point elevation intervals.
 * Backwards propagation prevents an early greedy drop from making a later
 * (still legally incisable) ridge impossible. Endpoints remain explicit. */
export function fitMonotoneWaterProfile(points,{startLevelM,endLevelM=null}={}){
 if(!Array.isArray(points)||points.length<2||points.length>4097||!Number.isFinite(startLevelM)||endLevelM!==null&&!Number.isFinite(endLevelM))throw new TypeError('Invalid profile fit');
 const lower=points.map((p,i)=>{if(![p.minimumLevelM,p.maximumLevelM,p.preferredLevelM].every(Number.isFinite)||p.minimumLevelM>p.maximumLevelM)throw new RangeError(`Invalid profile interval ${i}`);return p.minimumLevelM;});
 if(endLevelM!==null)lower[lower.length-1]=Math.max(lower.at(-1),endLevelM);
 for(let i=lower.length-2;i>=0;i--)lower[i]=Math.max(lower[i],lower[i+1]);
 const levels=[];let previous=startLevelM;
 for(let i=0;i<points.length;i++){const p=points[i],upper=Math.min(previous,p.maximumLevelM),fixed=i===0?startLevelM:i===points.length-1?endLevelM:null,level=fixed??Math.max(lower[i],Math.min(upper,p.preferredLevelM));
 if(level<lower[i]-1e-8||level>upper+1e-8)return{valid:false,index:i,requiredMinimumM:lower[i],allowedMaximumM:upper,fixedLevelM:fixed};
 levels.push(level);previous=level;
 }return{valid:true,levels};
}
