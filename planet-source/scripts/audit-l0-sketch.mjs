import fs from 'node:fs';
import {createPlanetLandscapeSketch,inspectSketchSupport} from '../src/core/planet-landscape-sketch.mjs';
const [input,output,cellArg,widthArg,heightArg]=process.argv.slice(2);if(!input||!output)throw Error('Usage: audit-l0-sketch.mjs L0.json OUTPUT.json [CELL WIDTH_M HEIGHT_M]');
const {snapshot,climate}=JSON.parse(fs.readFileSync(input,'utf8')),sketch=createPlanetLandscapeSketch(snapshot,climate),support=cellArg===undefined?null:inspectSketchSupport(sketch,snapshot,{cell:Number(cellArg),localWidthM:Number(widthArg),localHeightM:Number(heightArg)});
fs.writeFileSync(output,JSON.stringify({sketch,support}));console.log(JSON.stringify({diagnostics:sketch.diagnostics,support}));
