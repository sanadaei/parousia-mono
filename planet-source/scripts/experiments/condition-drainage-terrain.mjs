/** A geometric generation constraint, NOT simulated geological erosion.
 * Projects an uncommitted candidate onto its directed drainage tree: maintain a
 * small downstream grade, hold supplied anchors, and cut only where required.
 * Existing committed terrain must never be passed here for silent alteration.
 */
export function conditionDrainageTerrain({elevation,receiver,columns,cellSizeM,minGrade=.001,fixed=[]}={}){
 const n=elevation?.length;
 if(!Number.isSafeInteger(n)||n<3||n>65536||receiver?.length!==n||!elevation.every(Number.isFinite)||!Number.isSafeInteger(columns)||columns<3||n%columns||!Number.isFinite(cellSizeM)||cellSizeM<=0||!Number.isFinite(minGrade)||minGrade<=0||minGrade>.02)throw new RangeError('Bounded uncommitted drainage candidate required');
 const donors=Array.from({length:n},()=>[]),order=[],anchors=new Map();
 for(let i=0;i<n;i++){const q=receiver[i];if(!Number.isSafeInteger(q)||q< -1||q>=n||q===i)throw new RangeError('Invalid drainage receiver');if(q<0){order.push(i);anchors.set(i,elevation[i]);}else{const dx=Math.abs(i%columns-q%columns),dy=Math.abs(Math.floor(i/columns)-Math.floor(q/columns));if(dx>1||dy>1)throw new RangeError('Nonadjacent receiver');donors[q].push(i);}}
 for(const a of fixed){if(!Number.isSafeInteger(a.cell)||a.cell<0||a.cell>=n||!Number.isFinite(a.elevationM)||anchors.has(a.cell)&&anchors.get(a.cell)!==a.elevationM)throw new RangeError('Invalid fixed terrain anchor');anchors.set(a.cell,a.elevationM);}
 for(let k=0;k<order.length;k++)order.push(...donors[order[k]]);if(order.length!==n)throw new RangeError('Cyclic drainage');
 const distance=i=>{const q=receiver[i];return q<0?0:Math.hypot(i%columns-q%columns,Math.floor(i/columns)-Math.floor(q/columns))*cellSizeM;},floor=Array(n).fill(0),z=[...elevation];
 for(const i of order){const q=receiver[i],required=q<0?-Infinity:floor[q]+minGrade*distance(i);if(anchors.has(i)){const a=anchors.get(i);if(a<required-1e-8)throw new Error('Drainage topology conflicts with fixed boundary heights');floor[i]=a;z[i]=a;}else{floor[i]=required;z[i]=Math.max(z[i],floor[i]);}}
 for(let k=order.length-1;k>=0;k--){const i=order[k],q=receiver[i];if(q<0||anchors.has(q))continue;z[q]=Math.max(floor[q],Math.min(z[q],z[i]-minGrade*distance(i)));}
 let maxCutM=0,maxRaiseM=0,cutCells=0,raisedCells=0,maxGradeViolationM=0;
 for(let i=0;i<n;i++){const d=z[i]-elevation[i];if(d< -1e-7)cutCells++;if(d>1e-7)raisedCells++;maxCutM=Math.max(maxCutM,-d);maxRaiseM=Math.max(maxRaiseM,d);const q=receiver[i];if(q>=0)maxGradeViolationM=Math.max(maxGradeViolationM,z[q]+minGrade*distance(i)-z[i]);}
 return{elevation:z,diagnostics:{maxCutM,maxRaiseM,cutCells,raisedCells,maxGradeViolationM,anchors:anchors.size},limits:['Geometric projection of an uncommitted candidate, not erosion time','No sediment mass balance or floodplain deposition','Grid-width cuts may require bank reconstruction before adoption','Fixed boundary conflicts reject; no silent edits to neighbour anchors']};
}
