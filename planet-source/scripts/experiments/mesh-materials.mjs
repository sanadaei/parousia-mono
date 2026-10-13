/** Research-only material columns, in initial material coordinates.
 * Contacts rise with uplift. This sharp-contact, piecewise implicit n=1
 * approximation is not Terrainbento's smooth two-lithology implementation.
 */
export function boundedNodeField(value,n,min,max,name) {
 const scalar=typeof value==='number';
 if(!scalar&&(!Array.isArray(value)&&!ArrayBuffer.isView(value)||value.length!==n))throw new RangeError(`${name}: scalar or complete node field required`);
 const values=scalar?new Float64Array(n).fill(value):Float64Array.from(value);
 if(!values.every(x=>Number.isFinite(x)&&x>=min&&x<=max))throw new RangeError(`${name}: bounded finite values required`);
 return {values,record:scalar?value:Array.from(values)};
}
export function materialColumn(spec,baseK) {
 if(spec==null)return null;
 const {boundariesM:b,multipliers:m}=spec;
 if(!Array.isArray(b)||!Array.isArray(m)||b.length<1||b.length>8||m.length!==b.length+1||
    Array.from(b).some((v,i)=>!Number.isFinite(v)||Math.abs(v)>1e7||(i&&v<=b[i-1]))||
    Array.from(m).some(v=>!Number.isFinite(v)||v<=0||v>1000))throw new RangeError('Bounded ordered material contacts and layer multipliers required');
 let lo=Infinity,hi=-Infinity;for(const k of baseK){lo=Math.min(lo,k);hi=Math.max(hi,k);}
 if(m.some(v=>lo*v<1e-12||hi*v>.01))throw new RangeError('Effective erodibility outside supported range');
 const boundariesM=[],multipliers=[m[0]];
 for(let i=0;i<b.length;i++)if(m[i+1]!==m[i]){boundariesM.push(b[i]);multipliers.push(m[i+1]);}
 return {boundariesM,multipliers};
}
/** Downstream height is held at the already solved next-step height. At each
 * crossed contact consume the implicit time-to-contact, then continue in the
 * next material. At most eight contacts can be crossed in one call.
 */
export function inciseMaterialColumn(z,down,rate,dt,upliftOffset,column) {
 const b=column.boundariesM,m=column.multipliers;
 let layer=0;while(layer<b.length&&z-upliftOffset>b[layer])layer++;
 let remaining=dt,crossings=0;
 while(remaining>0&&z>down){
  const a=remaining*rate*m[layer],predicted=(z+a*down)/(1+a);
  const contact=layer?b[layer-1]+upliftOffset:-Infinity;
  if(predicted>=contact||contact<=down)return {height:predicted,crossings};
  const used=(z-contact)/(rate*m[layer]*(contact-down));
  remaining=Math.max(0,remaining-used);z=contact;layer--;crossings++;
 }
 return {height:z,crossings};
}
