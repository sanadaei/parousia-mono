/** Shared compact C1 positive-part/cap and absolute-width smooth union.
 * The caller supplies spatially C1 capsules; this does not smooth a C0 base. */
export function createIncisionKernel(limit){
 if(!Number.isFinite(limit)||limit<=0)throw new RangeError('Invalid incision limit');
 const epsilon=Math.min(.01,limit*.01),positive=x=>x<=0?0:x<epsilon?x*x/(2*epsilon):x-epsilon/2;
 const ceiling=x=>Math.abs(x-limit)>=epsilon?Math.min(x,limit):Math.min(x,limit)-(epsilon-Math.abs(x-limit))**2/(4*epsilon);
 return Object.freeze({positive,ceiling,epsilon,limit});
}
export function smoothIncisionUnion(a,b){
 if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)throw new RangeError('Invalid incision union inputs');
 if(a===0||b===0)return a+b;
 const width=.02*(-Math.expm1(-(a+b)/.02)),difference=Math.abs(a-b);
 return difference>=width?Math.max(a,b):Math.max(a,b)+(width-difference)**2/(4*width);
}
