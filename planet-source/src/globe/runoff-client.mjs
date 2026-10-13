/** One bounded calculation at a time. Termination really interrupts a long Core
 * step; the UI retains its last completed state rather than a half-updated one. */
export class RunoffClient{
 constructor({createWorker=()=>new Worker(new URL('./runoff-worker.mjs',import.meta.url),{type:'module'}),timeoutMs=120000,label="Runoff",cancelMessage="計算を中断しました。直前に完了した状態を保持しています"}={}){this.cancelMessage=cancelMessage;this.label=label;this.createWorker=createWorker;this.timeoutMs=timeoutMs;this.worker=null;this.pending=null;this.sequence=0;}
 request(job){
  if(this.pending)return Promise.reject(new Error('A runoff job is already running'));
  return new Promise((resolve,reject)=>{
   const id=++this.sequence;
   try{
    if(!this.worker){const worker=this.worker=this.createWorker();worker.onmessage=({data})=>{if(worker!==this.worker||data.id!==this.pending?.id)return;const p=this.pending;this.pending=null;clearTimeout(p.timer);if(data.error){const error=new Error(data.error.message);error.name=data.error.name;p.reject(error);}else p.resolve(data.result);};worker.onerror=e=>{if(worker!==this.worker)return;this.cancel(new Error(e.message||this.label+' worker failed'));};worker.onmessageerror=()=>{if(worker===this.worker)this.cancel(new Error(this.label+' result could not be received'));};}
    const timer=setTimeout(()=>this.cancel(new Error(this.label+' calculation timed out')),this.timeoutMs);this.pending={id,resolve,reject,timer};this.worker.postMessage({id,job});
   }catch(error){if(this.pending){clearTimeout(this.pending.timer);this.pending=null;}this.worker?.terminate();this.worker=null;reject(error);}
  });
 }
 cancel(error=Object.assign(new Error(this.cancelMessage),{name:'AbortError'})){
  this.worker?.terminate();this.worker=null;const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(error);}
 }
}
