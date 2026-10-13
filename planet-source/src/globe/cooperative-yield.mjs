/** Yield a real host task so input/cancellation can run. Recursive setTimeout(0)
 * is clamped by browsers; scheduler.yield avoids adding that fixed delay to
 * every short chunk. Node's immediate queue serves the same role in verifiers. */
export function cooperativeYieldMethod(host=globalThis){
 if(typeof host.scheduler?.yield==='function')return 'scheduler.yield';
 if(typeof host.setImmediate==='function')return 'setImmediate';
 return 'setTimeout';
}
export function cooperativeYield(host=globalThis){
 const method=cooperativeYieldMethod(host);
 if(method==='scheduler.yield')return host.scheduler.yield();
 return new Promise(resolve=>method==='setImmediate'?host.setImmediate(resolve):host.setTimeout(resolve,0));
}
