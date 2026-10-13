/** Display-only terrain tones. No height, water, biome or source identity is
 * changed. The shape draft uses its own relief range rather than a global
 * 0–7000 m ramp, so a 200 m valley remains legible after geographic placement.
 * The restrained elevation tint is not a claim about vegetation or geology. */
const clamp=x=>Math.max(0,Math.min(1,x));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const GLOBAL=[[0,[.17,.29,.23]],[800,[.27,.42,.28]],[2200,[.45,.43,.30]],[4500,[.65,.63,.57]],[7000,[.86,.89,.87]]];
export const DESIGNED_WATER_COLOR=Object.freeze([.12,.40,.46]);
// Optional inspection symbols remain distinguishable from physical water.
export const RIVER_GUIDE_COLOR=Object.freeze([.22,.53,.65]);
export function terrainAppearance(elevationM,sample,region){
 if(sample?.groundCover?.color)return sample.groundCover.color;
 const k=GLOBAL.findIndex(p=>elevationM<p[0]);
 const base=k<=0?(k===0?GLOBAL[0]:GLOBAL.at(-1))[1]:mix(GLOBAL[k-1][1],GLOBAL[k][1],(elevationM-GLOBAL[k-1][0])/(GLOBAL[k][0]-GLOBAL[k-1][0]));
 if(!sample?.shapeFirst||!region)return base;
 const range=region.elevationRangeM,t=clamp((elevationM-range[0])/Math.max(1,range[1]-range[0]));
 const low=[.34,.46,.32],middle=[.52,.57,.39],high=[.68,.66,.50];
 let tone=t<.55?mix(low,middle,smooth(0,.55,t)):mix(middle,high,smooth(.55,1,t));
 // Use measured grade only. Steep banks expose a muted mineral tone, while
 // gentle grass-covered slopes retain enough luminance for directional light.
 const grade=Number.isFinite(sample.slopeMPerM)?sample.slopeMPerM:0;
 tone=mix(tone,[.53,.48,.37],smooth(.18,.8,grade)*.8);
 if(sample.waterDepthM>0)tone=mix(tone,[.30,.34,.27],.65);
 return mix(base,tone,clamp(sample.shapeFirst.weight??1));
}
/** Oblique regional entry frames the whole roughly 10 km draft. Explicit
 * saved views and URL altitude always take precedence in the caller. */
export function shapeFirstOverview(region){
 const span=Math.max(region.extent.widthM,region.extent.heightM);
 return {altitudeM:Math.max(5000,span*1.05),tiltDeg:45,localHour:12};
}
