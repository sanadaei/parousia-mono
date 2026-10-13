#!/usr/bin/env node
/** Reproducible actual production CPU renderer, not a browser/WebGL screenshot. */
import fs from 'node:fs';
import {createTriangularPatchView,buildTriangularPatchMesh} from '../../src/globe/triangular-patch.mjs';
import {SoftwareRenderer} from '../../src/globe/software-renderer.mjs';
import {createOrbitCamera} from '../../src/globe/view-state.mjs';
import {sphereBasis} from '../../src/core/spherical.mjs';
const [input,configFile,output,reportFile]=process.argv.slice(2);
if(!reportFile)throw new Error('Usage: render-triangular-scene.mjs TERRAIN_JSON VIEW_JSON NEW_PPM NEW_REPORT_JSON');
for(const f of [output,reportFile])if(fs.existsSync(f))throw new Error('Output exists');
if(fs.statSync(input).size>16*1024*1024||fs.statSync(configFile).size>65536)throw new RangeError('Input exceeds bounded size');
const saved=JSON.parse(fs.readFileSync(input)),config=JSON.parse(fs.readFileSync(configFile)),view=createTriangularPatchView(saved,config);
if(config.expectedSourceWorldId&&config.expectedSourceWorldId!==view.sourceWorldId)throw new Error('Diagnostic view belongs to a different source terrain');
const mesh=buildTriangularPatchMesh(view,config.window),width=1100,height=700;let pixels;
const canvas={clientWidth:width,clientHeight:height,width,height,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData:p=>{pixels=p;}})};
const renderer=new SoftwareRenderer(canvas,{pixelScale:1,maxDimension:1200}),tile=renderer.upload(mesh);
const cx=(config.window.minXM+config.window.maxXM)/2,cy=(config.window.minYM+config.window.maxYM)/2,point=view.toGeographic(cx,cy),ground=view.terrain.groundElevationAt(cx,cy),basis=sphereBasis(point);
const state={point,ground,altitude:config.altitudeM??2000,tilt:(config.tiltDeg??50)*Math.PI/180,heading:(config.headingDeg??0)*Math.PI/180};
if(![state.altitude,state.tilt,state.heading].every(Number.isFinite)||state.altitude<3||state.altitude>100000||state.tilt<0||state.tilt>70*Math.PI/180)throw new RangeError('Invalid diagnostic camera');
const camera=createOrbitCamera(state,{radiusM:view.radiusM,heightScale:1,aspect:width/height});camera.radiusM=view.radiusM;
camera.sun=basis.up.map((v,i)=>.86*v+.3*basis.east[i]+.41*basis.north[i]);const length=Math.hypot(...camera.sun);camera.sun=camera.sun.map(v=>v/length);
const draw=renderer.draw(camera,[{tile,morph:1,stitchMask:0}],performance.now()),rgb=Buffer.alloc(pixels.width*pixels.height*3);
for(let i=0,j=0;i<pixels.data.length;i+=4,j+=3){rgb[j]=pixels.data[i];rgb[j+1]=pixels.data[i+1];rgb[j+2]=pixels.data[i+2];}
fs.writeFileSync(output,Buffer.concat([Buffer.from(`P6\n${pixels.width} ${pixels.height}\n255\n`),rgb]),{flag:'wx'});
const report={sourceWorldId:view.sourceWorldId,viewId:view.viewId,config,draw,mesh:mesh.diagnostics,
 renderer:'Existing src/globe/software-renderer.mjs and view-state camera; not browser/WebGL acceptance',heightScale:1,water:'not modeled',planetAdoption:false};
fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});renderer.dispose(tile);renderer.destroy();console.log(report);
