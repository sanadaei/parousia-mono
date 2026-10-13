/** Provisional accounting fitted AFTER river shape. No terrain/routing mutation. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const check=(ok,text)=>{if(!ok)throw new Error(text);};
import {fitRiverWater} from '../../../src/core/shape-first-water.mjs';
export {fitRiverWater} from '../../../src/core/shape-first-water.mjs';
export function renderWaterPreview(candidate, annotation) {
  const g=candidate.grid,width=(g.columns-1)*g.cellSizeM,height=(g.rows-1)*g.cellSizeYM,scale=900/width;
  const lo=Math.min(...candidate.elevation),hi=Math.max(...candidate.elevation);
  let content='';
  for(let row=0;row<g.rows-1;row++)for(let col=0;col<g.columns-1;col++){
    const z=candidate.elevation[row*g.columns+col], t=(z-lo)/(hi-lo||1);
    content+=`<rect x="${col*g.cellSizeM*scale}" y="${row*g.cellSizeYM*scale}" width="${g.cellSizeM*scale+0.1}" height="${g.cellSizeYM*scale+0.1}" fill="hsl(${95-55*t} 18% ${88-35*t}%)"/>`;
  }
  candidate.rivers.forEach((r,ri)=>{for(let i=0;i<r.length-1;i++)content+=`<path d="M ${r[i].xM*scale} ${r[i].yM*scale} L ${r[i+1].xM*scale} ${r[i+1].yM*scale}" stroke="#136caa" stroke-width="${annotation.rivers[ri].segmentLineWeightPx[i]}" stroke-linecap="round"/>`;});
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height*scale+120}" viewBox="0 0 960 ${height*scale+120}"><rect width="100%" height="100%" fill="#f7f5ef"/><g font-family="sans-serif" fill="#253340"><text x="30" y="27" font-size="19">Shape first · synthetic water annotation</text><text x="30" y="49" font-size="13">Nearest-path supply assignment; not a validated watershed or hydraulic result</text></g><g transform="translate(30 65)">${content}</g><text x="30" y="${height*scale+91}" font-family="sans-serif" font-size="13">Line weights show relative conceptual mean flow; original terrain and river geometry unchanged</text></svg>`;
}
async function main(){
  const [candidatePath,terrainPath,scenarioPath,outPath,...extra]=process.argv.slice(2);
  check(candidatePath&&terrainPath&&scenarioPath&&outPath&&!extra.length,'Usage: node fit-river-water.mjs candidate.json terrain.json scenario.json output-directory');
  const paths=[candidatePath,terrainPath,scenarioPath].map(p=>resolve(p));
  const out=resolve(outPath), outputs=['water-annotation.json','water-preview.svg'].map(n=>join(out,n));
  check(!outputs.some(p=>paths.includes(p)),'Output would overwrite input');
  const [candidate,terrain,scenario]=await Promise.all(paths.map(async p=>JSON.parse(await readFile(p,'utf8'))));
  const result=fitRiverWater(candidate,terrain,scenario);await mkdir(out,{recursive:true});
  await writeFile(outputs[0],JSON.stringify(result,null,2)+'\n');await writeFile(outputs[1],renderWaterPreview(candidate,result));
  console.log(JSON.stringify({accounting:result.accounting,preservation:result.preservation},null,2));
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
