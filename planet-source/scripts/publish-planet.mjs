import {createTerritoryScenario} from '../src/core/territory-scenario.mjs';
import {packageSettlements} from './package-settlements.mjs';
import {createHash} from '../src/core/sha256.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {packageGlobe} from './package-globe.mjs';
import {snapshotPlanetWorld} from '../src/core/planet-world.mjs';
import {hashJson} from '../src/core/json-contract.mjs';
/** Publish a self-contained immutable generation first, then atomically switch
 * the small entry manifest. Already-open viewers keep their original pages. */
export function publishPlanet(world,directory,metadata={}){
 const versions=path.join(directory,'worlds');
 fs.mkdirSync(versions,{recursive:true});const stage=fs.mkdtempSync(path.join(versions,'.building-'));
 const atomic=(name,text)=>{const temp=path.join(directory,`.${name}.${process.pid}.tmp`);try{fs.writeFileSync(temp,text);fs.renameSync(temp,path.join(directory,name));}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
 try{
  const settlementCatalogue=packageSettlements(world,stage,{deferred:metadata.deferredPopulation===true,waterFirst:metadata.deferredWater===true,unpopulatedWater:metadata.unpopulatedWater===true});
  const snapshot=snapshotPlanetWorld({...world,...(settlementCatalogue?{settlementCatalogue}:{})});
  const manifest=packageGlobe(world.base,stage,{recipes:world.recipes,focus:world.focus,name:metadata.name,canonicalWorldId:snapshot.worldId});
  for(const key of ['name','startingSettlement','settlements','bridges','waterBodies','landformInspection','generationDiagnostics','settlementNetwork','populationSummary'])if(metadata[key]!=null)manifest[key]=metadata[key];
  if(world.landscape)manifest.landscape=world.landscape;
  if(world.climate){const text=JSON.stringify(world.climate);fs.writeFileSync(path.join(stage,'climate.json'),text);manifest.climate={id:world.climate.id,path:'climate.json',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),method:world.climate.profile.id};}
  if(world.population){const text=JSON.stringify(world.population);fs.writeFileSync(path.join(stage,'population.json'),text);manifest.population={id:world.population.id,path:'population.json',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};}
  if(world.climate&&world.population){const territories=createTerritoryScenario(world.climate,world.population,{radiusM:world.base.frame.radiusM}),text=JSON.stringify(territories);fs.writeFileSync(path.join(stage,'territories.json'),text);manifest.territories={id:territories.id,path:'territories.json',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),method:territories.method};}
  if(settlementCatalogue)manifest.settlementCatalogue=settlementCatalogue;
  manifest.planetSnapshot='./world.snapshot.json';
  const id=hashJson(manifest).replace(/^sha256:/,''),destination=path.join(versions,id);
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest));fs.writeFileSync(path.join(stage,'world.snapshot.json'),JSON.stringify(snapshot));
  if(fs.existsSync(destination)){
   const equal=(a,b)=>{const names=fs.readdirSync(a);if(!fs.existsSync(b)||JSON.stringify(names)!==JSON.stringify(fs.readdirSync(b)))return false;
    return names.every(name=>{const x=path.join(a,name),y=path.join(b,name);return fs.statSync(x).isDirectory()?fs.statSync(y).isDirectory()&&equal(x,y):fs.statSync(y).isFile()&&fs.readFileSync(x).equals(fs.readFileSync(y));});};
   if(!equal(stage,destination))throw new Error('Existing immutable generation differs; refusing to overwrite it');
  }else fs.renameSync(stage,destination);
  const prefix=`worlds/${id}/`,entry=structuredClone(manifest);
  for(const p of Object.values(entry.pages))p.path=prefix+p.path;
  for(const d of entry.featureCharts??(entry.features?[entry.features]:[]))d.path=prefix+d.path;
  if(entry.settlementCatalogue)for(const region of entry.settlementCatalogue.regions)if(region.path)region.path=prefix+region.path;
  if(entry.population)entry.population.path=prefix+entry.population.path;
  if(entry.climate)entry.climate.path=prefix+entry.climate.path;
  if(entry.territories)entry.territories.path=prefix+entry.territories.path;
  entry.planetSnapshot=prefix+'world.snapshot.json';entry.generationManifest=prefix+'manifest.json';
  // Compatibility path is replaced in one rename. New navigation always uses
  // the immutable snapshot from the entry manifest, so two-file atomicity is
  // not required to keep an already-open world's pages consistent.
  atomic('world.snapshot.json',JSON.stringify(snapshot));atomic('manifest.json',JSON.stringify(entry));
  return entry;
 }finally{if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}
