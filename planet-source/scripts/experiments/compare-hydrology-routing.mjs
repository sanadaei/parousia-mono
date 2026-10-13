import fs from 'node:fs';
import {derivePlanetHydrology} from '../../src/core/planet-hydrology.mjs';
const [planetFile,earthFile,outFile]=process.argv.slice(2);
if(!outFile)throw Error('Usage: compare-hydrology-routing.mjs L0.json EARTH_GRID.json OUTPUT.json');
const planet=JSON.parse(fs.readFileSync(planetFile,'utf8')).snapshot,earth=JSON.parse(fs.readFileSync(earthFile,'utf8'));
const cases=[];
for(const [label,input] of [['Generated planet',{elevation:planet.fields.groundElevationM,...planet.grid}],['Earth ETOPO2022 point samples',earth]]){
 const {elevation,columns,rows}=input;
 for(const routingMode of ['flood-tree','steepest-filled']){
  const water=derivePlanetHydrology({elevation,columns,rows,lakeFillFraction:.2,routingMode});
  const incoming=Array(elevation.length).fill(0);let straight=0,chains=0;
  const step=(i,j)=>{let dx=j%columns-i%columns;if(dx>columns/2)dx-=columns;if(dx< -columns/2)dx+=columns;return `${dx},${Math.floor(j/columns)-Math.floor(i/columns)}`;};
  for(let i=0;i<elevation.length;i++){const j=water.downstream[i];if(j>=0&&!water.oceanCells[i]){incoming[j]++;const k=water.downstream[j];if(k>=0){chains++;if(step(i,j)===step(j,k))straight++;}}}
  cases.push({label,routingMode,columns,rows,elevation,water,metrics:{confluences:incoming.filter(v=>v>=2).length,straightTwoStepFraction:chains?straight/chains:null},limitations:['Eight-neighbour directions remain','No new subcell valleys','Point sampling is not cartographic river simplification','Single dataset; metrics are not naturalness scores']});
 }
}
fs.writeFileSync(outFile,JSON.stringify({cases,sources:{earth:'https://coastwatch.pfeg.noaa.gov/erddap/info/ETOPO_2022_v1_15s/index.html',gridBias:'https://doi.org/10.1029/96WR03137'},status:'controlled diagnostic; not adopted into saved worlds'}));
console.log(JSON.stringify(cases.map(({label,routingMode,metrics})=>({label,routingMode,metrics}))));
