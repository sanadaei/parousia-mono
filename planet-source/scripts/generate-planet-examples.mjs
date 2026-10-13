import fs from 'node:fs';
import {generatePlanetPackage} from './generate-planet.mjs';
const definitions=[
 {id:'generated',name:'標準世界',seed:'planet-1'},
 {id:'world-a',name:'別の地形 A',seed:'planet-a'},
 {id:'world-b',name:'別の地形 B',seed:'planet-b'},
 {id:'terminal',name:'低水位の終端湖',seed:'planet-terminal',lakeFillFraction:.6},
 {id:'below-sea-basin',name:'海面下の閉鎖流域',seed:'planet-1',lakeFillFraction:.6},
];
const worlds=[];
for(const {id,name,...input} of definitions){const result=generatePlanetPackage({...input,directory:`examples/planet/${id}`});worlds.push({id,name,input,worldId:result.worldId,manifest:`./${id}/manifest.json`});console.log(JSON.stringify(result));}
fs.writeFileSync('examples/planet/catalog.json',JSON.stringify({schema:'planet-example-catalog@1',worlds},null,2));
