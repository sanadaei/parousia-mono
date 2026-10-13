/** Read-only destinations from actual saved profiles, never invented water. */
export function riverViews(network){
 return(network?.profiles??[]).filter(p=>p.points?.length>=2).map(p=>{
  const q=p.points[Math.floor(p.points.length/2)],local=p.id.startsWith('tributary-region@'),regional=p.id.startsWith('tributary-region@3/regional/'),width=Number.isFinite(q.halfWidthM)?q.halfWidthM*2:null;
  return{id:p.id,name:`${regional?'支流':local?'小川':'本流'}${width===null?'':`（川幅 約${Math.round(width)}m）`} · ${p.id}`,latDeg:q.latDeg,lonDeg:q.lonDeg,viewAltitudeM:Math.min(30000,Math.max(local&&!regional?150:500,(width??0)*8)),local};
 });
}
export function tributaryCoverageText(network){
 const d=network?.diagnostics?.localTributaries;if(!d)return '小川の広域生成は未対応です。';
 const n=key=>d.regions.reduce((sum,r)=>sum+(r.drainage?.[key]??0),0),rejected=d.regions.reduce((sum,r)=>sum+(r.compilation?.rejected?.length??0),0);
 const profiles=network.profiles??[],regional=profiles.filter(p=>p.id.startsWith('tributary-region@3/regional/')).length,local=profiles.filter(p=>p.id.startsWith('tributary-region@')&&!p.id.startsWith('tributary-region@3/regional/')).length;
 return `本流${profiles.length-regional-local}本・支流${regional}本・小川${local}本。${d.regions.length}地域だけを調査。調査内で境界未確定${n('boundaryTruncatedBasins')}流域・窪地未解決${n('depressionDependentBasins')}流域・断面や予算で除外${rejected}流域。未調査・重複除外${d.withheld.length}地域。全世界の水系完成を意味しません。`;
}

export function waterSettlementViews(catalogue){return(catalogue?.waterAccess?.examples??[]).slice(0,128).filter(p=>p.sourceId&&Number.isFinite(p.latDeg)&&Number.isFinite(p.lonDeg)).map(p=>({...p,viewAltitudeM:500}));}
export function settlementWaterCoverageText(catalogue){const w=catalogue?.waterAccess;return w?`川への接近を地形で確認した集落 ${w.accepted}か所。候補から除外 ${w.rejected}件。全${catalogue.totals.placed}集落の給水を保証するものではありません。井戸・泉・湖への接近や洪水安全性は未評価。`:'この保存世界では、集落から水辺への接近は未調査です。';}
