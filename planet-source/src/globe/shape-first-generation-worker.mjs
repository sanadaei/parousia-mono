import {generateShapeFirstBundle} from './shape-first-generated.mjs';
self.onmessage=event=>{
  try{self.postMessage({ok:true,bundle:generateShapeFirstBundle(event.data.seed)});}
  catch(error){self.postMessage({ok:false,error:error.message});}
};
