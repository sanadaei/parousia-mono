import {installPageRecovery} from './page-lifecycle.mjs';
import {runoffWaterDepths} from '../core/runoff-storage.mjs';
import {worldSnapshotRequest} from './world-link.mjs';
import {readPage} from './page-request.mjs';
import {RunoffClient} from './runoff-client.mjs';
const $=id=>document.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d'),controller=new AbortController();
let world,state,snapshot,expectedWorldId,busy=false,stop=false,assessmentOverlay=null;
const calculation=new RunoffClient();
const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
function buttons(){for(const id of ['run','reset','place','rain','drainage','supports','storage','assess-catchment','storm-minutes','runoff-coefficient','travel-speed','design-upstream','design-downstream','collector-width'])$(id).disabled=!world||busy;$('stop').disabled=!busy;$('storage').disabled=!world||busy||!$('supports').checked;}
function draw(){const {columns:w,rows:h,cellSizeM:c,groundElevationM:g,waterVolumeM3:v}=state,lo=Math.min(...g),hi=Math.max(...g),dx=canvas.width/w,dy=canvas.height/h,depths=runoffWaterDepths(state);
 for(let i=0;i<g.length;i++){const depth=depths[i],t=(g[i]-lo)/Math.max(1,hi-lo);ctx.fillStyle=depth>1?'#164d91':depth>.1?'#368ec4':depth>.001?'#9cd9e7':`rgb(${Math.round(105+70*t)},${Math.round(95+55*t)},${Math.round(62+45*t)})`;ctx.fillRect(i%w*dx,Math.floor(i/w)*dy,Math.ceil(dx),Math.ceil(dy));}
 ctx.strokeStyle='#f59655';ctx.lineWidth=2;for(const face of state.faceObstructions??[]){const x=face.fromCell%w,y=Math.floor(face.fromCell/w),vertical=face.toCell===face.fromCell+1;for(const piece of face.pieces){ctx.beginPath();ctx.moveTo((x+(vertical?1:piece.start))*dx,(y+(vertical?piece.start:1))*dy);ctx.lineTo((x+(vertical?1:piece.end))*dx,(y+(vertical?piece.end:1))*dy);ctx.stroke();}}
 ctx.strokeStyle='#ffdc63';ctx.lineWidth=2;for(const link of state.culverts){ctx.beginPath();ctx.moveTo((link.fromCell%w+.5)*dx,(Math.floor(link.fromCell/w)+.5)*dy);ctx.lineTo((link.toCell%w+.5)*dx,(Math.floor(link.toCell/w)+.5)*dy);ctx.stroke();}
 ctx.strokeStyle='#7ee88e';ctx.lineWidth=3;ctx.setLineDash([6,4]);
 for(const item of assessmentOverlay?.assessments??[]){const points=item.catchment.capturePolyline;if(!points)continue;ctx.beginPath();points.forEach((p,i)=>{const x=(p.xM-state.originXM)/c*dx,y=(p.yM-state.originYM)/c*dy;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}ctx.setLineDash([]);
 $('status').textContent=`経過 ${Math.round(state.elapsedSeconds)} 秒 / 水量 ${v.reduce((a,b)=>a+b,0).toFixed(2)} m³${busy?' / 計算中':''}`;
 $('details').textContent=JSON.stringify({schema:state.schema,elapsedSeconds:state.elapsedSeconds,worldId:state.sourceWorldId,settlement:state.sourceRegionId,scenario:state.scenarioDiagnostics,pipes:state.culverts.map(c=>({id:c.id,geometry:c.hydraulics??null,legacyCoefficient:c.hydraulics?null:c.conductanceM2PerSecond})),waterBalance:{...state.diagnostics,boundaryTransfers:state.diagnostics.boundaryTransfers?.length,culvertTransfers:state.diagnostics.culvertTransfers?.length}},null,2);
}
async function reset(){clearAssessment();busy=true;buttons();$('status').textContent='同じ世界から地盤と水を取得しています';await yieldFrame();try{const result=await calculation.request({type:'initialize',snapshot,expectedWorldId,options:{settlementId:$('place').value||undefined,includeDrainage:$('drainage').checked,subcellSupports:$('supports').checked,displacedStorage:$('storage').checked&&$('supports').checked}});state=result.state;draw();}catch(e){if(state){$('place').value=state.sourceRegionId;$('drainage').checked=state.scenarioDiagnostics.drainage.enabled;$('supports').checked=!!state.scenarioDiagnostics.supportFaceObstructions;$('storage').checked=!!state.scenarioDiagnostics.displacedStorage;draw();}$('status').textContent=e.message;}finally{busy=false;buttons();$('status').textContent=$('status').textContent.replace(' / 計算中','');}}
$('run').onclick=async()=>{const rain=Number($('rain').value);if(!Number.isFinite(rain)||rain<0||rain>500){$('status').textContent='雨量は0〜500 mm/時で指定してください';return;}busy=true;stop=false;buttons();draw();try{for(let i=0;i<10&&!stop;i++){const result=await calculation.request({type:'step',state,seconds:60,rainfallMmPerHour:rain});state=result.state;draw();await yieldFrame();}}catch(e){$('status').textContent=`計算停止（経過 ${Math.round(state.elapsedSeconds)} 秒）: ${e.message}`;}finally{busy=false;buttons();$('status').textContent=$('status').textContent.replace(' / 計算中','');}};
function clearAssessment(){ assessmentOverlay=null;if(state)draw();$('catchment-results').replaceChildren();$('catchment-details').textContent='';$('catchment-status').textContent='まだ調べていません。雨量は上の設定を使います。'; }
for(const id of ['rain','storm-minutes','runoff-coefficient','travel-speed','design-upstream','design-downstream','collector-width'])$(id).addEventListener('input',clearAssessment);
$('assess-catchment').onclick=async()=>{
 busy=true;buttons();$('catchment-status').textContent='地形の流向と集水範囲を計算中';
 try{
  const options={settlementId:state.sourceRegionId,collectorWidthM:Number($('collector-width').value),storm:{rainfallMmPerHour:Number($('rain').value),durationSeconds:Number($('storm-minutes').value)*60,runoffCoefficient:Number($('runoff-coefficient').value),travelSpeedMPerSecond:Number($('travel-speed').value)},
   design:{diametersM:[.2,.3,.4,.6,.8,1,1.2,1.5,2],safetyFactor:1.2,upstreamDepthM:Number($('design-upstream').value),downstreamDepthM:Number($('design-downstream').value)}};
  const {assessment}=await calculation.request({type:'catchments',snapshot,expectedWorldId,options});
  assessmentOverlay=assessment;draw();$('catchment-results').replaceChildren();
  for(const item of assessment.assessments){const li=document.createElement('li'),area=item.catchment.areaM2,flow=item.peak.estimatedPeakM3PerSecond;
   const verdict=item.sizing?.selectedDiameterM!=null?`この仮定での候補径 ${item.sizing.selectedDiameterM}m`:item.sizing?'用意した管径では不足':item.status==='legacy-pipe-without-geometry'?'管の形状情報なし':item.status==='sampling-not-converged'?'解像度を変えた集水範囲が一致しない':'範囲・成立条件未確定';
   li.textContent=`${item.id}: 集水 ${area==null?'不明':(area/10000).toFixed(3)+'ha'} / 推定 ${flow==null?'不明':flow.toFixed(4)+'m³/秒'} / ${verdict}`;$('catchment-results').append(li);
  }
  $('catchment-details').textContent=JSON.stringify(assessment,null,2);
  const sized=assessment.assessments.filter(c=>c.sizing?.selectedDiameterM!=null).length;
  $('catchment-status').textContent=`${assessment.assessments.length}本を確認、候補径が出た管 ${sized}本。保存済みの管径は変更していません。${assessment.collector.widthM?' 理想集水線を仮定した結果です。':''}`;
 }catch(e){$('catchment-status').textContent=`集水評価を中断: ${e.message}`;}finally{busy=false;buttons();if(state)draw();}
};
$('stop').onclick=()=>{stop=true;calculation.cancel();};$('reset').onclick=reset;$('place').onchange=reset;$('drainage').onchange=reset;$('supports').onchange=reset;$('storage').onchange=reset;
installPageRecovery({onHide:()=>{stop=true;calculation.cancel();controller.abort();}});
try{const request=worldSnapshotRequest(location.href);$('globe-link').href=request.globeURL;expectedWorldId=request.expectedWorldId;snapshot=await readPage(fetch,request.url,{kind:'text',signal:controller.signal});
 const requested=new URLSearchParams(location.search).get('settlement'),result=await calculation.request({type:'initialize',snapshot,expectedWorldId,options:{settlementId:requested||undefined,includeDrainage:$('drainage').checked,subcellSupports:$('supports').checked,displacedStorage:$('storage').checked&&$('supports').checked}});world=result.world;state=result.state;
 for(const s of world.settlements){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;$('place').append(option);}if(requested)$('place').value=requested;draw();buttons();
}catch(e){$('status').textContent=`読み込み失敗: ${e.message}`;}
