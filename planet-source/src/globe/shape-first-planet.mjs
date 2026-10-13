import {createShapeFirstOutletConnector} from '../core/shape-first-outlet-connection.mjs';
import {createShapeFirstCandidateChannels} from '../core/shape-first-channels.mjs';
/** Explicit draft-only geographic placement of a shape-first field on the sphere.
 * The native field is authoritative inside its rectangle. A separate exterior
 * collar blends to the saved planet; it is not a global watershed solution. */
import {createSphericalProjection,sphereBasis,geographicPoint} from '../core/spherical.mjs';
import {sampleShapeHeight} from './shape-first-model.mjs';
import {createHash} from '../core/sha256.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function makeShapeFirstPlanetManifest(base,model,{latDeg=base.focus.latDeg,lonDeg=base.focus.lonDeg,transitionM=4000,elevationOffsetM=0,outletConnection=null}={}){
 const center=geographicPoint(latDeg,lonDeg),radiusM=base.base.frame.radiusM;
 if(!Number.isFinite(transitionM)||transitionM<100||transitionM>20000||!Number.isFinite(elevationOffsetM))throw new RangeError('Invalid draft placement');
 const {widthM,heightM}=model.extent,domainRadiusM=Math.hypot(widthM/2+transitionM,heightM/2+transitionM)+1,maxRadiusM=Math.min(radiusM*.1,100000);
 const projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM,maxRadiusM}).contract;
 const channels=createShapeFirstCandidateChannels(model.candidate,model.water,{nativeTerrain:model.nativeTerrain});
 const connector=outletConnection?createShapeFirstOutletConnector(outletConnection):null,outletIdentity=connector?createHash('sha256').update(JSON.stringify({spec:connector.spec,route:connector.route})).digest('hex'):'unconnected';
 const identity={outletIdentity,runtimeVersion:'shape-first-sphere@2',channelSchema:channels.schema,schema:'shape-first-planet-draft@1',sourceSha256:model.pyramid.provenance.sourceSha256,channelSourceSha256:createHash('sha256').update(JSON.stringify(model.nativeTerrain??null)).digest('hex'),waterAnnotationSha256:createHash('sha256').update(JSON.stringify(model.water)).digest('hex'),parentWorldId:base.worldId,projection,transitionM,elevationOffsetM,outletConnection};
 const id='sha256:'+createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 let slope=0;const g=model.candidate.grid,h=model.candidate.elevation;
 for(let y=0;y<g.rows-1;y++)for(let x=0;x<g.columns-1;x++){const i=y*g.columns+x;const dx=Math.max(Math.abs(h[i+1]-h[i]),Math.abs(h[i+g.columns+1]-h[i+g.columns]))/g.cellSizeM,dy=Math.max(Math.abs(h[i+g.columns]-h[i]),Math.abs(h[i+g.columns+1]-h[i+1]))/g.cellSizeYM;slope=Math.max(slope,Math.hypot(dx,dy));}
 const range=channels.elevationRangeM.map(z=>z+elevationOffsetM);if(connector){range[0]=Math.min(range[0],connector.elevationRangeM[0]);range[1]=Math.max(range[1],connector.elevationRangeM[1]);}const difference=Math.max(...range.flatMap(z=>base.elevationRangeM.map(b=>Math.abs(z-b))));
 const shapeFirstRegion={...identity,id,candidate:model.candidate,water:model.water,nativeTerrain:model.nativeTerrain,rivers:model.rivers,extent:model.extent,elevationRangeM:range,center:sphereBasis(center).up,angularRadius:Math.max(domainRadiusM,...(connector?.route.points.map(p=>Math.hypot(p.xM-widthM/2,p.yM-heightM/2)+Math.max(outletConnection.outlet.widthM,outletConnection.receiver.widthM))??[]))/radiusM,nativeSlopeBound:slope*1.001,transitionSlopeAllowance:slope*1.001+1.5*difference/transitionM*1.001};
 // New draft identity and empty local development layer avoid replaying saved
 // roads/buildings/water cuts against a deliberately replaced landform.
 return {...base,worldId:id,canonicalWorldId:id,name:`${model.sourceLabel??'形状優先 A'} · 球面ドラフト`,focus:center,shapeFirstRegion,
  elevationRangeM:[Math.min(base.elevationRangeM[0],range[0]),Math.max(base.elevationRangeM[1],range[1])],
  features:null,featureCharts:[],settlements:[],bridges:[],settlementCatalogue:null,settlementNetwork:null,landscape:null,landformInspection:null,population:null,climate:null,planetSnapshot:null,generationManifest:null};
}
export function createShapeFirstPlanetRegion(region){
 if(!region)return null;
 if(region.schema!=='shape-first-planet-draft@1')throw new TypeError('Unsupported geographic shape draft');
 const channels=createShapeFirstCandidateChannels(region.candidate,region.water,{nativeTerrain:region.nativeTerrain});
 if(region.channelSchema!==channels.schema)throw new Error('Saved channel design version differs from runtime');
 const connector=region.outletConnection?createShapeFirstOutletConnector(region.outletConnection):null;
 const projection=createSphericalProjection(region.projection),{widthM,heightM}=region.extent,g=region.candidate.grid;
 const local=(lat,lon)=>{const p=projection.toLocalIfWithin(lat,lon);return p?{xM:p.xM+widthM/2,yM:heightM/2-p.yM}:null;};
 const geographic=(x,y)=>projection.toGeographic(x-widthM/2,heightM/2-y);
 const weight=p=>{if(!p)return 0;const d=Math.hypot(Math.max(0,-p.xM,p.xM-widthM),Math.max(0,-p.yM,p.yM-heightM)),t=clamp(d/region.transitionM,0,1);return 1-t*t*(3-2*t);};
 const nativeHeight=p=>sampleShapeHeight(region.candidate,p.xM,p.yM)+region.elevationOffsetM;
 const surface=p=>{const s=channels.sample(p.xM,p.yM,nativeHeight(p)-region.elevationOffsetM);return{...s,groundElevationM:s.groundElevationM+region.elevationOffsetM,waterLevelM:s.waterLevelM==null?null:s.waterLevelM+region.elevationOffsetM};};
 const height=p=>surface(p).groundElevationM;
 const intersects=bound=>Math.acos(clamp(bound.center.reduce((s,v,i)=>s+v*region.center[i],0),-1,1))<=bound.angular+region.angularRadius+1e-8;
 function bounds(bound,legacy){
  if(!intersects(bound))return legacy;
  const c={latDeg:Math.asin(clamp(bound.center[2],-1,1))*180/Math.PI,lonDeg:Math.atan2(bound.center[1],bound.center[0])*180/Math.PI},p=local(c.latDeg,c.lonDeg),r=bound.angular*region.projection.radiusM*1.001;
  if(!p||r>Math.max(widthM,heightM)*2)return[Math.min(legacy[0],region.elevationRangeM[0]),Math.max(legacy[1],region.elevationRangeM[1])];
  let lo=Infinity,hi=-Infinity;
  const box={minXM:p.xM-r,minYM:p.yM-r,maxXM:p.xM+r,maxYM:p.yM+r},xs=[clamp(box.minXM,0,widthM),clamp(box.maxXM,0,widthM)],ys=[clamp(box.minYM,0,heightM),clamp(box.maxYM,0,heightM)];
  // Bilinear extrema occur at corners of clipped native cells. Include exact
  // query-box edges, rather than retaining a whole 55m cell at centimetre LOD.
  for(let x=Math.ceil(xs[0]/g.cellSizeM);x*g.cellSizeM<xs[1];x++)xs.push(x*g.cellSizeM);
  for(let y=Math.ceil(ys[0]/g.cellSizeYM);y*g.cellSizeYM<ys[1];y++)ys.push(y*g.cellSizeYM);
  for(const xM of xs)for(const yM of ys){const z=nativeHeight({xM,yM});lo=Math.min(lo,z);hi=Math.max(hi,z);}
  const range=channels.bounds?channels.bounds(box,[lo-region.elevationOffsetM,hi-region.elevationOffsetM]).map(z=>z+region.elevationOffsetM):region.elevationRangeM;
  const dx=Math.max(0,-box.maxXM,box.minXM-widthM),dy=Math.max(0,-box.maxYM,box.minYM-heightM),near={xM:dx?box.maxXM<0?-dx:widthM+dx:widthM/2,yM:dy?box.maxYM<0?-dy:heightM+dy:heightM/2};
  const weights=[weight(near),...[[box.minXM,box.minYM],[box.minXM,box.maxYM],[box.maxXM,box.minYM],[box.maxXM,box.maxYM]].map(([xM,yM])=>weight({xM,yM}))],minimum=Math.min(...weights),maximum=Math.max(...weights);
  const values=[];for(const a of range)for(const b of legacy)for(const w of [minimum,maximum])values.push(a*w+b*(1-w));
  const blended=[Math.min(...values),Math.max(...values)];return connector?connector.bounds(box,blended):blended;
 }
 return{...region,channels,connector,projection,local,geographic,weight,nativeHeight,surface,height,intersects,bounds};
}
