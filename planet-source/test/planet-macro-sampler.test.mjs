import test from 'node:test';import assert from 'node:assert/strict';
import {createPlanetMacroTerrain,createPlanetMacroSampler} from '../src/core/planet-macro.mjs';
test('frozen macro sampler exactly reproduces original nonpolar source points',()=>{
 const columns=32,rows=16,radiusM=6371000,seaLevelM=17;
 const {recipe,elevation}=createPlanetMacroTerrain({seed:'frozen-plan',columns,rows,radiusM,seaLevelM});
 const sample=createPlanetMacroSampler(recipe,{radiusM,seaLevelM});
 for(let i=columns;i<columns*(rows-1);i++)assert.equal(sample({latDeg:90-(Math.floor(i/columns)+.5)*180/rows,lonDeg:(i%columns+.5)*360/columns}),elevation[i]);
});
test('macro planning queries are read-only, seam-consistent, and reject unsupported recipes',()=>{
 const radiusM=6371000,{recipe}=createPlanetMacroTerrain({seed:'frozen-plan',columns:32,rows:16,radiusM}),before=JSON.stringify(recipe),sample=createPlanetMacroSampler(recipe,{radiusM});
 const a=sample({latDeg:23,lonDeg:7});for(let i=0;i<100;i++)sample({latDeg:i-50,lonDeg:i});assert.equal(sample({latDeg:23,lonDeg:7}),a);assert.equal(JSON.stringify(recipe),before);
 assert.ok(Math.abs(sample({latDeg:23,lonDeg:0})-sample({latDeg:23,lonDeg:360}))<1e-8);
 assert.throws(()=>sample({latDeg:100,lonDeg:0}));assert.throws(()=>createPlanetMacroSampler({...recipe,schema:'unknown'},{radiusM}));
});
