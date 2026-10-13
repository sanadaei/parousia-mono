/** Keep scheduler callbacks distinct from frames actually rasterized. */
export function benchmarkSummary(report) {
  const draw=Number.isFinite(report.actualDrawFPS)?report.actualDrawFPS:null;
  const callbacks=Number.isFinite(report.averageFPS)?report.averageFPS:null;
  const number=v=>v==null?'未測定':v.toFixed(1);
  return `測定終了 · ${number(draw)} 描画fps${report.rendererKind==='software-diagnostic'?'（CPU診断）':''} · 更新 ${number(callbacks)} 回/秒 · 更新間隔p95 ${number(report.intervalMs?.p95)} ms`;
}

export function benchmarkReady({streamReady=false,rootTilesReady=false,drawTiles=0,lost=false,running=false}={}){
 return !!streamReady&&!!rootTilesReady&&Number.isFinite(drawTiles)&&drawTiles>0&&!lost&&!running;
}

/** Keep full-run counts/maxima and a bounded, evenly spaced frame sample.
 * Never report the first 30k frames as if they represented a longer tour. */
export function recordBenchmarkFrame(b,intervalMs,cpuMs,{capacity=30000}={}){
 if(!Number.isSafeInteger(capacity)||capacity<4||capacity%2)throw new RangeError('Even frame sample capacity >=4 required');
 if(![intervalMs,cpuMs].every(v=>Number.isFinite(v)&&v>=0))throw new RangeError('Invalid frame timing');
 b.frames=(b.frames??0)+1;b.intervalMaxMs=Math.max(b.intervalMaxMs??0,intervalMs);b.cpuMaxMs=Math.max(b.cpuMaxMs??0,cpuMs);
 b.framesOver33ms=(b.framesOver33ms??0)+(intervalMs>1000/30?1:0);
 b.intervals??=[];b.cpu??=[];b.sampleStride??=1;
 if(b.intervals.length>=capacity){b.intervals=b.intervals.filter((_,i)=>i%2===1);b.cpu=b.cpu.filter((_,i)=>i%2===1);b.sampleStride*=2;}
 if(b.frames%b.sampleStride===0){b.intervals.push(intervalMs);b.cpu.push(cpuMs);}
}

/** A partial export never claims the requested duration was completed. */
export function benchmarkRunProgress({elapsedMs,requestedDurationMs,complete=false}){
 if(!Number.isFinite(elapsedMs)||elapsedMs<0||!Number.isFinite(requestedDurationMs)||requestedDurationMs<=0||typeof complete!=='boolean')throw new RangeError('Invalid benchmark progress');
 if(complete&&elapsedMs<requestedDurationMs)throw new RangeError('Benchmark cannot complete before its requested duration');
 return{runStatus:complete?'completed':'running-checkpoint',requestedDurationMs,completionFraction:Math.min(1,elapsedMs/requestedDurationMs)};
}

/** A p95 alone permits one in twenty frames to miss the constant-30fps gate. */
export function benchmarkFrameBudgetPass({rendererKind,actualDrawFPS,intervalMs,framesOver33ms,frames}={}){
 return rendererKind==='webgl2'&&Number.isFinite(actualDrawFPS)&&actualDrawFPS>=30&&Number.isSafeInteger(frames)&&frames>0
  &&framesOver33ms===0&&Number.isFinite(intervalMs?.max)&&intervalMs.max<=1000/30+1e-6;
}
