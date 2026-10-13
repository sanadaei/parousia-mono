import { hashJson } from '../../src/core/json-contract.mjs';

/** A bounded, explicit valley skeleton -> shared initial height field.
 * Independent geometric construction, NOT a reproduction of a landscape paper.
 * Every edge goes downstream (from -> to); its heights are supplied, not inferred.
 * A lower envelope can undercut conflicting channel heights. Those conflicts are
 * diagnosed rather than silently labelled as valid hydraulic geometry.
 */
export function createDrainageEnvelope({ nodes, edges, crossSlope } = {}) {
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > 512 ||
      !Array.isArray(edges) || edges.length < 1 || edges.length > 1024 ||
      !Number.isFinite(crossSlope) || crossSlope <= 0 || crossSlope > 5) {
    throw new RangeError('Bounded explicit drainage skeleton and positive crossSlope required');
  }
  const ids = new Map();
  const owned = nodes.map(p => {
    if (typeof p?.id !== 'string' || !p.id || ids.has(p.id) ||
        ![p.xM, p.yM, p.heightM].every(v => Number.isFinite(v) && Math.abs(v) <= 1e7)) {
      throw new TypeError('Unique finite metric skeleton nodes required');
    }
    const q = { id:p.id, xM:p.xM, yM:p.yM, heightM:p.heightM };
    ids.set(q.id, q); return q;
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const downstream = new Map(), used = new Set();
  const segments = edges.map(e => {
    const a=ids.get(e?.from), b=ids.get(e?.to);
    if (!a || !b || a === b || downstream.has(a.id)) throw new TypeError('One downstream edge per nonterminal node required');
    const length=Math.hypot(b.xM-a.xM,b.yM-a.yM);
    const grade=(b.heightM-a.heightM)/length;
    if (!(length>0) || grade>0 || !Number.isFinite(grade) || Math.abs(grade)>=crossSlope) {
      throw new RangeError('Distinct downstream points with a grade below crossSlope required');
    }
    downstream.set(a.id,b.id); used.add(a.id); used.add(b.id);
    return {a,b,length,grade,ux:(b.xM-a.xM)/length,uy:(b.yM-a.yM)/length};
  }).sort((a,b)=>a.a.id < b.a.id ? -1 : a.a.id > b.a.id ? 1 : 0);
  if (used.size!==nodes.length) throw new TypeError('Isolated skeleton node');
  for(const p of owned) {
    let current=p.id; const visited=new Set();
    while(downstream.has(current)) {
      if(visited.has(current)) throw new RangeError('Drainage skeleton contains a cycle');
      visited.add(current); current=downstream.get(current);
    }
  }
  function heightAt(xM,yM) {
    if(![xM,yM].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7)) throw new RangeError('Finite bounded sample coordinates required');
    let best=Infinity;
    for(const s of segments) {
      const px=xM-s.a.xM,py=yM-s.a.yM,u=px*s.ux+py*s.uy,d=Math.abs(px*s.uy-py*s.ux);
      const t=Math.max(0,Math.min(s.length,u-s.grade*d/Math.sqrt(crossSlope**2-s.grade**2)));
      best=Math.min(best,s.a.heightM+s.grade*t+crossSlope*Math.hypot(u-t,d));
    }
    return best;
  }
  // Finite audit, explicitly not a proof of continuous constraint compatibility.
  let maximumSampledUndercutM=0;
  for(const s of segments) for(let i=0;i<=32;i++) {
    const t=i/32;
    maximumSampledUndercutM=Math.max(maximumSampledUndercutM,
      s.a.heightM*(1-t)+s.b.heightM*t-heightAt(s.a.xM*(1-t)+s.b.xM*t,s.a.yM*(1-t)+s.b.yM*t));
  }
  const contract={method:'explicit-drainage-envelope-research@1',nodes:owned,
    edges:segments.map(s=>({from:s.a.id,to:s.b.id})),crossSlope};
  return { id:hashJson(contract), contract:structuredClone(contract), heightAt,
    diagnostics:{maximumSampledUndercutM,samplesPerEdge:33,
      compatibleAtSampledPoints:maximumSampledUndercutM<1e-7,
      terminals:owned.filter(p=>!downstream.has(p.id)).map(p=>p.id)},
    sampleGrid({n,extentM,originXM=0,originYM=0}={}) {
      if(!Number.isInteger(n)||n<3||n>257||!Number.isFinite(extentM)||extentM<=0||extentM>100000||
          n*n*segments.length>1e7||![originXM,originYM].every(Number.isFinite)) throw new RangeError('Bounded envelope sampling budget required');
      return Array.from({length:n*n},(_,i)=>heightAt(originXM+i%n*extentM/(n-1),originYM+Math.floor(i/n)*extentM/(n-1)));
    },
  };
}
