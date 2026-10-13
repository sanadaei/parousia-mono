import {makeShapeFirstPlanetManifest,createShapeFirstPlanetRegion} from './shape-first-planet.mjs';
import {createShapeFirstCandidateChannels} from '../core/shape-first-channels.mjs';
import {sampleShapeHeight} from './shape-first-model.mjs';
import {chooseShapeFirstOutletReceiver,designShapeFirstOutletRoute} from '../core/shape-first-outlet-connection.mjs';
/** Resolve and verify a bounded receiving river before publishing the draft. */
export async function prepareShapeFirstPlanetPlacement(base,model,source,requested={}){
 const options={...requested},explicitOffset=options.elevationOffsetM!==undefined,channels=createShapeFirstCandidateChannels(model.candidate,model.water,{nativeTerrain:model.nativeTerrain}),point={latDeg:options.latDeg??base.focus.latDeg,lonDeg:options.lonDeg??base.focus.lonDeg};
 if(!explicitOffset)options.elevationOffsetM=Math.max(await source.ready(()=>source.base.groundElevationAt(point.latDeg,point.lonDeg))-sampleShapeHeight(model.candidate,model.extent.widthM/2,model.extent.heightM/2),(base.sea?.levelElevationM??0)+30-channels.elevationRangeM[0]);
 const preliminary=makeShapeFirstPlanetManifest(base,model,options),region=createShapeFirstPlanetRegion(preliminary.shapeFirstRegion),root=channels.rivers.find(r=>r.parent===null);
 if(!root)throw new Error('Selected region has no explicit outlet river');
 const a=root.points[0],b=root.points[1],outlet={...a,direction:{xM:a.xM-b.xM,yM:a.yM-b.yM}},receiver=chooseShapeFirstOutletReceiver(base.rivers,{local:region.local,extent:region.extent,outlet,transitionM:region.transitionM});
 if(!receiver){preliminary.shapeFirstRegion.outletStatus='unconnected-no-verified-receiver-within-30km';return preliminary;}
 const sampled=await source.ready(()=>source.sampleWithoutCover(receiver.latDeg,receiver.lonDeg));
 if(!(sampled.waterDepthM>0)||!sampled.waterSourceIds?.includes(receiver.id))throw new Error('選んだ流出口の接続先に、保存河川の水面を確認できません');
 Object.assign(receiver,{verifiedWet:true,waterLevelM:sampled.waterLevelElevationM,depthM:sampled.waterDepthM});
 const route=designShapeFirstOutletRoute(outlet,receiver),minimumOffset=receiver.waterLevelM+.001*route.lengthM-root.waterLevelM[0];
 if(explicitOffset&&options.elevationOffsetM<minimumOffset-1e-6)throw new Error(`指定標高では流出口が接続先より低くなります。sfElevationを${minimumOffset.toFixed(6)} m以上にするか、指定を外して自動配置してください。`);
 options.elevationOffsetM=Math.max(options.elevationOffsetM,minimumOffset);
 options.outletConnection={schema:'shape-first-outlet-connection@1',outlet:{...outlet,waterLevelM:root.waterLevelM[0]+options.elevationOffsetM,depthM:root.depthM[0],widthM:root.widthM[0]},receiver};
 const manifest=makeShapeFirstPlanetManifest(base,model,options);manifest.shapeFirstRegion.outletStatus='connected-to-verified-saved-river';return manifest;
}
