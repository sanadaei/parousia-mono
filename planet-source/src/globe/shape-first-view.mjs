import {ordinaryGlobeURL} from './world-link.mjs';
import {installShapeFirstSourceControls} from './shape-first-controls.mjs';
import {loadShapeFirstModel} from './shape-first-loader.mjs';
import {shapeLevelForScale,shapeViewport,shapePointAt,nearestShapeRiver} from './shape-first-model.mjs';
import {shapeFirstRaster} from './shape-first-raster.mjs';
import {createShapeFirstRegions} from '../core/shape-first-regions.mjs';

const STYLE = `
body{overflow:auto;background:#0c161c}.sf-app{height:100dvh;display:grid;grid-template:68px 1fr / 330px 1fr;color:#deebe7;font:14px/1.55 system-ui,sans-serif}
.sf-app *{box-sizing:border-box}.sf-app header{position:static;grid-column:1/-1;display:flex;justify-content:space-between;gap:15px;padding:12px 24px;background:#101f28;border-bottom:1px solid #30434d;pointer-events:auto}.sf-app header strong{font-size:18px}.sf-app header span{font-size:12px;color:#a5b9c4}.sf-app a{color:#a6d9de}.sf-app aside{padding:22px;overflow:auto;background:#13232a;border-right:1px solid #30434d}.sf-app h1{font-size:23px;line-height:1.35;margin:10px 0}.sf-app h2{font-size:15px;margin:20px 0 8px}.sf-app p{color:#b8c9cf;margin:10px 0}.sf-app .badge{display:inline-block;border:1px solid #baa46b;background:#514528;color:#fff0b9;border-radius:20px;padding:2px 10px;font-size:12px}.sf-app small{display:block;color:#a7bbc4;font-size:12px}.sf-app select{display:block;width:100%;margin-top:5px;padding:9px;background:#20343d;border:1px solid #516e77;border-radius:5px;font:inherit;color:#e8f5f3}.sf-app button{background:#24434a;border-color:#597a80}.sf-app button:disabled,.sf-app select:disabled{opacity:.45;cursor:wait}.sf-app label{margin:16px 0}.sf-app input[type=checkbox]{accent-color:#73d1bf}.sf-app .row{display:flex;gap:8px}.sf-app .row button{flex:1}.sf-app .notice{padding:10px;border-left:3px solid #bda76f;background:#25312f;font-size:12px}.sf-app #sf-stage{position:relative;min-width:0;min-height:0;background:#09141b;overflow:hidden}.sf-app canvas{width:100%;height:100%;display:block;touch-action:none}.sf-app canvas:focus-visible{outline:3px solid #b4e7e4;outline-offset:-3px}.sf-app #sf-overlay{position:absolute;top:16px;left:18px;right:18px;display:flex;justify-content:space-between;gap:12px;pointer-events:none;font-size:12px}.sf-app #sf-overlay span{padding:7px 11px;background:#0a1d25de;border:1px solid #3b5660;border-radius:7px}.sf-app #sf-map-footer{position:absolute;left:18px;right:18px;bottom:15px;background:#0a1d25e8;padding:10px 12px;border-radius:7px;pointer-events:none;font-size:12px;color:#c8dcd9}.sf-app #sf-readout{white-space:pre-line;font-variant-numeric:tabular-nums;padding:12px;background:#0c1d25;border-radius:7px;min-height:85px}.sf-app #sf-status[data-error=true]{color:#ffb9ae}.sf-app .legend{height:9px;border-radius:4px;background:linear-gradient(90deg,#325d49,#94a174,#b9ae83,#e2dfc9);margin:12px 0 3px}.sf-app details{margin-top:18px}.sf-app #sf-provenance{overflow-wrap:anywhere;font-size:11px}.sf-app [hidden]{display:none!important}
@media(max-width:760px){.sf-app{height:auto;min-height:100dvh;grid-template:76px 55dvh auto / 1fr}.sf-app header{padding:10px 14px}.sf-app header strong{font-size:15px}.sf-app header span{display:none}.sf-app aside{grid-row:3;overflow:visible}.sf-app #sf-stage{grid-row:2;min-height:310px}.sf-app #sf-overlay{left:8px;right:8px}.sf-app #sf-overlay span{padding:4px 6px;font-size:11px}}
`;

export async function mountShapeFirstView() {
  document.title='形から作る地域 · Planet';
  const style=document.createElement('style');style.textContent=STYLE;document.head.append(style);
  document.body.innerHTML=`<main class="sf-app">
<header><strong>Planet / 地形ビュー</strong><span>SHAPE FIRST · REGION</span><a id="sf-planet" href="?terrain=shape-first">この形状を惑星で見る</a><a id="sf-back" href="./index.html">保存した惑星へ戻る</a></header>
<aside><label>地形ビュー<select id="terrain-view" aria-label="地形ビュー"><option value="globe">保存した惑星</option><option value="shape-first">形を先に作る惑星地形（試作）</option><option value="shape-first-inspect" selected>形状・水の地域検査（試作）</option></select></label>
<div id="sf-source-controls"></div><span class="badge">地域試作 · 物理検証前</span><h1>川と谷の形から<br>地形を組み立てる</h1><p>ここは選んだ元の形状と仮流量の検査画面です。惑星ビューでは、この形状へ設計した河床・水面・水深を加えます。水理検証済みではありません。</p>
<p id="sf-status" role="status" aria-live="polite">保存形状と水の注釈を読み込んでいます…</p><button id="sf-retry" type="button" hidden>読み込みを再試行</button>
<label>地形の細かさ<select id="sf-level" disabled aria-label="地形の細かさ"><option value="auto">ズームに合わせる</option></select></label><small id="sf-level-info"></small>
<div class="row"><button id="sf-minus" type="button" disabled aria-label="縮小">−</button><button id="sf-reset" type="button" disabled>全体へ戻す</button><button id="sf-plus" type="button" disabled aria-label="拡大">＋</button></div>
<small>ホイールで拡大・縮小。ドラッグで移動。地図を選択して矢印キーでも移動できます。</small>
<label><input id="sf-rivers" type="checkbox" checked disabled> 川筋と下流方向を表示</label><label><input id="sf-flow" type="checkbox" checked disabled> 仮の供給量を線の太さで表示</label><label><input id="sf-seams" type="checkbox" checked disabled> 隣接タイルと接続点を表示</label>
<h2>川の注釈</h2><label>川筋を選ぶ<select id="sf-river" disabled aria-label="川筋を選ぶ"><option value="">地図の川をクリックして選択</option></select></label><button id="sf-focus" type="button" disabled>選択した川へ</button><div id="sf-readout">川筋を選ぶと区間の仮の流量を確認できます。</div>
<div class="legend" aria-hidden="true"></div><small id="sf-elevation-legend"></small>
<p class="notice">地形と川筋が先、数値は後付けの説明です。流量は一様な仮の流出量を最寄りの川に割り振ったもの。地形に基づく流域・水理・侵食の検証や全球の水系接続は未完了です。線幅は画面上の記号で、川幅ではありません。</p>
<details><summary>仮定・精度・出典</summary><p id="sf-scenario"></p><p id="sf-connection"></p><p id="sf-provenance"></p><small>座標は北西原点、東へX・南へY、単位m。標高の基準はこの架空の形状内だけです。ネイティブ格子より細かい情報は生成しません。隣接タイルは同じ選択形状を分割したものです。</small></details>
</aside><section id="sf-stage" aria-label="選んだ地域の地形"><canvas id="sf-canvas" tabindex="0" aria-label="形状優先の地域地形。ホイールで拡大、ドラッグで移動、川をクリックして流量を表示"></canvas><div id="sf-overlay"><span id="sf-scale">準備中</span><span>北 ↑ / 陰影 2×</span></div><div id="sf-map-footer">描画を準備しています</div></section></main>`;
  const $=id=>document.getElementById(id),canvas=$('sf-canvas'),ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Canvas 2Dを利用できません');
  const url=new URL(location.href),back=new URL(ordinaryGlobeURL(location.href));
  $('sf-back').href=back.href;$('terrain-view').onchange=()=>{const next=new URL(location.href);if($('terrain-view').value==='globe')location.href=back.href;else{next.searchParams.set('terrain',$('terrain-view').value);location.href=next.href;}};
  let model=null,regions=null,loadController=null,loadEpoch=0,pending=false,currentView=null,currentLevel=0,selected=null,drag=null;
  let zoom=1,center=null;const rasters=new Map();
  const status=(text,error=false)=>{$('sf-status').textContent=text;$('sf-status').dataset.error=String(error);};
  const syncURL=()=>{const next=new URL(location.href);next.searchParams.set('sfLevel',$('sf-level').value);next.searchParams.set('sfZoom',zoom.toFixed(3));history.replaceState(null,'',next);};
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;draw();});}
  function raster(tile,levelIndex){
    const key=`${tile.id}/${levelIndex}`;if(rasters.has(key))return rasters.get(key);
    const raster=shapeFirstRaster(model,tile,levelIndex),out=document.createElement('canvas');
    out.width=raster.width;out.height=raster.height;
    const context=out.getContext('2d'),image=context.createImageData(out.width,out.height);image.data.set(raster.data);
    context.putImageData(image,0,0);rasters.set(key,out);return out;
  }
  function draw(){
    if(!model)return;const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=Math.min(2,devicePixelRatio||1);
    if(width<=0||height<=0)return;
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#09141b';ctx.fillRect(0,0,width,height);
    currentView=shapeViewport(model.extent,width,height,zoom,center);
    const v=currentView,p=p=>[v.x+p.xM*v.scale,v.y+p.yM*v.scale];
    currentLevel=$('sf-level').value==='auto'?shapeLevelForScale(model.levels,v.scale):Number($('sf-level').value);
    for(const tile of regions.tiles){const [x,y]=p(tile.originM);ctx.drawImage(raster(tile,currentLevel),x,y,tile.extent.widthM*v.scale,tile.extent.heightM*v.scale);}
    ctx.save();ctx.beginPath();ctx.rect(v.x,v.y,model.extent.widthM*v.scale,model.extent.heightM*v.scale);ctx.clip();
    if($('sf-rivers').checked)for(const river of model.rivers){
      ctx.lineCap='round';const active=selected?.river.id===river.id;ctx.strokeStyle=active?'#ffeb9a':'#72d6ff';
      for(let s=0;s<river.points.length-1;s++){const a=p(river.points[s]),b=p(river.points[s+1]);ctx.lineWidth=($('sf-flow').checked?river.segmentLineWeightPx[s]:1.3)+(active?1:0);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
      // Every stored path is downstream-to-upstream; arrows point backwards.
      let distance=0;
      for(let s=river.points.length-2;s>=0;s--){const a=p(river.points[s+1]),b=p(river.points[s]);distance+=Math.hypot(b[0]-a[0],b[1]-a[1]);if(distance<85)continue;distance=0;const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),size=active?6:4;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(b[0]-size*Math.cos(angle-.55),b[1]-size*Math.sin(angle-.55));ctx.lineTo(...b);ctx.lineTo(b[0]-size*Math.cos(angle+.55),b[1]-size*Math.sin(angle+.55));ctx.stroke();}
    }
    if($('sf-seams').checked){
      ctx.strokeStyle='#f8ecd3';ctx.lineWidth=1;ctx.setLineDash([7,5]);
      for(const seam of regions.seams){ctx.beginPath();seam.points.forEach((point,i)=>{const q=p(point);if(i)ctx.lineTo(...q);else ctx.moveTo(...q);});ctx.stroke();}ctx.setLineDash([]);
      for(const seam of regions.seams)for(const port of seam.ports){const q=p(port.point);ctx.fillStyle='#dafaef';ctx.strokeStyle='#16383f';ctx.beginPath();ctx.arc(...q,3.5,0,2*Math.PI);ctx.fill();ctx.stroke();}
    }
    ctx.restore();ctx.strokeStyle='#77998d';ctx.lineWidth=1;ctx.strokeRect(v.x,v.y,model.extent.widthM*v.scale,model.extent.heightM*v.scale);
    const l=model.levels[currentLevel],g=l.grid;
    $('sf-level-info').textContent=`${g.columns} × ${g.rows}点 / 間隔 ${g.cellSizeM.toFixed(1)} × ${g.cellSizeYM.toFixed(1)} m。元の詳細形状との差 RMS ${l.designFidelity.rmsErrorM.toFixed(2)} m、最大 ${l.designFidelity.maxAbsoluteErrorM.toFixed(2)} m。`;
    $('sf-scale').textContent=`${zoom.toFixed(1)}× · 詳細段階${currentLevel+1} · ${(1/v.scale).toFixed(1)} m/px`;
    $('sf-map-footer').textContent=`地域 ${(model.extent.widthM/1000).toFixed(2)} × ${(model.extent.heightM/1000).toFixed(2)} km · 2タイル · ${model.rivers.length}本の設計川筋 · ネイティブ ${model.candidate.grid.columns} × ${model.candidate.grid.rows}点`;
    canvas.dataset.ready='true';canvas.dataset.level=String(currentLevel);canvas.dataset.zoom=String(zoom);canvas.dataset.tileCount=String(regions.tiles.length);
  }
  function inspect(selection){
    selected=selection;if(!selection){$('sf-river').value='';$('sf-focus').disabled=true;$('sf-readout').textContent='川筋を選ぶと区間の仮の流量を確認できます。';schedule();return;}
    const r=selection.river,s=selection.segment;$('sf-river').value=r.id;$('sf-focus').disabled=false;
    $('sf-readout').textContent=`${r.id} · 区間 ${s+1}/${r.points.length-1}\nこの区間の仮の流量 ${r.segmentFlowM3PerSecond[s].toFixed(6)} m³/s\n川筋の出口 ${r.outletM3PerSecond.toFixed(6)} m³/s\n最寄り割当面積 ${(r.assignedAreaM2/1e6).toFixed(3)} km²\n下流: ${r.parent??'地域外へ（未接続）'}`;schedule();
  }
  function clampCenter(){center.xM=Math.max(0,Math.min(model.extent.widthM,center.xM));center.yM=Math.max(0,Math.min(model.extent.heightM,center.yM));}
  function changeZoom(next,anchor=null){if(!model)return;const old=currentView;zoom=Math.max(.6,Math.min(16,next));if(anchor&&old){const point=shapePointAt(old,...anchor),rect=canvas.getBoundingClientRect(),v=shapeViewport(model.extent,rect.width,rect.height,zoom,center);center={xM:point.xM-(anchor[0]-rect.width/2)/v.scale,yM:point.yM-(anchor[1]-rect.height/2)/v.scale};clampCenter();}syncURL();schedule();}
  $('sf-plus').onclick=()=>changeZoom(zoom*1.5);$('sf-minus').onclick=()=>changeZoom(zoom/1.5);
  $('sf-reset').onclick=()=>{center={xM:model.extent.widthM/2,yM:model.extent.heightM/2};zoom=1;syncURL();schedule();};
  $('sf-level').onchange=()=>{syncURL();schedule();};for(const id of ['sf-flow','sf-rivers','sf-seams'])$(id).onchange=schedule;
  $('sf-river').onchange=()=>inspect(model.rivers.find(r=>r.id===$('sf-river').value)?{river:model.rivers.find(r=>r.id===$('sf-river').value),segment:0}:null);
  $('sf-focus').onclick=()=>{if(!selected)return;const pts=selected.river.points;center={xM:pts.reduce((s,p)=>s+p.xM,0)/pts.length,yM:pts.reduce((s,p)=>s+p.yM,0)/pts.length};changeZoom(3);};
  canvas.addEventListener('wheel',event=>{if(!model)return;event.preventDefault();const r=canvas.getBoundingClientRect();changeZoom(zoom*Math.exp(-Math.max(-300,Math.min(300,event.deltaY))*.002),[event.clientX-r.left,event.clientY-r.top]);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{if(!model||event.button!==0)return;canvas.focus();canvas.setPointerCapture(event.pointerId);drag={id:event.pointerId,x:event.clientX,y:event.clientY,center:{...center},moved:false};});
  canvas.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId||!currentView)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;if(drag.moved){center={xM:drag.center.xM-dx/currentView.scale,yM:drag.center.yM-dy/currentView.scale};clampCenter();schedule();}});
  canvas.addEventListener('pointerup',event=>{if(!drag||drag.id!==event.pointerId)return;const moved=drag.moved;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(!moved&&$('sf-rivers').checked){const rect=canvas.getBoundingClientRect(),point=shapePointAt(currentView,event.clientX-rect.left,event.clientY-rect.top);inspect(nearestShapeRiver(model.rivers,point,10/currentView.scale));}});
  for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>{drag=null;});
  canvas.addEventListener('keydown',event=>{if(!model)return;if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Home'].includes(event.key))event.preventDefault();if(event.key==='+'||event.key==='=')changeZoom(zoom*1.5);else if(event.key==='-')changeZoom(zoom/1.5);else if(event.key==='Home')$('sf-reset').click();else if(event.key==='Escape')inspect(null);else if(event.key.startsWith('Arrow')){const step=80/currentView.scale;center.xM+=(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0);center.yM+=(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);clampCenter();schedule();}});
  new ResizeObserver(schedule).observe($('sf-stage'));
  async function load(){
    loadController?.abort();loadController=new AbortController();const epoch=++loadEpoch;status('保存形状と水の注釈を照合しています…');$('sf-retry').hidden=true;
    try{
      const next=await loadShapeFirstModel({signal:loadController.signal,seed:new URL(location.href).searchParams.get('sfSeed')});
      const nextRegions=createShapeFirstRegions(next.candidate,{tileColumns:2,tileRows:1,levelCount:next.levels.length,waterAnnotation:next.water,riverIds:next.rivers.map(r=>r.id),pointOrder:next.pointOrder,sourceSha256:next.pyramid.provenance.sourceSha256});
      if(epoch!==loadEpoch)return;model=next;regions=nextRegions;rasters.clear();center={xM:model.extent.widthM/2,yM:model.extent.heightM/2};
      const initial=Number(url.searchParams.get('sfZoom'));zoom=Number.isFinite(initial)&&initial>=.6&&initial<=16?initial:1;
      $('sf-level').replaceChildren();for(const [value,text] of [['auto','ズームに合わせる'],...model.levels.map((l,i)=>[String(i),`詳細段階${i+1} · ${l.grid.columns} × ${l.grid.rows}${i===model.levels.length-1?'（元の詳細形状）':''}`])]){const option=document.createElement('option');option.value=value;option.textContent=text;$('sf-level').append(option);}
      const chosen=url.searchParams.get('sfLevel');$('sf-level').value=chosen==='auto'||model.levels.some((_,i)=>String(i)===chosen)?chosen:String(model.levels.length-1);
      $('sf-river').replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='川筋を選ぶ / 地図でクリック';$('sf-river').append(placeholder);for(const river of model.rivers){const option=document.createElement('option');option.value=river.id;option.textContent=river.id;$('sf-river').append(option);}
      for(const id of ['sf-level','sf-minus','sf-reset','sf-plus','sf-rivers','sf-flow','sf-seams','sf-river'])$(id).disabled=false;
      $('sf-elevation-legend').textContent=`標高 ${model.minElevationM.toFixed(0)} → ${model.maxElevationM.toFixed(0)} m（全レベル共通）`;
      const a=model.water.accounting;$('sf-scenario').textContent=`仮の正味流出 ${model.water.scenario.runoffMmPerYear} mm/年、外部供給 ${a.externalM3PerSecond.toFixed(3)} m³/s。出口合計 ${a.outletM3PerSecond.toFixed(6)} m³/s。収支差 ${a.residualM3PerSecond.toExponential(2)} m³/sは計算上の一致で、流域の正しさを示しません。`;
      $('sf-connection').textContent=`同じ地形から2タイルを切り出し、境界の標高と川の通過点を共有。${regions.seams.length}境界、${regions.seams.reduce((n,s)=>n+s.ports.length,0)}通過点。未知の隣接地域を生成したものではありません。`;
      $('sf-provenance').textContent=`候補 SHA-256: ${model.pyramid.provenance.sourceSha256}。入力標高・川筋・川のIDの出典を読込時に照合済み。`;
      const planetURL=new URL(location.href);planetURL.searchParams.set('terrain','shape-first');$('sf-planet').href=planetURL.href;
      status(`${model.sourceLabel} を表示中。地形${model.levels.length}段階・川${model.rivers.length}本・隣接${regions.tiles.length}タイル。${model.storageStatus==='saved'?' 初回の形状を保存済み。':model.storageStatus==='memory-only'?` 一時表示: ${model.storageWarning??'保存できません'}。再訪前に記録を書き出してください。`:''}`);inspect(null);schedule();
    }catch(error){if(epoch!==loadEpoch||error.name==='AbortError')return;status(`読み込めません: ${error.message}`,true);$('sf-retry').hidden=false;if(model)$('sf-status').textContent+=' 前の形状を表示しています。';}
  }
  installShapeFirstSourceControls($('sf-source-controls'),{onChange:href=>{history.replaceState(null,'',href);load();}});
  $('sf-retry').onclick=load;window.addEventListener('pagehide',()=>{loadController?.abort();drag=null;});window.addEventListener('pageshow',event=>{if(event.persisted){if(model)schedule();else load();}});
  await load();
}
