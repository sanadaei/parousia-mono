import {zoneOverlayColorAt} from './population-zone-map.mjs';
import {classifyEnvironment} from '../core/environment-cover.mjs';
import {BIOMES} from '../core/planet-climate.mjs';
import {readPage} from './page-request.mjs';
import {createHash} from '../core/sha256.mjs';
export async function loadVerifiedField(descriptor,manifestURL,fetcher=fetch){
 if(!descriptor)return null;const base=new URL(manifestURL),url=new URL(descriptor.path,base);if(url.origin!==base.origin)throw new Error('Data page origin differs');
 if(!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||descriptor.bytes>16000000)throw new Error('Data page exceeds budget');
 const text=await readPage(fetcher,url.href,{kind:'text'});if(new TextEncoder().encode(text).length!==descriptor.bytes||createHash('sha256').update(text).digest('hex')!==descriptor.sha256)throw new Error('Saved data hash mismatch');const data=JSON.parse(text);if(data.id!==descriptor.id)throw new Error('Saved data ID mismatch');return data;
}
export function climateCell(data,latDeg,lonDeg){const {columns:w,rows:h}=data.grid;return Math.max(0,Math.min(h-1,Math.floor((90-latDeg)/180*h)))*w+((Math.floor(lonDeg/360*w)%w)+w)%w;}
export function makeThematicMap(climate,population,mode='biome',month=-1){
 if(!['biome','temperature','agriculture','population','soil-moisture','water-supply','environment','watershed','upstream-area'].includes(mode)||!Number.isInteger(month)||month< -1||month>11)throw new RangeError('Invalid map layer');
 const {columns:w,rows:h}=climate.grid;if(w*h>32768)throw new RangeError('Map budget exceeded');
 if(['agriculture','population'].includes(mode)&&(!population||population.climateId!==climate.id))throw new Error('Matching population field required');
 if(['soil-moisture','water-supply','environment','watershed','upstream-area'].includes(mode)&&!climate.catchmentWater)throw new Error('この保存版には水系・環境接続データがありません。新規生成版で利用できます。');
 if(['watershed','upstream-area'].includes(mode)&&!climate.catchmentWater?.drainage)throw new Error('この保存版には流域参照データがありません。地形を変えずに作成できる派生データですが、この版では新規生成で利用できます。');
 const maximumUpstreamAreaKm2=mode==='upstream-area'?Math.max(1,climate.catchmentWater.drainage.upstreamLandAreaM2.reduce((m,v,i)=>['ocean','lake'].includes(climate.biome[i])?m:Math.max(m,v/1e6),0)):null;
 const rgba=new Uint8Array(w*h*4),temperature=month<0?climate.annualMeanTemperatureC:climate.monthlyTemperatureC[month];
 for(let i=0;i<w*h;i++){let c;
  if(mode==='biome')c=BIOMES[climate.biome[i]][1].slice(1).match(/../g).map(v=>parseInt(v,16));
  else if(['soil-moisture','water-supply','environment','watershed','upstream-area'].includes(mode)){
   const water=climate.catchmentWater,wet=['ocean','lake'].includes(climate.biome[i]);
   if(wet)c=[36,84,124];
   else if(mode==='watershed'){const id=water.drainage.terminalCell[i];let h=Math.imul(id+1,2654435761)>>>0;c=[80+(h&127),80+((h>>>8)&127),80+((h>>>16)&127)];}
   else if(mode==='upstream-area'){const v=Math.min(1,Math.sqrt(water.drainage.upstreamLandAreaM2[i]/1e6/maximumUpstreamAreaKm2));c=[220-170*v,215-65*v,175+65*v];}
   else if(mode==='environment')c=classifyEnvironment({biome:climate.biome[i],temperatureC:climate.annualMeanTemperatureC[i],annualRainMm:climate.annualPrecipitationMm[i],soilMoisture:water.meanSoilMoisture[i]}).color.map(v=>v*255);
   else {const v=mode==='soil-moisture'?water.meanSoilMoisture[i]:Math.min(1,Math.log1p(water.meanPotentialFlowM3PerSecond[i])/Math.log(10001));c=[190-155*v,160-30*v,100+120*v];}
  }
  else if(mode==='temperature'){const t=Math.max(0,Math.min(1,(temperature[i]+30)/65));c=[50+195*t,100+80*(1-Math.abs(t-.5)*2),240-195*t];}
  else{const wet=['ocean','lake'].includes(climate.biome[i]);const v=mode==='agriculture'?population.cells[i].suitability:Math.min(1,Math.log1p(population.cells[i].population/(climate.cellAreaM2[i]/1e6))/Math.log(101));c=wet?[36,84,124]:[170-120*v,70+150*v,50];}
  for(let k=0;k<3;k++)rgba[i*4+k]=Math.round(c[k]);rgba[i*4+3]=255;
 }
 return{key:`${climate.id}:${population?.id??''}:${mode}:${month}`,width:w,height:h,rgba,...(maximumUpstreamAreaKm2!==null?{maximumUpstreamAreaKm2}:{})};
}
export function mapColorAt(map,x,y,z){const len=Math.hypot(x,y,z),lat=Math.asin(z/len)*180/Math.PI,lon=Math.atan2(y,x)*180/Math.PI,i=climateCell({grid:{columns:map.width,rows:map.height}},lat,lon)*4;return zoneOverlayColorAt(map.zoneOverlay,lat,lon)??[map.rgba[i]/255,map.rgba[i+1]/255,map.rgba[i+2]/255];}
export function contourFactor(height,interval,width){if(!(interval>0)||height<0)return 1;const phase=((height%interval)+interval)%interval;return Math.min(phase,interval-phase)<width?.25:1;}

/** Screen-space isolines: nearly one pixel, not a fixed metre-wide band.
 * Flat surfaces and unresolved dense contours must not become black fills. */
export function screenContourFactor(height,interval,heightPerPixel){
 if(!(interval>0)||height<0||!(heightPerPixel>1e-6))return 1;
 const width=heightPerPixel*.7;if(width>=interval*.3)return 1;
 const phase=((height%interval)+interval)%interval,d=Math.min(phase,interval-phase),t=Math.max(0,Math.min(1,(d-width*.5)/(width*.5)));return .25+.75*t*t*(3-2*t);
}

/** Display-only contour density from approximate ground span. All levels remain
 * multiples of a common sea-level datum; switching scale never changes terrain. */
export function automaticContourInterval(spanM){
 if(!Number.isFinite(spanM)||spanM<=0)throw new RangeError('Invalid contour view span');
 for(const [span,interval] of [[500,2],[1500,5],[4000,10],[10000,20],[25000,50],[100000,100],[300000,250],[1000000,500]])if(spanM<=span)return interval;
 return 1000;
}
