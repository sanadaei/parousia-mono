import {validateElevationInterval,finiteNumber,positiveNumber} from './contract-validation.mjs';
/** Interval extension of the existing smoothstep cut/fill batter. No ground
 * mutation; every input is a bound over the same metric observation region. */
export function boundBatterBlend(base,target,offset,{cutBatterSlope,fillBatterSlope,batterWidthM=0}){
 base=validateElevationInterval(base);target=validateElevationInterval(target);offset=validateElevationInterval(offset);
 if(offset[0]<0)throw new RangeError('Batter offset must be nonnegative');
 positiveNumber(cutBatterSlope,'cut slope');positiveNumber(fillBatterSlope,'fill slope');finiteNumber(batterWidthM,'minimum batter width');
 if(batterWidthM<0)throw new RangeError('Minimum batter width must be nonnegative');
 const delta=[target[0]-base[1],target[1]-base[0]],width=d=>Math.hypot(batterWidthM,1.5*Math.abs(d)/(d>0?fillBatterSlope:cutBatterSlope)),
  maximumWidth=Math.max(width(delta[0]),width(delta[1])),minimumWidth=delta[0]<=0&&delta[1]>=0?batterWidthM:Math.min(width(delta[0]),width(delta[1])),
  ratio=(o,w)=>o===0?0:w===0?1:Math.min(1,o/w),smooth=t=>t*t*(3-2*t),
  minimumInfluence=1-smooth(ratio(offset[1],minimumWidth)),maximumInfluence=1-smooth(ratio(offset[0],maximumWidth)),
  mix=(a,b,w)=>(1-w)*a+w*b,
  low=Math.min(mix(base[0],target[0],minimumInfluence),mix(base[0],target[0],maximumInfluence)),
  high=Math.max(mix(base[1],target[1],minimumInfluence),mix(base[1],target[1],maximumInfluence));
 return{range:[low,high],minimumInfluence,maximumInfluence};
}

/** Normalized squared-odds blend. Ratios stay <= 1, so nearly full
 * carriageways cannot overflow. A single batter is bit-for-bit unchanged. */
export function blendBatterElevations(candidates, base) {
  if (!candidates.length) return base;
  const winner = candidates.reduce((a,b) => b.influence > a.influence ||
    (b.influence === a.influence && b.distance < a.distance) ? b : a);
  if (winner.influence === 1 || candidates.length === 1) return winner.elevation;
  const maximum = winner.influence;
  if (maximum <= 0) return base;
  let sum = 0, difference = 0;
  for (const c of candidates) {
    const ratio = c.influence * (1-maximum) / (maximum * (1-c.influence));
    const weight = ratio * ratio;
    sum += weight; difference += weight * (c.elevation - winner.elevation);
  }
  return winner.elevation + difference / sum;
}

/** Interval enclosure for the same blend. Every entry describes one road's
 * possible closest segment, not an additional independently applied segment.
 * Correlations are relaxed conservatively. The interval converges as input
 * ranges converge wherever the road geometry itself is continuous. */
export function boundBlendedBatters(entries, base) {
  const active = entries.filter(c => c.maximumInfluence > 0);
  if (!active.length) return base;
  const mayBeAbsent = active.every(c => c.minimumInfluence === 0);
  const hull = [Math.min(...active.map(c => c.range[0]), ...(mayBeAbsent ? [base[0]] : [])),
    Math.max(...active.map(c => c.range[1]), ...(mayBeAbsent ? [base[1]] : []))];
  if (active.length === 1) return hull;
  const logWeight = w => w === 0 ? -Infinity : w === 1 ? Infinity : 2 * (Math.log(w)-Math.log1p(-w));
  function share(own, others, upper) {
    if (own === 1) return upper || !others.includes(1) ? 1 : 0;
    if (others.includes(1)) return 0;
    if (own === 0) return upper && others.every(w => w === 0) ? 1 : 0;
    const logs = [logWeight(own), ...others.map(logWeight)], maximum = Math.max(...logs);
    return Math.exp(logs[0]-maximum) / logs.reduce((sum,v) => sum + Math.exp(v-maximum),0);
  }
  const reference = hull[0] / 2 + hull[1] / 2;
  let low = reference, high = reference;
  for (let i=0; i<active.length; i++) {
    const c=active[i], others=active.filter((_,j)=>j!==i),
      min=share(c.minimumInfluence,others.map(d=>d.maximumInfluence),false),
      max=share(c.maximumInfluence,others.map(d=>d.minimumInfluence),true),
      a=c.range[0]-reference,b=c.range[1]-reference;
    low += Math.min(min*a,max*a,min*b,max*b);
    high += Math.max(min*a,max*a,min*b,max*b);
  }
  if(mayBeAbsent){low=Math.min(low,base[0]);high=Math.max(high,base[1]);}
  return [Math.max(hull[0],low),Math.min(hull[1],high)];
}
