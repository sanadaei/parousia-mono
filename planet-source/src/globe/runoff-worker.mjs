import {runRunoffJob} from './runoff-job.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:runRunoffJob(data.job)});}catch(error){self.postMessage({id:data.id,error:{name:error.name,message:error.message}});}};
