import {hashJson,cloneJson} from './json-contract.mjs';
export const MATERIALIZATION_ARCHIVE_LIMIT=16*1024*1024;
export const MATERIALIZATION_ARCHIVE_COUNT=10000;
export function validateMaterializationRecord(record){
 cloneJson(record);
 if(record?.schema!=='committed-materialization@1'||typeof record.worldId!=='string'||!record.worldId||typeof record.entityId!=='string'||!record.entityId||record.key!==JSON.stringify([record.worldId,record.entityId])||!/^sha256:[a-f0-9]{64}$/.test(record.conditionsHash)||typeof record.generator!=='string'||!record.generator||record.contentHash!==hashJson(record.value))throw new Error('Invalid or corrupt saved materialization');
 const text=JSON.stringify(record);if(new TextEncoder().encode(text).length>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('Record exceeds archive budget');return text;
}
export function encodeMaterializationArchive(records){
 if(!Array.isArray(records)||records.length>MATERIALIZATION_ARCHIVE_COUNT)throw new RangeError('Too many archive records');
 const seen=new Set();let bytes=0;for(const r of records){bytes+=new TextEncoder().encode(validateMaterializationRecord(r)).length;if(bytes>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('Archive exceeds bounded transfer size');if(seen.has(r.key))throw new Error('Duplicate materialization identity');seen.add(r.key);}
 const payload={schema:'planet-materialization-archive@1',requiresOriginalPlanet:true,records},text=JSON.stringify({...payload,contentHash:hashJson(payload)});
 if(new TextEncoder().encode(text).length>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('Archive exceeds bounded transfer size');return text;
}
export function decodeMaterializationArchive(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('Invalid archive size');
 const archive=JSON.parse(text);if(!archive||typeof archive!=='object')throw new TypeError('Invalid archive');const{contentHash,...payload}=archive;
 if(payload.schema!=='planet-materialization-archive@1'||payload.requiresOriginalPlanet!==true||!Array.isArray(payload.records)||payload.records.length>MATERIALIZATION_ARCHIVE_COUNT||contentHash!==hashJson(payload))throw new Error('Invalid or corrupt archive');
 encodeMaterializationArchive(payload.records);return payload.records;
}
