import fs from 'node:fs';
import {createL0ResolutionSeries} from './l0-resolution-series.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
const [input,output,levelsArg='3']=process.argv.slice(2);if(!output)throw Error('Usage: plan-macro-water.mjs L0.json OUTPUT.json [LEVELS]');
const {snapshot}=JSON.parse(fs.readFileSync(input,'utf8'));
const result=createL0ResolutionSeries(snapshot,{levels:Number(levelsArg),beforeLevel:()=>requireVerificationMemory()});
fs.writeFileSync(output,JSON.stringify(result));
console.log(JSON.stringify(result.cases.map(({columns,rows,parentId,id,measurement})=>({columns,rows,parentId,id,measurement}))));
