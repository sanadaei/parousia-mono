import {MATERIALIZATION_ARCHIVE_LIMIT} from '../core/materialization-archive.mjs';
/** Explicit user operations; no automatic download or overwrite. */
export function installSaveControls({exportButton,importInput,status,storage,download}){
 let busy=false;
 const enabled=()=>{exportButton.disabled=busy||!storage;importInput.disabled=busy||!storage;};enabled();
 if(!storage)status.textContent='この環境では永続保存を利用できません。';
 async function run(task){if(busy||!storage)return;busy=true;enabled();try{await task();}catch(e){status.textContent=`保存操作に失敗しました: ${e.message}`;}finally{busy=false;enabled();importInput.value='';}}
 exportButton.addEventListener('click',()=>run(async()=>{status.textContent='確定結果を書き出しています…';const text=await storage.exportArchive();await download(text,'planet-committed-results.json');status.textContent='確定結果を書き出しました。元の惑星ファイルも別途保管してください。';}));
 importInput.addEventListener('change',()=>{const file=importInput.files?.[0];if(!file)return;return run(async()=>{if(file.size>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('書出しファイルは16 MiBまでです');status.textContent='内容を検査しています…';const r=await storage.importArchive(await file.text());status.textContent=`${r.inserted}件を復元、${r.existing}件は保存済みと一致。既存の結果は変更していません。対象の惑星を開き直して確認してください。`;});});
}

/** Availability text is a capability description, not proof that a write succeeded. */
export function materializationStatusText({available,deferredPopulation=false}){
 if(available)return '近景は初回参照時に決めた結果を保存し、再訪時に読み戻します。保存に失敗した場合はエラーを表示します。別端末へ移す場合やサイトデータを消す前に、下の「確定結果を書き出す」で保存してください。元の惑星ファイルも必要です（書出しは16 MiBまで）。';
 return deferredPopulation?'この世界の集落を確定するにはブラウザの保存領域が必要です。現在は利用できません。':'この環境では近景の永続保存を利用できません。既存の再生成方式で表示します。';
}
