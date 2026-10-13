/** Release page-owned Workers/buffers on navigation. A restored bfcache page
 * still contains the terminated objects, so reload that exact URL once rather
 * than resume a dead render/calculation loop. Ordinary first loads do nothing. */
export function installPageRecovery({target=window,onHide,reload=()=>location.reload()}={}){
 if(typeof onHide!=='function'||typeof reload!=='function')throw new TypeError('Page recovery callbacks required');
 let suspended=false;
 const hide=event=>{if(suspended)return;suspended=true;onHide(event);};
 const show=event=>{if(!event.persisted||!suspended)return;suspended=false;reload();};
 target.addEventListener('pagehide',hide);target.addEventListener('pageshow',show);
 return()=>{target.removeEventListener('pagehide',hide);target.removeEventListener('pageshow',show);};
}
