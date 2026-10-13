import {SettlementPages} from './settlement-pages.mjs';
import {projectSettlement} from './map-annotations.mjs';
/** Fixed-size label pool with screen-space decluttering; never a DOM node per village. */
export class SettlementLabels{
 constructor(manifest,url,container,select,onSelect){this.manifest=manifest;this.pages=new SettlementPages(manifest,url);this.container=container;this.select=select;this.onSelect=onSelect;this.sites=manifest.settlementCatalogue?.landmarks??[];this.pending=false;this.next=0;this.error=null;this.controller=new AbortController();this.buttons=[];this.visible=new Map();
  container.replaceChildren();for(let i=0;i<64;i++){const b=document.createElement('button');b.className='map-label';b.hidden=true;b.onclick=()=>{if(b.place)onSelect(b.place);};container.append(b);this.buttons.push(b);}
  select.onchange=()=>{const p=this.visible.get(select.value);if(p)onSelect(p);};
 }
 update(cam,width,height,time,enabled){
  if(!this.pending&&time>=this.next){this.pending=true;this.next=time+1000;const bound={center:cam.targetUp,angular:Math.min(Math.PI,Math.max(2000,cam.altitude*1.5)/this.pages.radius)};this.pages.near(bound,this.controller.signal,16000,{includeRoads:false}).then(s=>{this.sites=s;this.error=null;}).catch(e=>{if(e.name!=='AbortError')this.error=e.message;}).finally(()=>{this.pending=false;});}
  const candidates=[...(this.manifest.settlements??[]),...this.sites].map(place=>({place,p:projectSettlement(place,cam,this.pages.radius,width,height)})).filter(q=>q.p).sort((a,b)=>(b.place.population??1000)-(a.place.population??1000)||a.place.id.localeCompare(b.place.id));
  const accepted=[];for(const q of candidates){if(accepted.length===64)break;if(accepted.some(a=>Math.abs(a.p.x-q.p.x)<150&&Math.abs(a.p.y-q.p.y)<26))continue;accepted.push(q);}
  for(let i=0;i<64;i++){const b=this.buttons[i],q=accepted[i];b.hidden=!enabled||!q;if(q){b.place=q.place;b.textContent=`${q.place.name} · ${q.place.id}`;b.title=q.place.population?`${q.place.population}人。クリックして近づく`:q.place.id;b.style.left=`${q.p.x}px`;b.style.top=`${q.p.y}px`;}}
  // Nearby choices remain bounded, including settlements hidden by label collisions.
  const options=candidates.slice(0,128).map(q=>q.place),key=options.map(p=>p.id).join('|');
  if(key!==this.key){this.key=key;const selected=this.select.value;this.visible=new Map(options.map(p=>[p.id,p]));this.select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='画面内の集落を選ぶ';this.select.append(blank);for(const p of options){const o=document.createElement('option');o.value=p.id;o.textContent=`${p.name} · ${p.id}${p.population?' / '+p.population+'人':''}`;this.select.append(o);}if(this.visible.has(selected))this.select.value=selected;}
 }
 destroy(){this.controller.abort();this.pages.cache.clear();}
}
