/** A compact outer apron for earthwork. Core road, water and foundation
 * footprints are enclosed in the inner rectangle. Only their exterior batters
 * are attenuated, so a feature chart meets its base exactly at the boundary.
 * This does not establish acceptable batter slopes or inter-chart road joins. */
export const EARTHWORK_ENVELOPE='c1-outer-earthwork-apron@1';
const smooth=t=>t*t*(3-2*t),keys=['minXM','maxXM','minYM','maxYM'];
export function withEarthworkEnvelope(recipe,{apronM=30}={}){
 if(recipe.earthworkEnvelope)throw new Error('Recipe already has an earthwork envelope');
 if(!Number.isFinite(apronM)||apronM<10||apronM>200)throw new RangeError('Invalid earthwork apron');
 const inner=footprintBounds(recipe,{...recipe.bounds});
 const bounds={minXM:inner.minXM-apronM,maxXM:inner.maxXM+apronM,minYM:inner.minYM-apronM,maxYM:inner.maxYM+apronM};
 if(Math.max(...[bounds.minXM,bounds.maxXM].flatMap(x=>[bounds.minYM,bounds.maxYM].map(y=>Math.hypot(x,y))))>=recipe.projection.maxRadiusM)throw new RangeError('Earthwork apron exceeds projection');
 return{...recipe,bounds,earthworkEnvelope:{method:EARTHWORK_ENVELOPE,innerBounds:inner}};
}
function footprintBounds(recipe,inner){
 const add=(p,r=0)=>{if(![p.xM,p.yM,r].every(Number.isFinite)||r<0)throw new TypeError('Invalid physical footprint');inner.minXM=Math.min(inner.minXM,p.xM-r);inner.maxXM=Math.max(inner.maxXM,p.xM+r);inner.minYM=Math.min(inner.minYM,p.yM-r);inner.maxYM=Math.max(inner.maxYM,p.yM+r);};
 const box=b=>{if(!b)return;add({xM:b.minXM,yM:b.minYM});add({xM:b.maxXM,yM:b.maxYM});};
 for(const r of recipe.roadCenterlineProfiles??[])for(const p of r.samples)add(p,(r.halfWidthM??3)+1);
 for(const b of [...(recipe.buildings??[]),...(recipe.buildingPads??[])]){box(b.bounds);for(const p of b.polygon??[])add(p,1);}
 for(const e of recipe.model.edges??[])for(const p of e.points)add(p,p.halfWidthM+1);
 for(const b of recipe.model.bodies??[])for(const p of b.polygon)add(p,1);
 return inner;
}
export function createEarthworkEnvelope(recipe){
 if(!recipe.earthworkEnvelope)return null;
 const {method,innerBounds:i}=recipe.earthworkEnvelope,b=recipe.bounds;
 if(method!==EARTHWORK_ENVELOPE||!i||!keys.every(k=>Number.isFinite(i[k])&&Number.isFinite(b[k]))||i.minXM>=i.maxXM||i.minYM>=i.maxYM||b.minXM>=i.minXM||b.maxXM<=i.maxXM||b.minYM>=i.minYM||b.maxYM<=i.maxYM)throw new RangeError('Invalid chart earthwork envelope');
 const core=footprintBounds(recipe,{minXM:Infinity,maxXM:-Infinity,minYM:Infinity,maxYM:-Infinity});
 if(core.minXM<i.minXM||core.maxXM>i.maxXM||core.minYM<i.minYM||core.maxYM>i.maxYM)throw new RangeError('Physical footprint outside inner earthwork envelope');
 const axis=(v,low,high,outerLow,outerHigh)=>v<low?smooth(Math.max(0,Math.min(1,(v-outerLow)/(low-outerLow)))):v>high?smooth(Math.max(0,Math.min(1,(outerHigh-v)/(outerHigh-high)))):1;
 const weight=(x,y)=>axis(x,i.minXM,i.maxXM,b.minXM,b.maxXM)*axis(y,i.minYM,i.maxYM,b.minYM,b.maxYM);
 return{weight,apply(x,y,base,adjusted){const w=weight(x,y);return w===1?adjusted:w===0?base:base+(adjusted-base)*w;},bounds(base,adjusted,disk){
  let low=0,high=1;
  if(disk){const {xM:x,yM:y,radiusM:r}=disk;low=Math.min(...[-r,r].flatMap(dx=>[-r,r].map(dy=>weight(x+dx,y+dy))));high=weight(Math.max(x-r,Math.min(x+r,(i.minXM+i.maxXM)/2)),Math.max(y-r,Math.min(y+r,(i.minYM+i.maxYM)/2)));}
  const values=base.flatMap(a=>adjusted.flatMap(z=>[a+(z-a)*low,a+(z-a)*high]));return[Math.min(...values),Math.max(...values)];
 }};
}
