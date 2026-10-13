import {buildingCorners} from '../core/building-geometry.mjs';
import {resolveSettlementInspection,settlementInspectionItems,inspectionExplanation} from './settlement-inspection.mjs';
import {FeatureWorkerClient} from './feature-worker-client.mjs';
const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg',params=new URL(location.href).searchParams;
const local=raw=>{const u=new URL(raw,location.href);if(u.origin!==location.origin||!['http:','https:'].includes(u.protocol))throw new Error('同じ保存元のデータを指定してください');return u;};
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`読込失敗 ${r.status}`);return r.json();}
function shape(tag,attrs){const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));$('map').append(el);return el;}
let client,manifest,manifestURL,request=0;
addEventListener('pagehide',()=>{request++;client?.destroy();});
function draw(recipe){
 if(!Array.isArray(recipe.buildings)||recipe.buildings.length>512)throw new Error('区画の表示上限を超えています');
 const items=settlementInspectionItems(recipe),economy=recipe.economy??recipe.settlementPlan;
 $('map').replaceChildren();$('choose').replaceChildren();
 $('status').textContent=`${recipe.id} / 建物${recipe.buildings.length}件、敷地・水辺${items.length-recipe.buildings.length}件。${economy?'配置理由を参照できます。':'詳細な用途計画は未登録です。'}町全体の完成を示すものではありません。`;
 const b=recipe.bounds;$('map').setAttribute('viewBox',`${b.minXM-20} ${-b.maxYM-20} ${b.maxXM-b.minXM+40} ${b.maxYM-b.minYM+40}`);
 const select=id=>{const item=items.find(p=>p.id===id);if(!item)return;$('choose').value=id;$('explanation').textContent=inspectionExplanation(item);$('details').textContent=JSON.stringify({id,type:item.type,entranceBearingDeg:item.entranceBearingDeg??'未指定',placement:item.placement,survey:item.survey??null,frontage:item.frontage??null,publicAccess:recipe.publicAccess??[],limitations:[...(economy?.assumptions??economy?.limitations??[]),...(recipe.layoutStatus?.limitations??[]),...(item.limitations??[])]},null,2);};
 function itemShape(item){let b=item.bounds;if(!b&&item.points?.length)b={minXM:Math.min(...item.points.map(p=>p.xM)),maxXM:Math.max(...item.points.map(p=>p.xM)),minYM:Math.min(...item.points.map(p=>p.yM)),maxYM:Math.max(...item.points.map(p=>p.yM))};if(!b)return;
  const gridSize=Number.isSafeInteger(item.steps)?item.steps+1:0,gridCorners=gridSize>1&&item.points?.length===gridSize*gridSize?[item.points[0],item.points[gridSize-1],item.points.at(-1),item.points[gridSize*(gridSize-1)]]:null;
  const polygon=item.orientation?buildingCorners(item).map(([x,y])=>`${x},${-y}`).join(' '):gridCorners?gridCorners.map(p=>`${p.xM},${-p.yM}`).join(' '):null,el=shape(polygon?'polygon':'rect',{...(polygon?{points:polygon}:{x:b.minXM,y:-b.maxYM,width:b.maxXM-b.minXM,height:b.maxYM-b.minYM}),fill:item.category==='water'?'#639faf':item.category==='land'?'#b9c59a':item.type==='house'?'#96a38e':'#c99047',stroke:'#37463d','stroke-width':.5,tabindex:0,role:'button','aria-label':`${item.label} · ${item.id}`});if(item.category==='building'&&Number.isFinite(item.entranceBearingDeg)){const t=item.entranceBearingDeg*Math.PI/180,x=(b.minXM+b.maxXM)/2,y=(b.minYM+b.maxYM)/2;shape('line',{x1:x,y1:-y,x2:x+Math.sin(t)*12,y2:-y-Math.cos(t)*12,stroke:'#a02b28','stroke-width':2});}el.onclick=()=>select(item.id);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(item.id);}};
 }
 for(const item of items.filter(p=>p.category!=='building'))itemShape(item);
 for(const road of recipe.roadCenterlineProfiles??[])shape('polyline',{points:road.samples.map(p=>`${p.xM},${-p.yM}`).join(' '),fill:'none',stroke:'#938876','stroke-width':road.halfWidthM*2});
 for(const item of items.filter(p=>p.category==='building'))itemShape(item);
 for(const item of items){const o=document.createElement('option');o.value=item.id;o.textContent=`${item.label} · ${item.id}`;$('choose').append(o);}
 $('choose').onchange=e=>select(e.target.value);$('survey-issues').textContent=JSON.stringify({facilitySurvey: economy?.surveyRejected??[],publicSiteSurvey: recipe.publicSiteSurvey??null},null,2);$('rejected').textContent=JSON.stringify(economy?.rejected??[],null,2);if(items.length)select(items[0].id);
}
async function loadDistrict(){const token=++request;try{
 $('map').replaceChildren();$('choose').replaceChildren();$('explanation').textContent='';$('details').textContent='';$('rejected').textContent='';$('survey-issues').textContent='';
 $('load-district').disabled=true;$('district').disabled=true;$('status').textContent='選択した区画を同じ地形から読み込み中。全都市を一括生成しません。';
 const selection=await resolveSettlementInspection(manifest,manifestURL,params.get('settlement'),Number($('district').value));
 $('district').max=String(selection.districtCount-1);$('district-count').textContent=`全${selection.districtCount}区画。今は1区画だけ表示。`;
 const {recipe}=await client.generate(selection.descriptor);if(token!==request)return;draw(recipe);
 }catch(e){if(token===request)$('status').textContent=e.message;}finally{if(token===request){$('load-district').disabled=false;$('district').disabled=false;}}}
try{
 if(params.has('recipe')){draw(await json(local(params.get('recipe'))));$('district').disabled=true;}
 else{manifestURL=local(params.get('manifest')??'../../examples/planet/generated/manifest.json');manifest=await json(manifestURL);if(params.get('worldId')&&params.get('worldId')!==manifest.canonicalWorldId)throw new Error('世界IDが一致しません');client=new FeatureWorkerClient(manifest,manifestURL);$('district').value=params.get('district')??'0';$('load-district').onclick=loadDistrict;await loadDistrict();}
}catch(e){$('status').textContent=e.message;client?.destroy();}
