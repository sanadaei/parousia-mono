import {installPageRecovery} from './page-lifecycle.mjs';
import{worldSnapshotRequest,checkExpectedWorld,requestedBridgeSelection}from'./world-link.mjs';import{readPage}from'./page-request.mjs';import{restorePlanetWorld}from'../core/planet-world.mjs';import{inspectBridgeFoundations}from'../core/bridge-foundations.mjs';
const $=id=>document.getElementById(id),canvas=$('section'),ctx=canvas.getContext('2d'),controller=new AbortController();let world,bridges=[];
function check(){try{
 const s=bridges.find(b=>b.id===$('bridge').value);if(!s)throw new Error('この世界には橋がありません');
 const field=(id,min,max)=>{const v=Number($(id).value);if(!Number.isFinite(v)||v<min||v>max)throw new Error('表示された範囲内の条件を入力してください');return v;};
 const input={allowableBearingPa:field('bearing',1,10000)*1000,frictionCoefficient:field('friction',0,2),scourDepthM:field('scour',0,20),supportDensityKgPerM3:field('density',1,20000),lateralLoadPerSupportN:field('lateral',0,1000)*1000,vehicleSpanIndex:0},result=inspectBridgeFoundations(s,input),failed=result.supports.filter(p=>p.assessment.status!=='within-input-conditions');
 $('status').textContent=`橋脚 ${result.supports.length} 本中、指定条件外 ${failed.length} 本。地盤の性質は入力した仮定です。`;
 const length=Math.hypot(s.end.xM-s.start.xM,s.end.yM-s.start.yM),low=Math.min(...s.supports.map(p=>Math.min(p.bottomElevationM,p.groundElevationM-input.scourDepthM)))-2,high=s.deckElevationM+3,X=x=>45+x/length*810,Y=z=>380-(z-low)/(high-low)*340;
 ctx.fillStyle='#172f3b';ctx.fillRect(0,0,900,420);ctx.strokeStyle='#b59b69';ctx.lineWidth=2;ctx.beginPath();s.supports.forEach((p,i)=>{i?ctx.lineTo(X(i/ s.spanCount*length),Y(p.groundElevationM)):ctx.moveTo(X(0),Y(p.groundElevationM));});ctx.stroke();
 ctx.setLineDash([6,4]);ctx.strokeStyle='#eea254';ctx.beginPath();s.supports.forEach((p,i)=>{i?ctx.lineTo(X(i/s.spanCount*length),Y(p.groundElevationM-input.scourDepthM)):ctx.moveTo(X(0),Y(p.groundElevationM-input.scourDepthM));});ctx.stroke();ctx.setLineDash([]);
 for(let i=0;i<s.supports.length;i++){const p=s.supports[i],b=s.boxes.find(b=>b.id===result.supports[i].supportId),x=i/s.spanCount*length;ctx.fillStyle=result.supports[i].assessment.status==='within-input-conditions'?'#76bb8b':'#e7705e';ctx.fillRect(X(x-b.lengthM/2),Y(p.topElevationM),Math.max(2,810*b.lengthM/length),Y(p.bottomElevationM)-Y(p.topElevationM));}
 ctx.fillStyle='#b19b72';ctx.fillRect(X(0),Y(s.deckElevationM),810,Y(s.deckElevationM-s.totalDeckDepthM)-Y(s.deckElevationM));
 ctx.fillStyle='#edf3f5';ctx.fillText(`全長 ${length.toFixed(1)} m / 断面の縦横は別倍率`,45,405);
 $('details').textContent=JSON.stringify({sourceWorldId:world.worldId,beamAssessment:s.assessment,foundationScenario:result,displayScope:'side view through saved support stations; terrain line interpolates those stations'},null,2);
}catch(e){$('status').textContent=e.message;}}
$('check').onclick=check;$('bridge').onchange=()=>{$('check').disabled=!$('bridge').value;if($('bridge').value)check();};installPageRecovery({onHide:()=>controller.abort()});
try{const request=worldSnapshotRequest(location.href);$('globe-link').href=request.globeURL;world=checkExpectedWorld(restorePlanetWorld(await readPage(fetch,request.url,{kind:'text',signal:controller.signal})),request.expectedWorldId);
 for(const r of world.recipes)for(const b of r.bridgeStructures??[]){bridges.push(b);const o=document.createElement('option');o.value=b.id;o.textContent=`${world.settlements.find(s=>s.id===r.id)?.name??r.id}の橋`;$('bridge').append(o);}
 const requested=new URLSearchParams(location.search).get('settlement'),selection=requestedBridgeSelection(world,requested);
 if(!bridges.length)throw new Error('この保存世界には橋がありません');$('bridge').disabled=false;
 if(selection.missingInRequestedSettlement){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='別の集落の橋を選ぶ';$('bridge').prepend(placeholder);$('bridge').value='';$('status').textContent='選択した集落には橋がありません。別の集落の橋を選んで確認できます。';}
 else{$('bridge').value=selection.bridgeId;$('check').disabled=false;check();}
}catch(e){$('status').textContent=`読み込み結果: ${e.message}`;}
