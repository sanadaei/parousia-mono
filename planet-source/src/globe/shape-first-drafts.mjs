import {validateShapeFirstView} from './shape-first-placement.mjs';
import {prepareGeneratedShapeFirstModel} from './shape-first-generated.mjs';
import {createShapeFirstDraftStore} from './shape-first-draft-storage.mjs';
const memory=new Map();
export function makeShapeFirstDraft(seed,bundle) {
  return {schema:'shape-first-runtime-draft@1',seed,sourceSha256:bundle.pyramid.provenance.sourceSha256,createdAt:new Date().toISOString(),bundle};
}
export async function validateShapeFirstDraft(record,expectedSeed=record?.seed) {
  if(record?.schema!=='shape-first-runtime-draft@1'||typeof record.seed!=='string'||!record.seed.trim()||record.seed.length>128||record.seed!==expectedSeed)throw new Error('保存形状のseedまたは形式が一致しません');
  validateShapeFirstView(record.view);
  const model=await prepareGeneratedShapeFirstModel(record.bundle,record.seed);
  if(model.candidate.seed!==record.seed||record.sourceSha256!==model.pyramid.provenance.sourceSha256)throw new Error('保存形状の識別子が一致しません');
  return model;
}
export function rememberShapeFirstDraft(record){
  memory.delete(record.seed);memory.set(record.seed,record);
  // Persistent storage owns history; retain only a few temporary/export fallbacks.
  while(memory.size>4)memory.delete(memory.keys().next().value);
}
export async function readShapeFirstDraft(seed,{store=createShapeFirstDraftStore()}={}) {
  // Persistent storage is authoritative; never regenerate if its content is invalid.
  let record;
  try{record=await store.read(seed);}catch(error){return {record:memory.get(seed)??null,warning:error.message,persistent:false};}
  return {record:record??memory.get(seed)??null,persistent:!!record,warning:null};
}
export async function saveShapeFirstDraft(record,{store=createShapeFirstDraftStore()}={}) {
  let kept;
  try{kept=await store.keepFirst(record);}
  catch(error){rememberShapeFirstDraft(record);return {record,persistent:false,warning:error.message};}
  await validateShapeFirstDraft(kept,record.seed);rememberShapeFirstDraft(kept);return {record:kept,persistent:true,warning:null};
}
export async function exportShapeFirstDraft(seed,options={}) {
  if(seed===null)throw new Error('保存形状 A は同梱済みです。seed生成した形状を選んでください。');
  const {record}=await readShapeFirstDraft(seed,options);if(!record)throw new Error('まだ生成を完了していません');await validateShapeFirstDraft(record,seed);return JSON.stringify({...record,...(options.view?{view:validateShapeFirstView(options.view)}:{})});
}
export async function importShapeFirstDraft(text,{store=createShapeFirstDraftStore()}={}) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>16*1024*1024)throw new Error('記録は16 MiB以下にしてください');
  const record=JSON.parse(text);await validateShapeFirstDraft(record);
  // An import must be persisted before navigation. Never overwrite a same-seed draft.
  const kept=await store.keepFirst(record);await validateShapeFirstDraft(kept,record.seed);
  if(kept.sourceSha256!==record.sourceSha256)throw new Error('同じseedに別の形状が保存されています。既存の形状は変更していません。');
  rememberShapeFirstDraft(kept);return {...kept,...(record.view?{view:record.view}:{})};
}
