/** Bounded transport including body transfer, not only HTTP headers. Retries
 * stay in the streaming scheduler so cancellations and budgets remain visible. */
export async function readPage(fetcher, url, { signal, kind = 'arrayBuffer', timeoutMs = 15000,maxBytes=32*1024*1024 } = {}) {
  if(!['arrayBuffer','text'].includes(kind)||!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new TypeError('Invalid page request');
  const controller=new AbortController();let timer,onAbort;
  const deadline=new Promise((_,reject)=>{
    onAbort=()=>{controller.abort();reject(new DOMException('Cancelled','AbortError'));};
    if(signal?.aborted){onAbort();return;}
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new Error(`Page request timed out after ${timeoutMs} ms`));},timeoutMs);
  });
  try{return await Promise.race([deadline,(async()=>{
    if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
    const response=await fetcher(url,{signal:controller.signal});
    if(!response.ok)throw new Error(`Page HTTP ${response.status}`);
    const announced=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(announced)&&announced>maxBytes){controller.abort();throw new RangeError('Page exceeds transfer byte budget');}
    if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){controller.abort();await reader.cancel();throw new RangeError('Page exceeds transfer byte budget');}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return kind==='text'?new TextDecoder().decode(bytes):bytes.buffer;
      }finally{reader.releaseLock();}
    }
    const data=await response[kind](),size=kind==='text'?new TextEncoder().encode(data).byteLength:data.byteLength;
    if(size>maxBytes)throw new RangeError('Page exceeds transfer byte budget');return data;
  })()]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
