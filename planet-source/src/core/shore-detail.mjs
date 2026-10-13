export const MULTISCALE_SHORE_METHOD='anchored-multiscale-shore@4';
export const SHORE_DETAIL_METHOD='anchored-spherical-shore-preserving@3';
export const isAnchoredDetailMethod=m=>m==='anchored-spherical-residual-bands@2'||m===SHORE_DETAIL_METHOD||m===MULTISCALE_SHORE_METHOD||m===LOCAL_SHORE_METHOD;
/** C1 compact attenuation preserves the macro ground's side of every supplied
 * water level. With |noise|<=A, smoothstep(|delta|/(2A))*A <= .5625*|delta|.
 * Farther than 2A from a shore level, the original detail is unchanged. */
export function shoreDetailConstraint(levels,amplitude){
 if(!Array.isArray(levels)||levels.length>4096||!levels.every(Number.isFinite)||!Number.isFinite(amplitude)||amplitude<0)throw new TypeError('Invalid shore detail constraints');
 const sorted=[...new Set(levels)].sort((a,b)=>a-b);let overlap=0,left=0;
 for(let right=0;right<sorted.length;right++){while(sorted[right]-sorted[left]>4*amplitude)left++;overlap=Math.max(overlap,right-left+1);}
 return{baseGradientMultiplier:amplitude>0?.75*overlap:0,apply(base,detail){if(amplitude===0)return detail;let scale=1;
 // Binary-search the only levels that can affect this elevation.
 let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid]<base-2*amplitude)lo=mid+1;else hi=mid;}
 for(let i=lo;i<sorted.length&&sorted[i]<=base+2*amplitude;i++){const t=Math.min(1,Math.abs(base-sorted[i])/(2*amplitude));scale*=t*t*(3-2*t);}return detail*scale;}};
}

/** Independent amplitude budgets keep short wavelengths alive on lowland
 * terrain. Default shares are 1/4; explicit shares must sum to at most one. */
export function multiscaleShoreConstraints(detail){return detail.bands.filter(b=>b.amplitudeM>0).map(b=>({...b,constraint:shoreDetailConstraint(detail.shoreLevelsM,b.amplitudeM/(b.shoreBudgetFraction??.25))}));}
export function multiscaleShoreGradient(detail){return multiscaleShoreConstraints(detail).reduce((n,b)=>n+b.constraint.baseGradientMultiplier*(b.shoreBudgetFraction??.25),0);}

export const LOCAL_SHORE_METHOD='anchored-local-shores@5';
/** A lake protects its interpolation support, not every equal-altitude point
 * on the planet. C1 shoulders fade outside that support. Membership is saved,
 * independent of view/LOD; overlapping cells combine by a smooth union. */
export function localShoreMask(detail,grid){
 const w=grid.columns,h=grid.rows,cells=new Map(),regions=detail.shoreRegions??[];
 const smooth=t=>t*t*(3-2*t),kernel=d=>d<=1?1:d>=2.5?0:1-smooth((d-1)/1.5);
 for(let i=0;i<regions.length;i++)for(const cell of regions[i].cells){if(!Number.isSafeInteger(cell)||cell<0||cell>=w*h)throw new RangeError('Invalid local shore cell');const owners=cells.get(cell)??[];if(owners.includes(i)||owners.length>=4)throw new RangeError('Duplicate or excessive local shore controls');owners.push(i);cells.set(cell,owners);}
 const polar=[new Set(),new Set()];for(const [cell,owners] of cells)for(const i of owners){if(cell<w)polar[0].add(i);if(cell>=(h-1)*w)polar[1].add(i);}
 return(x,y)=>{const weights=new Map();for(let yy=Math.max(0,Math.ceil(y-3));yy<=Math.min(h-1,Math.floor(y+2));yy++)for(let xx=Math.ceil(x-3);xx<=Math.floor(x+2);xx++){const owners=cells.get(yy*w+((xx%w+w)%w));if(!owners)continue;const weight=kernel(Math.abs(x-(xx+.5)))*kernel(Math.abs(y-(yy+.5)));if(weight>0)for(const i of owners)weights.set(i,1-(1-(weights.get(i)??0))*(1-weight));}
 // Collapse longitude at the poles without an angular seam.
 const pole=y<.5?0:y>h-.5?1:-1;if(pole>=0){const t=smooth(Math.max(0,Math.min(1,pole===0?y/.5:(h-y)/.5)));for(const i of new Set([...weights.keys(),...polar[pole]]))weights.set(i,t*(weights.get(i)??0)+(1-t)*(polar[pole].has(i)?1:0));}
 return [...weights].map(([i,weight])=>({level:regions[i].levelElevationM,weight}));};
}
export function localShoreConstraint(detail,grid){
 const mask=localShoreMask(detail,grid),bands=multiscaleShoreConstraints(detail),regional=(detail.shoreRegions??[]).map(r=>({level:r.levelElevationM,constraints:bands.map(b=>shoreDetailConstraint([r.levelElevationM],b.amplitudeM/(b.shoreBudgetFraction??.25)))})),byLevel=new Map(regional.map(r=>[r.level,r.constraints]));
 return(base,parts,x,y)=>{const active=mask(x,y);return parts.reduce((sum,v,i)=>{const activation=bands[i].elevationActivationM,t=activation?Math.max(0,Math.min(1,(base-activation[0])/(activation[1]-activation[0]))):1;let result=bands[i].constraint.apply(base,v*t*t*(3-2*t));for(const r of active){const attenuated=byLevel.get(r.level)[i].apply(base,result);result+=(attenuated-result)*r.weight;}return sum+result;},0);};
}
export function localShoreSpatialGradient(detail,grid,radiusM,latitudeRangeRad=null){
 if(detail.method!==LOCAL_SHORE_METHOD)return 0;
 const amplitude=detail.bands.reduce((s,b)=>s+b.amplitudeM,0),alpha=Math.PI/(2*grid.rows);
 let cosine=Math.sin(alpha);
 if(latitudeRangeRad){const [low,high]=latitudeRangeRad;if(latitudeRangeRad.length!==2||![low,high].every(Number.isFinite)||low>high||low< -Math.PI/2||high>Math.PI/2)throw new RangeError('Invalid shore latitude range');
  if(low> -Math.PI/2+alpha&&high<Math.PI/2-alpha)cosine=Math.cos(Math.max(Math.abs(low),Math.abs(high)));
 }
 // At most 36 source cells have nonzero shoulder support at a point, plus
 // polar union blending. Deliberately conservative; never lower an LOD bound.
 return amplitude*(256+6*(detail.shoreRegions?.length??0))*Math.hypot(grid.columns/(2*Math.PI*radiusM*cosine),grid.rows/(Math.PI*radiusM));
}
