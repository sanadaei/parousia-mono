/** Keep ancillary views on the exact world selected in the globe. */
export function worldExperimentLink(page,manifest,manifestURL,pageURL,settlementId){
  if(!['vehicle.html','runoff.html','bridge.html','settlement.html'].includes(page))throw new TypeError('Unknown world experiment');
  if(page==='settlement.html'&&manifest.settlementCatalogue&&settlementId){
    const current=new URL(pageURL),target=new URL(page,current),source=new URL(manifest.generationManifest??manifestURL,manifestURL);
    if(source.origin!==current.origin||!['http:','https:'].includes(source.protocol))throw new TypeError('World manifest must be served from this origin');
    target.searchParams.set('manifest',source.pathname+source.search);target.searchParams.set('settlement',settlementId);if(manifest.canonicalWorldId)target.searchParams.set('worldId',manifest.canonicalWorldId);return target.href;
  }
  if(!manifest.planetSnapshot||manifest.settlements?.length===0||manifest.generationDiagnostics?.generatedSettlements===0)return null;
  const current=new URL(pageURL),snapshot=new URL(manifest.planetSnapshot,manifestURL),target=new URL(page,current);
  if(snapshot.origin!==current.origin||!['http:','https:'].includes(snapshot.protocol))throw new TypeError('World snapshot must be served from this origin');
  target.searchParams.set('world',snapshot.pathname+snapshot.search);
  const source=new URL(manifest.generationManifest??manifestURL,manifestURL);
  if(source.origin!==current.origin||!['http:','https:'].includes(source.protocol))throw new TypeError('World manifest must be served from this origin');
  target.searchParams.set('manifest',source.pathname+source.search);
  if(current.searchParams.get('renderer')==='software')target.searchParams.set('renderer','software');
  if(current.searchParams.has('meshBudgetMiB'))target.searchParams.set('meshBudgetMiB',current.searchParams.get('meshBudgetMiB'));
  target.searchParams.set('worldId',manifest.canonicalWorldId);
  if(settlementId)target.searchParams.set('settlement',settlementId);
  return target.href;
}
export function worldSnapshotRequest(pageURL){
  const page=new URL(pageURL),raw=page.searchParams.get('world'),url=new URL(raw??'../../examples/planet/generated/world.snapshot.json',page);
  if(url.origin!==page.origin||!['http:','https:'].includes(url.protocol))throw new TypeError('World snapshot must be served from this origin');
  const globe=new URL('./index.html',page),source=page.searchParams.get('manifest');if(source){const manifest=new URL(source,page);if(manifest.origin!==page.origin||!['http:','https:'].includes(manifest.protocol))throw new TypeError('Globe manifest must be served from this origin');globe.searchParams.set('world',manifest.pathname+manifest.search);}
  if(page.searchParams.get('renderer')==='software')globe.searchParams.set('renderer','software');
  if(page.searchParams.has('meshBudgetMiB'))globe.searchParams.set('meshBudgetMiB',page.searchParams.get('meshBudgetMiB'));
  return{url:url.href,expectedWorldId:page.searchParams.get('worldId'),globeURL:globe.href};
}
export function checkExpectedWorld(world,expectedWorldId){
  if(expectedWorldId&&world.worldId!==expectedWorldId)throw new Error('表示元と保存世界のIDが異なります。全球画面を再読込してください');
  return world;
}

/** Explicit return to an adopted world drops all draft-only constraints. */
export function ordinaryGlobeURL(pageURL){
 const url=new URL(pageURL);url.searchParams.delete('terrain');
 for(const key of [...url.searchParams.keys()])if(key.startsWith('sf'))url.searchParams.delete(key);
 if(['shape-outlet','shape-connection','shape-receiver'].includes(url.searchParams.get('river')))url.searchParams.delete('river');
 return url.href;
}

export function worldCatalogEntries(catalog,catalogURL,pageURL){
 const page=new URL(pageURL);
 if(catalog?.schema!=='planet-example-catalog@1'||!Array.isArray(catalog.worlds)||catalog.worlds.length>32)throw new TypeError('Invalid world catalog');
 const ids=new Set();return catalog.worlds.map(e=>{
  if(typeof e.id!=='string'||!e.id||ids.has(e.id)||typeof e.name!=='string'||!e.name||e.name.length>80||typeof e.worldId!=='string'||typeof e.manifest!=='string')throw new TypeError('Invalid catalog entry');ids.add(e.id);
  const source=new URL(e.manifest,catalogURL);if(source.origin!==page.origin||!['http:','https:'].includes(source.protocol))throw new TypeError('Catalog world must be from this origin');
  const target=new URL(ordinaryGlobeURL(page));target.searchParams.set('world',source.pathname+source.search);target.searchParams.delete('benchmark');target.searchParams.delete('duration');
  return{id:e.id,name:e.name,worldId:e.worldId,url:target.href};
 });
}

/** Never silently move an experiment to a different settlement's bridge. */
export function requestedBridgeSelection(world,settlementId=null){
 if(settlementId){
  const recipe=world.recipes.find(r=>r.id===settlementId);
  if(!recipe)throw new RangeError('指定された集落はこの世界に存在しません');
  return {bridgeId:recipe.bridgeStructures?.[0]?.id??null,missingInRequestedSettlement:!recipe.bridgeStructures?.length};
 }
 return{bridgeId:world.recipes.flatMap(r=>r.bridgeStructures??[])[0]?.id??null,missingInRequestedSettlement:false};
}

/** Identify the loaded save without silently upgrading an immutable world. */
export function worldVersionLabel(manifest, entries=null){
 const revision=manifest?.base?.revision,match=typeof revision==='string'?/^planet-generator@(\d+)(?:-[a-z0-9-]+)?$/.exec(revision):null;
 const label=match?`生成版 ${match[1]}`:'保存世界';
 if(!entries)return label;
 const current=entries.find(e=>e.worldId===manifest.canonicalWorldId);
 return current?`${label} · ${current.name}`:`${label} · 一覧とは異なる保存版（世界の例から切替可能）`;
}

/** Describe saved generation policies, not whichever renderer is installed.
 * Reading or opening this notice must never rewrite an immutable world. */
export function savedLandscapeSummary(manifest){
 const landscape=manifest?.landscape??{};
 const requirements=[
  ['woodlandPattern','patchy-woodland-stands@1','林の疎密'],
  ['landUseMosaic','mixed-rainfed-hinterland@1','畑・牧草地・林地の混在'],
  ['publicGreenPolicy','surveyed-sloping-commons@1','地形に沿う広場'],
  ['householdFrontagePolicy','surveyed-household-frontages@2','住宅敷地の幅と奥行き'],
  ['pondPolicy','surveyed-communal-pond@2','地形を調べた共同貯水池'],
  ['residentialStreetPolicy','surveyed-residential-catchments@1','住宅用地へ向かう支道']
 ];
 const present=[],missing=[];
 for(const [key,policy,label]of requirements)(landscape[key]===policy?present:missing).push(label);
 return{current:missing.length===0,present,missing,
  text:missing.length?`この保存世界には今回の配置方式が一部または全部入っていません。未適用：${missing.join('、')}。コードの更新や再読込だけでは配置は変わりません。`:'今回の配置方式を持つ保存世界です。各場所での生成成功や景観の完成を意味するものではありません。'};
}

/** The generation server may report a previous job, not the current form. */
export function generationJobMessage(job){
 const seed=typeof job?.seed==='string'?job.seed:'不明';
 if(job?.status==='running')return `seed「${seed}」を生成中です。画面を閉じてもサーバー側で続きます。`;
 if(job?.status==='complete')return `サーバーの直近の生成結果：seed「${seed}」。入力欄を変更した場合は「生成する」を押してください。`;
 return job?.error??'待機中';
}
