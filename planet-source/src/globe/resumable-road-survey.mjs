import {cooperativeYield} from './cooperative-yield.mjs';
export class RoadSurveyPending extends Error{constructor(){super('Road survey is still being prepared');this.name='RoadSurveyPending';}}
/** One unfinished survey per source. Only completed recipes may be committed.
 * A cancelled display request pauses its iterator; leaving the view may drop
 * uncommitted work. Previously committed results live in separate storage. */
export class ResumableRoadSurvey{
 constructor(){this.job=null;}
 retain(keys){if(this.job&&!keys.has(this.job.owner)&&!this.job.running)this.job=null;}
 forget(key){if(this.job?.key===key&&!this.job.running)this.job=null;}
 async advance(key,create,{steps=1,signal,recover=null,owner=null}={}){
  if(!Number.isSafeInteger(steps)||steps<1||steps>64)throw new RangeError('Invalid road work slice');
  const abort=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};abort();
  if(this.job&&(this.job.key!==key||this.job.running))throw new RoadSurveyPending();
  const job=this.job??={key,owner,iterator:null,running:false,restarts:0,done:false,value:null};job.running=true;
  try{
   job.iterator??=await create();abort();
   for(let i=0;i<steps&&!job.done;i++){
    let step;try{step=job.iterator.next();}catch(error){job.iterator=null;
     if(recover&&job.restarts<32&&await recover(error)){job.restarts++;job.iterator=null;throw new RoadSurveyPending();}
     this.job=null;throw error;
    }
    job.done=step.done;if(step.done)job.value=step.value;else await cooperativeYield();abort();
   }
   if(!job.done)throw new RoadSurveyPending();return job.value;
  }catch(error){if(error.name!=='RoadSurveyPending'&&error.name!=='AbortError')this.job=null;throw error;}
  finally{job.running=false;}
 }
}
