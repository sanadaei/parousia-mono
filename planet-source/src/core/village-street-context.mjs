import {bearingVillagePortals,VILLAGE_PORTAL_POLICY} from './village-portals.mjs';
import {createSphericalProjection} from './spherical.mjs';
export const NETWORK_VILLAGE_STREETS='network-led-village-streets@1';
/** Use real desired external links to decide which village gateways are needed.
 * Regional roots retain four interfaces until their global links are resolved.
 * This describes access demand, not a certificate that every road is buildable. */
export function villageStreetContexts(sites,network,radiusM,{bearingPortals=false}={}){
 const index=new Map(sites.map(s=>[s.id,s])),gates=new Map(sites.map(s=>[s.id,new Set()])),directions=new Map(sites.map(s=>[s.id,[]]));
 for(const link of network.links)for(const end of ['from','to']){
  const site=index.get(link[end]);if(!site)continue;const points=link.points??[link.fromPoint,link.toPoint],ordered=end==='from'?points:[...points].reverse(),projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM,maxRadiusM:radiusM*.1});
  for(const p of ordered){const local=projection.toLocalIfWithin(p.latDeg,p.lonDeg);if(!local||Math.hypot(local.xM,local.yM)<1)continue;directions.get(site.id).push(local);gates.get(site.id).add(Math.abs(local.xM)>=Math.abs(local.yM)?local.xM>=0?'east':'west':local.yM>=0?'north':'south');break;}
 }
 return new Map(sites.filter(s=>s.kind==='village'&&s.id!==network.rootId&&gates.get(s.id).size).map(s=>[s.id,{streetPolicy:NETWORK_VILLAGE_STREETS,streetGates:['west','east','south','north'].filter(n=>gates.get(s.id).has(n)),...(bearingPortals&&s.population<=480?{villagePortalPolicy:VILLAGE_PORTAL_POLICY,streetPortals:bearingVillagePortals(directions.get(s.id))}:{}),streetDemandSource:'Saved regional settlement road links; construction still requires local survey'}]));
}
