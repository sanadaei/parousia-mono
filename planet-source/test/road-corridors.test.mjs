import test from 'node:test';import assert from 'node:assert/strict';
import {inspectRoadCorridorClearance} from '../src/core/road-corridors.mjs';
const road=(id,y,z,kind='fill')=>({id,halfWidthM:3,structureKind:kind,points:[{xM:0,yM:y,roadElevationM:z},{xM:20,yM:y,roadElevationM:z}]});
test('full width finds parallel overlap without centerline intersection',()=>{
 const result=inspectRoadCorridorClearance([road('a',0,0),road('b',5,2,'bridge-deck')]);assert.equal(result.overlaps.length,1);assert.equal(result.overlaps[0].status,'clearance-conflict');assert.equal(result.overlaps[0].minimumClearanceM,1.5);
});
test('full deck clearance is certified for linear surfaces and thickness included',()=>{
 const result=inspectRoadCorridorClearance([road('a',0,0),road('b',5,5,'bridge-deck')]);assert.equal(result.overlaps[0].minimumClearanceM,4.5);assert.equal(result.overlaps[0].status,'clearance-certified');
});
test('straight swept envelope includes vehicle width; unrelated roads stay separate',()=>{
 const roads=[road('a',0,0),road('b',8,2,'bridge-deck')];assert.equal(inspectRoadCorridorClearance(roads).overlaps.length,0);
 assert.equal(inspectRoadCorridorClearance(roads,{vehicleWidthM:10}).overlaps[0].status,'clearance-conflict');
});
test('at-grade and nonlinear uncertainty are not falsely called safe bridges',()=>{
 assert.equal(inspectRoadCorridorClearance([road('a',0,0),road('b',5,0)]).overlaps[0].status,'at-grade-compatible');
 const b=road('b',5,5,'bridge-deck');b.points[0].gradeSlope=-1;b.points[1].gradeSlope=1;
 assert.notEqual(inspectRoadCorridorClearance([road('a',0,0),b]).overlaps[0].status,'clearance-certified');
 assert.throws(()=>inspectRoadCorridorClearance([road('a',0,0)],{vehicleWidthM:-1}));
});
