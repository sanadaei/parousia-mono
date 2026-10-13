import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSeededRiverRegion } from '../../../../src/core/seeded-river-region.mjs';
const out=resolve(process.argv[2]??'/tmp/seeded-river-regions');mkdirSync(out,{recursive:true});
const summaries=[];
for(const seed of [271828,314159,161803]){const start=performance.now(),candidate=generateSeededRiverRegion({seed});writeFileSync(`${out}/candidate-${seed}.json`,JSON.stringify(candidate));summaries.push({seed,extent:candidate.extent,riverCount:candidate.rivers.length,outlet:candidate.generator.outlet,elevationMinM:Math.min(...candidate.elevation),elevationMaxM:Math.max(...candidate.elevation),generationMs:Math.round(performance.now()-start)});}
writeFileSync(`${out}/summary.json`,JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));
