/** Compare a generated surface with a real ETOPO crop on the same metre grid.
 * This is a finite diagnostic, never a universal realism score. */
import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{restorePlanetWorld}from'../src/core/planet-world.mjs';import{offsetGeographic}from'../src/core/spherical.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';
export function parseElevationCSV(text){
 if(typeof text!=='string'||text.length>4000000)throw new RangeError('Bounded elevation CSV required');
 const lines=text.trim().split(/\r?\n/);if(lines[0]!=='latitude,longitude,z'||!lines[1]?.startsWith('degrees_north,degrees_east,'))throw new TypeError('Expected NOAA latitude,longitude,z CSV');
 const records=lines.slice(2).map(line=>line.split(',').map(v=>v.trim()===''?NaN:Number(v)));
 if(records.length<9||records.length>65536||records.some(r=>r.length!==3||!r.every(Number.isFinite)||Math.abs(r[0])>90||Math.abs(r[1])>180))throw new RangeError('Invalid elevation samples');
 const lat=[...new Set(records.map(r=>r[0]))],lon=[...new Set(records.map(r=>r[1]))];
 if(lat.length<3||lon.length<3||lat.length*lon.length!==records.length||lat.some((v,i)=>i&&v<=lat[i-1])||lon.some((v,i)=>i&&v<=lon[i-1]))throw new RangeError('Rectangular increasing latitude-major grid required');
 for(let i=0;i<records.length;i++)if(records[i][0]!==lat[Math.floor(i/lon.length)]||records[i][1]!==lon[i%lon.length])throw new RangeError('Duplicate or reordered grid samples');
 for(const axis of[lat,lon]){const d=axis[1]-axis[0];if(axis.some((v,i)=>i&&Math.abs(v-axis[i-1]-d)>1e-7))throw new RangeError('Uniform spacing required');}
 if(lat.at(-1)-lat[0]>2||lon.at(-1)-lon[0]>2||Math.abs((lat[0]+lat.at(-1))/2)>85)throw new RangeError('Use a nonpolar local crop no wider than 2 degrees');
 return{latitude:lat,longitude:lon,heights:records.map(r=>r[2]),rows:lat.length,columns:lon.length};
}
export function elevationGridStatistics(heights,columns,rows,dxM,dyM){
 if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<3||rows<3||columns*rows>65536||heights.length!==columns*rows||!heights.every(Number.isFinite)||![dxM,dyM].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('Finite bounded metric grid required');
 const slopes=[];for(let y=1;y<rows-1;y++)for(let x=1;x<columns-1;x++){const i=y*columns+x;slopes.push(Math.atan(Math.hypot((heights[i+1]-heights[i-1])/(2*dxM),(heights[i+columns]-heights[i-columns])/(2*dyM)))*180/Math.PI);}
 slopes.sort((a,b)=>a-b);const percentile=q=>slopes[Math.floor(q*(slopes.length-1))],thresholds=[5,15,30,45,60,90];
 const bins=thresholds.map((upperDeg,i)=>({upperDeg,count:slopes.filter(v=>v<=upperDeg&&(i===0||v>thresholds[i-1])).length}));
 return{elevationMinM:Math.min(...heights),elevationMaxM:Math.max(...heights),reliefM:Math.max(...heights)-Math.min(...heights),slopeSamples:slopes.length,slopeP50Deg:percentile(.5),slopeP95Deg:percentile(.95),slopeBins:bins};
}
export function compareEarthReference(world,earth,center){
 if(!center||!Number.isFinite(center.latDeg)||Math.abs(center.latDeg)>85||!Number.isFinite(center.lonDeg))throw new RangeError('Finite nonpolar generated center required');
 const lat0=(earth.latitude[0]+earth.latitude.at(-1))/2,lon0=(earth.longitude[0]+earth.longitude.at(-1))/2,R=6371000,deg=Math.PI/180,dxM=R*deg*(earth.longitude[1]-earth.longitude[0])*Math.cos(lat0*deg),dyM=R*deg*(earth.latitude[1]-earth.latitude[0]);
 const generated=[];for(let y=0;y<earth.rows;y++)for(let x=0;x<earth.columns;x++){const p=offsetGeographic(center,(x-(earth.columns-1)/2)*dxM,(y-(earth.rows-1)/2)*dyM,world.base.frame.radiusM);generated.push(world.base.groundElevationAt(p.latDeg,p.lonDeg));}
 return{worldId:world.worldId,earthCenter:{latDeg:lat0,lonDeg:lon0},generatedCenter:center,columns:earth.columns,rows:earth.rows,dxM,dyM,earth:elevationGridStatistics(earth.heights,earth.columns,earth.rows,dxM,dyM),generated:elevationGridStatistics(generated,earth.columns,earth.rows,dxM,dyM),scope:'Same local tangent metre grid and central differences for both crops. All finite heights, no land-only mask; Earth distances use a 6371km sphere and mean latitude. Finite selected windows, not global prevalence, matching formation history, or a realism score.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){requireVerificationMemory();const[w,csv,out,lat,lon]=process.argv.slice(2);if(!w||!csv||!out||lat===undefined||lon===undefined)throw Error('Usage: node compare-earth-reference.mjs WORLD.json ETOPO.csv REPORT.json LAT LON');const text=fs.readFileSync(csv,'utf8'),report=compareEarthReference(restorePlanetWorld(JSON.parse(fs.readFileSync(w))),parseElevationCSV(text),{latDeg:Number(lat),lonDeg:Number(lon)});report.earthInputSha256=createHash('sha256').update(text).digest('hex');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
