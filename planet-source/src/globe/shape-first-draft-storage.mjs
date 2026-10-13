/** Separate append-only draft store; never writes adopted planet records. */
const DB='planet-shape-first-drafts',STORE='drafts';
function openDatabase(indexedDBAPI) {
  return new Promise((resolve,reject)=>{
    if(!indexedDBAPI){reject(new Error('ブラウザ保存を利用できません'));return;}
    const request=indexedDBAPI.open(DB,1);let settled=false;
    const fail=message=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error(message));}};
    const timer=setTimeout(()=>fail('ブラウザ保存の準備がタイムアウトしました'),10000);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE,{keyPath:'seed'});};
    request.onerror=()=>fail(request.error?.message??'ブラウザ保存を開けません');
    request.onblocked=()=>fail('別のタブが保存領域の準備を妨げています');
    request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;clearTimeout(timer);resolve(request.result);};
  });
}
export function createShapeFirstDraftStore(indexedDBAPI=globalThis.indexedDB) {
  return {
    async read(seed){
      const db=await openDatabase(indexedDBAPI);
      try{return await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readonly'),request=transaction.objectStore(STORE).get(seed);let result=null;request.onsuccess=()=>{result=request.result??null;};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error??new Error('保存形状を読めません'));transaction.onabort=()=>reject(transaction.error??new Error('保存形状の読込が中断されました'));});}finally{db.close();}
    },
    async keepFirst(record){
      const db=await openDatabase(indexedDBAPI);
      try{return await new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,'readwrite'),store=transaction.objectStore(STORE),request=store.get(record.seed);let result;
        request.onsuccess=()=>{result=request.result??record;if(!request.result)store.add(record);};
        transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error??new Error('保存容量が不足している可能性があります'));transaction.onabort=()=>reject(transaction.error??new Error('形状の保存が中断されました'));
      });}finally{db.close();}
    },
  };
}
