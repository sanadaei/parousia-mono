import {captureShapeFirstView,restoreShapeFirstView} from './shape-first-placement.mjs';
import {exportShapeFirstDraft,importShapeFirstDraft} from './shape-first-drafts.mjs';
export function shapeSourceURL(href,seed) {
  const next=new URL(href),previousSeed=next.searchParams.get('sfSeed');
  // A deliberate source change requests a new placement; old derived outlet and
  // auto datum must not be mistaken for constraints on the new river shape.
  if(previousSeed!==seed){next.searchParams.delete('sfOutletIdentity');next.searchParams.delete('sfElevation');}
  if(seed===null)next.searchParams.delete('sfSeed');
  else {if(typeof seed!=='string'||!seed.trim()||seed.length>128)throw new TypeError('seed は1〜128文字で入力してください');next.searchParams.set('sfSeed',seed);}
  return next.href;
}
/** Shared source controls used by normal planet and regional inspector. */
export function installShapeFirstSourceControls(container,{onChange=href=>{location.href=href;}}={}) {
  const current=new URL(location.href).searchParams.get('sfSeed');
  const label=document.createElement('label');label.textContent='形状の入力';
  const select=document.createElement('select');select.id='sf-source';select.setAttribute('aria-label','形状の入力');
  for(const[value,text]of[['saved','保存した形状 A'],['generated','seed から別の地域を生成']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.value=current===null?'saved':'generated';label.append(select);
  const form=document.createElement('form');form.id='sf-source-form';form.hidden=current===null;
  const seedLabel=document.createElement('label');seedLabel.textContent='地形 seed';const input=document.createElement('input');input.id='sf-seed';input.name='seed';input.type='text';input.maxLength=128;input.required=true;input.value=current??'shape-first-1';input.setAttribute('aria-label','地形 seed');input.style.cssText='display:block;width:100%;padding:8px;margin-top:5px;box-sizing:border-box;';seedLabel.append(input);
  const button=document.createElement('button');button.id='sf-generate';button.type='submit';button.textContent='生成して表示';
  const note=document.createElement('small');note.textContent='同じseedは同じ形状。新しい形から階層・仮の水供給を導きます。保存済みの惑星は変更しません。';
  const error=document.createElement('p');error.id='sf-source-error';error.setAttribute('role','alert');error.hidden=true;
  form.append(seedLabel,button,note,error);container.append(label,form);
  const transfer=document.createElement('details'),summary=document.createElement('summary');summary.textContent='生成した形状を保存・復元';transfer.append(summary);
  const help=document.createElement('p');help.textContent='初回の形状をこのブラウザに保存し、次回も同じデータを使います。別のブラウザへ移す場合は記録を書き出してください。保存不可の場合は一時表示です。';transfer.append(help);
  const exportButton=document.createElement('button');exportButton.id='sf-export';exportButton.type='button';exportButton.textContent='生成形状の記録を書き出す';
  const importLabel=document.createElement('label');importLabel.textContent='記録から復元（16 MiB以下）';const file=document.createElement('input');file.id='sf-import';file.type='file';file.accept='.json,application/json';file.style.maxWidth='100%';importLabel.append(file);
  const transferStatus=document.createElement('p');transferStatus.id='sf-transfer-status';transferStatus.setAttribute('role','status');transfer.append(exportButton,importLabel,transferStatus);container.append(transfer);
  exportButton.onclick=async()=>{exportButton.disabled=true;try{const seed=new URL(location.href).searchParams.get('sfSeed'),text=await exportShapeFirstDraft(seed,{view:captureShapeFirstView(location.href)}),href=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=href;link.download='planet-shape-first-draft.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);transferStatus.textContent='形状・川筋・階層・仮の供給量と現在の惑星配置の記録を書き出しました。';}catch(e){transferStatus.textContent=e.message;}finally{exportButton.disabled=false;}};
  file.onchange=async()=>{const selected=file.files[0];if(!selected)return;file.disabled=true;try{if(selected.size>16*1024*1024)throw new Error('記録は16 MiB以下にしてください');const record=await importShapeFirstDraft(await selected.text());transferStatus.textContent='保存した形状を復元しました。';select.value='generated';form.hidden=false;input.value=record.seed;const restored=restoreShapeFirstView(location.href,record);if(record.view)location.href=restored;else onChange(restored);}catch(e){transferStatus.textContent=`復元できません: ${e.message}`;}finally{file.disabled=false;file.value='';}};

  select.onchange=()=>{error.hidden=true;form.hidden=select.value==='saved';if(select.value==='saved')onChange(shapeSourceURL(location.href,null));else input.focus();};
  form.onsubmit=event=>{event.preventDefault();try{const href=shapeSourceURL(location.href,input.value);error.hidden=true;onChange(href);}catch(e){error.textContent=e.message;error.hidden=false;}};
  return {select,input,form};
}
