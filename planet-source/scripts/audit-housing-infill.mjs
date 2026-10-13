import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const [beforeArg,afterArg,siteId='pop:3392:102']=process.argv.slice(2);
const fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
async function layout(file){const url=pathToFileURL(path.resolve(file)),m=JSON.parse(fs.readFileSync(url)),source=new PagedSource(m,url,fetcher),site=await source.settlementPages.getSite(siteId);assert.ok(site,'Site exists');return{m,site,recipe:await source.featureRecipe({procedural:true,site})};}
const before=await layout(beforeArg),after=await layout(afterArg),repeat=await layout(afterArg);
assert.deepEqual(after.recipe,repeat.recipe,'Fresh source reload must give identical layout');
const houses=r=>r.buildings.filter(b=>!b.facilityType),old=houses(before.recipe),now=houses(after.recipe);
for(const b of old)assert.deepEqual(now.find(n=>n.id===b.id),b,'Existing home must not move');
for(let i=0;i<after.recipe.buildings.length;i++)for(let j=i+1;j<after.recipe.buildings.length;j++){const a=after.recipe.buildings[i].bounds,b=after.recipe.buildings[j].bounds;assert.ok(a.maxXM<=b.minXM||b.maxXM<=a.minXM||a.maxYM<=b.minYM||b.maxYM<=a.minYM,'Buildings must not overlap');}
assert.equal(now.length,after.recipe.layoutStatus.requestedDwellings,'All requested homes in this representative village');
console.log(JSON.stringify({siteId,beforeWorld:before.m.canonicalWorldId,afterWorld:after.m.canonicalWorldId,before:before.recipe.layoutStatus,after:after.recipe.layoutStatus,existingHomesPreserved:old.length,reloadIdentical:true,noBuildingOverlap:true,scope:'Actual canonical PagedSource, including geographically selected neighboring settlements. One representative riverbank village, not a claim that every terrain can fit every requested dwelling.'},null,2));
