import {generatePlanet} from '../src/core/planet-generation.mjs';
import {publishPlanet} from './publish-planet.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const world=generatePlanet({seed:'planet-b',settlementCount:0,riverValleys:{maxIncisionM:600,sideRunPerRise:3}});
let deepest=null;for(const profile of world.base.toSnapshot().references.rivers.profiles)for(const p of profile.points)if(!deepest||p.bankWidthM>deepest.bankWidthM)deepest=p;
world.focus={latDeg:deepest.latDeg,lonDeg:deepest.lonDeg};
const manifest=publishPlanet(world,'examples/planet/valley-experiment',{name:'谷の掘削形状の試作 · planet-b',generationDiagnostics:world.diagnostics});
console.log(JSON.stringify({worldId:manifest.canonicalWorldId,focus:world.focus,sample:world.base.sampleAt(deepest.latDeg,deepest.lonDeg)}));
