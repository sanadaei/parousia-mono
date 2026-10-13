import {TERRITORY_SCENARIO} from '../core/territory-scenario.mjs';
import {projectSettlement} from './map-annotations.mjs';
const palette=[[202,137,97],[123,165,204],[155,187,111],[192,141,190],[213,188,101],[109,183,171],[190,147,126],[153,158,207]];
export function makeTerritoryMap(scenario,climate){
 if(scenario.method!==TERRITORY_SCENARIO||scenario.climateId!==climate.id||scenario.grid.columns!==climate.grid.columns||scenario.grid.rows!==climate.grid.rows)throw new Error('Territory climate or method mismatch');
 if(scenario.owner.length!==climate.biome.length||scenario.owner.length>32768||scenario.territories.length>64||scenario.owner.some(v=>!Number.isInteger(v)||v< -1||v>=scenario.territories.length))throw new Error('Invalid territorial membership');
 const {columns:width,rows:height}=scenario.grid,rgba=new Uint8Array(width*height*4);
 for(let i=0;i<scenario.owner.length;i++){const owner=scenario.owner[i],wet=['ocean','lake'].includes(climate.biome[i]),c=wet?[36,84,124]:owner<0?[145,145,132]:palette[owner%palette.length];rgba.set([...c,255],i*4);}
 // At regional resolution a border is a marked cell, not a fabricated survey.
 for(const edge of scenario.boundaries)for(const i of [edge.a,edge.b])if(scenario.owner[i]>=0){for(let k=0;k<3;k++)rgba[i*4+k]=Math.round(rgba[i*4+k]*.65+255*.35);}
 return {key:scenario.id,width,height,rgba};
}
export class TerritoryLabels{
 constructor(container){this.container=container;this.labels=[];for(let i=0;i<64;i++){const el=document.createElement('span');el.className='map-label territory-label';el.hidden=true;container.append(el);this.labels.push(el);}}
 update(scenario,cam,radius,width,height,enabled){const occupied=[];for(let i=0;i<64;i++){const el=this.labels[i],t=scenario?.territories[i],p=t&&projectSettlement({...t,elevationM:0},cam,radius,width,height);const visible=enabled&&p&&!occupied.some(q=>Math.abs(p.x-q.x)<180&&Math.abs(p.y-q.y)<40);el.hidden=!visible;if(visible){occupied.push(p);el.textContent=t.id;el.title=`${t.name} / 仮の領有 / 地域人口 ${t.population.toLocaleString()}`;el.style.left=`${p.x}px`;el.style.top=`${p.y}px`;}}}
}
