import {runVehicleJob} from './vehicle-job.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:runVehicleJob(data.job)});}catch(error){self.postMessage({id:data.id,error:{name:error.name,message:error.message}});}};
