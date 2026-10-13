import {PagedSource} from './paged-source.mjs';
import {planSettlementDistricts} from '../core/settlement-districts.mjs';
import {facilityById} from '../core/settlement-facilities.mjs';
/** Resolve the exact selected site. Never replace an unknown village with the
 * first saved demo or construct every district just to inspect one. */
export async function resolveSettlementInspection(manifest,url,id,district=0,fetcher){
 if(!Number.isSafeInteger(district)||district<0)throw new RangeError('区画番号が不正です');
 if(manifest.settlementCatalogue&&id){const source=new PagedSource(manifest,url,fetcher),site=await source.settlementPages.getSite(id);if(site){const plan=planSettlementDistricts(site,manifest.base.frame.radiusM);plan.district(district);return{site,districtCount:plan.count,descriptor:{procedural:true,site,districtIndex:district,inspectionOnly:true}};}}
 const index=id?(manifest.settlements??[]).findIndex(s=>s.id===id):0;
 if(index<0||!manifest.settlements?.[index])throw new Error('指定された集落はこの保存世界にありません');
 if(district!==0)throw new RangeError('この旧保存集落には追加区画がありません');
 const descriptor=(manifest.featureCharts??(manifest.features?[manifest.features]:[]))[index];if(!descriptor)throw new Error('この集落の保存区画がありません');
 return{site:manifest.settlements[index],districtCount:1,descriptor:{...descriptor,inspectionOnly:true}};
}
const labels={village_green:'村の広場',market_square:'市場の広場',churchyard:'礼拝所の敷地',chapel_tower:'礼拝所の塔',constructed_communal_pond:'共同貯水池',household_garden:'家の菜園',workyard:'作業庭',service_workyard:'作業庭'};
export function settlementInspectionItems(recipe){
 const items=[...(recipe.landUses??[]).map(p=>({...p,id:p.parcelId,category:'land'})),...(recipe.landParcels??[]).map(p=>({...p,category:'land'})),...(recipe.waterFeatures??[]).map(p=>({...p,category:'water'})),...recipe.buildings.map(p=>({...p,category:'building'}))];
 if(items.length>2048)throw new RangeError('一度に表示する敷地の上限を超えています');
 return items.map(p=>{const type=p.facilityType??p.type??'house',placement=recipe.economy?.placements?.find(q=>q.id===p.id)??recipe.settlementPlan?.placements?.find(q=>q.parcelId===p.id)??null;return{...p,type,label:labels[type]??facilityById(type)?.label??type,placement};});
}
export function inspectionExplanation(item){
 const p=item.placement;if(!p)return`${item.label}。同じ保存世界の配置規則による位置です。下の根拠には、存在する敷地調査・接続情報だけを表示します。`;
 const distance=Number.isFinite(p.reasons?.roadDistanceM)?`${p.reasons.roadDistanceM.toFixed(1)}m`:'未測定',links=p.links??[];
 return`${item.label}。道路まで${distance}。原料の供給計画への距離：${links.length?links.map(l=>Number.isFinite(l.distanceM)?Math.round(l.distanceM)+'m':'未測定').join('、'):'記録なし／原料リンク不要'}。供給は計画上の依存関係で、現在の在庫や生産量を保証しません。`;
}
