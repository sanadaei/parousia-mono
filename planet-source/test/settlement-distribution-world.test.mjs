import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePlanet} from '../src/core/planet-generation.mjs';
import {snapshotPlanetWorld, restorePlanetWorld} from '../src/core/planet-world.mjs';
import {validateSettlementDistribution} from '../src/core/settlement-distribution.mjs';
import {copyJson, hashJson} from '../src/core/json-contract.mjs';

const world = generatePlanet({seed:'settlement-budget-world',columns:16,rows:8,
  macroProfile:'earthlike-l0@1',climatePlanning:true,settlementCount:0});

test('production L0 generation saves a worldwide census without constructing settlements',()=>{
  const d=world.settlementDistribution;
  assert.equal(world.settlements.length,0);
  assert.equal(d.layer,'L0');
  assert.equal(d.status,'distribution-only');
  assert.equal(d.populationId,world.population.id);
  assert.equal(d.totals.population,world.population.totals.supportedPopulation);
  assert.ok(d.totals.populatedCells>1);
  const saved=snapshotPlanetWorld(world), restored=restorePlanetWorld(JSON.stringify(saved));
  validateSettlementDistribution(saved.settlementDistribution);
  assert.deepEqual(restored.settlementDistribution,copyJson(d));
  assert.deepEqual(snapshotPlanetWorld(restored),saved);
});

test('distribution identity survives the canonical key ordering used by world saves',()=>{
  const reordered=copyJson(world.settlementDistribution);
  assert.notDeepEqual(Object.keys(reordered),Object.keys(world.settlementDistribution));
  assert.equal(validateSettlementDistribution(reordered).id,world.settlementDistribution.id);
});

test('an explicitly broken distribution cannot be silently omitted while saving',()=>{
  assert.throws(()=>snapshotPlanetWorld({...world,settlementDistribution:null}),/Settlement distribution required/);
});

test('a freshly rehashed world still rejects a distribution contradicting its census',()=>{
  const saved=snapshotPlanetWorld(world), d=saved.settlementDistribution;
  const i=d.fields.ruralPopulation.findIndex(n=>n>0);
  assert.ok(i>=0);
  d.fields.population[i]++;d.fields.ruralPopulation[i]++;
  d.totals.population++;d.totals.ruralPopulation++;
  d.summary.supportedPopulation++;d.summary.requestedPopulation++;
  const {id,...distributionContent}=d;
  d.id=hashJson(copyJson(distributionContent));
  validateSettlementDistribution(d);
  const {worldId,...worldContent}=saved;
  saved.worldId=hashJson(worldContent);
  assert.throws(()=>restorePlanetWorld(saved),/does not match its population authority/);
});
