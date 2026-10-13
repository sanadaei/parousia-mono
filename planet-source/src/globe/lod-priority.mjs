/** Stable max-priority queue for LOD refinement. Equal scores retain the old
 * array-sort order, including infinite error bounds and equal distances. */
export class LodPriorityQueue {
  constructor(){this.items=[];this.sequence=0;}
  get length(){return this.items.length;}
  before(a,b){return a.value.score===b.value.score
    ? a.value.distance===b.value.distance?a.order<b.order:a.value.distance<b.value.distance
    : a.value.score>b.value.score;}
  push(value){
    const item={value,order:this.sequence++},a=this.items;let i=a.length;a.push(item);
    while(i){const p=Math.floor((i-1)/2);if(!this.before(item,a[p]))break;a[i]=a[p];i=p;}a[i]=item;
  }
  shift(){
    const a=this.items;if(!a.length)return undefined;const first=a[0],last=a.pop();
    if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&this.before(a[c+1],a[c]))c++;
      if(!this.before(a[c],last))break;a[i]=a[c];i=c;}a[i]=last;}
    return first.value;
  }
}
