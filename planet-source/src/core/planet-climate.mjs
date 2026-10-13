import {deriveClimateCatchments} from './climate-catchments.mjs';
import {hashJson} from './json-contract.mjs';
export const CLIMATE_SCHEMA='planet-climate@1';
export const BIOMES=Object.freeze({ocean:['海','#24547c'],lake:['湖','#3b83a5'],ice:['極寒・裸地','#e1e8e9'],tundra:['ツンドラ','#acb69b'],boreal:['寒帯林','#426a56'],temperate_forest:['温帯林','#477b43'],tropical_forest:['熱帯湿潤林','#1d6744'],savanna:['熱帯季節林・サバンナ','#9ca558'],grassland:['草原','#a9af70'],shrubland:['乾燥低木地','#baa775'],desert:['砂漠','#d5bd8a'],mediterranean:['地中海性低木地','#98966a']});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),round=v=>Math.round(v*100)/100||0;
const DAYS=[31,28,31,30,31,30,31,31,30,31,30,31];
export function classifyBiome(temperatures,precipitation,{ocean=false,lake=false}={}){
 if(ocean)return'ocean';if(lake)return'lake';
 const lo=Math.min(...temperatures),hi=Math.max(...temperatures),mean=temperatures.reduce((s,v,i)=>s+v*DAYS[i]/365,0),rain=precipitation.reduce((a,b)=>a+b,0),pet=temperatures.reduce((s,t,i)=>s+Math.max(5,(t+5)*2)*DAYS[i]/30,0),aridity=rain/Math.max(1,pet);
 if(hi<0)return'ice';if(hi<10)return'tundra';if(aridity<.2)return'desert';if(aridity<.5)return'shrubland';
 if(lo>=18)return precipitation.filter(v=>v<60).length>=3?'savanna':'tropical_forest';
 if(aridity<.9)return'grassland';if(mean<7&&lo<0)return'boreal';
 const warm=temperatures.map((t,i)=>t>mean?i:-1).filter(i=>i>=0),cool=temperatures.map((t,i)=>t<=mean?i:-1).filter(i=>i>=0);
 if(warm.filter(i=>precipitation[i]<30).length>=2&&cool.some(i=>precipitation[i]>60))return'mediterranean';return'temperate_forest';
}
export function generateClimate(snapshot,{iterations=64,axialTiltDeg=23.44,lapseCPerKm=6.5,model=snapshot.references.macroRecipe?.climateModel??'earthlike-heuristic@1',temperatureOffsetC=snapshot.references.climateForcing?.temperatureOffsetC??0,precipitationScale=snapshot.references.climateForcing?.precipitationScale??1}={}){
 const {columns:w,rows:h}=snapshot.grid,n=w*h,radius=snapshot.frame.radiusM,ground=snapshot.fields.groundElevationM,land=snapshot.fields.landMask,sea=snapshot.references.sea?.levelElevationM??0;
 if(n>32768||n<32||!Number.isSafeInteger(iterations)||iterations<1||iterations>128||!Number.isFinite(axialTiltDeg)||axialTiltDeg<0||axialTiltDeg>35||!Number.isFinite(lapseCPerKm)||lapseCPerKm<0||lapseCPerKm>10||ground.length!==n||land.length!==n||!ground.every(Number.isFinite))throw new RangeError('Invalid bounded climate input');
 if(!['earthlike-heuristic@1','earthlike-zonal@2'].includes(model))throw new RangeError('Unknown climate model');
 if(!Number.isFinite(temperatureOffsetC)||temperatureOffsetC< -40||temperatureOffsetC>30||!Number.isFinite(precipitationScale)||precipitationScale<0||precipitationScale>4)throw new RangeError('Climate forcing outside bounded scenario range');
 const modern=model==='earthlike-zonal@2';
 const profile={id:model,...(temperatureOffsetC!==0||precipitationScale!==1?{temperatureOffsetC,precipitationScale,forcingInterpretation:'prescribed climate-normal offset and rainfall scale; not stellar forcing or climate feedback simulation'}:{}),iterations,axialTiltDeg,lapseCPerKm,equatorBaselineC:28,polarCoolingC:modern?52:58,precipitationUnits:'model-scaled-mm; not calibrated observations'};
 const lat=Array.from({length:h},(_,y)=>(90-(y+.5)*180/h)*Math.PI/180);
 // Coast-step distance only controls continentality; it is not a measured km field.
 const steps=new Int32Array(n).fill(n),queue=[];for(let i=0;i<n;i++)if(!land[i]){steps[i]=0;queue.push(i);}
 if(!queue.length)throw new RangeError('Earthlike climate requires an ocean');
 for(let k=0;k<queue.length;k++){const i=queue[k],x=i%w,y=Math.floor(i/w);for(const j of[y*w+(x+w-1)%w,y*w+(x+1)%w,...(y?[i-w]:[]),...(y<h-1?[i+w]:[])])if(steps[j]>steps[i]+1){steps[j]=steps[i]+1;queue.push(j);}}
 const continentality=Array.from(steps,(d,i)=>clamp(d*(2*Math.PI*radius/w)*Math.max(.15,Math.cos(lat[Math.floor(i/w)]))/1500000,0,1));
 const area=Array.from({length:n},(_,i)=>{const y=Math.floor(i/w);return 2*Math.PI/w*radius*radius*(Math.sin((90-y*180/h)*Math.PI/180)-Math.sin((90-(y+1)*180/h)*Math.PI/180));});
 const monthlyTemperatureC=[],monthlyPrecipitationMm=[];let maxMoistureChange=0;
 for(let month=0;month<12;month++){
  const summer=Math.cos(2*Math.PI*(month-6)/12),t=ground.map((z,i)=>{const y=Math.floor(i/w),phi=lat[y],amplitude=(4+22*continentality[i])*Math.sin(phi)*axialTiltDeg/23.44;return round(28+temperatureOffsetC-(modern?52*Math.abs(Math.sin(phi))**3:58*Math.abs(Math.sin(phi))**1.4)-lapseCPerKm*Math.max(0,z-sea)/1000+amplitude*summer);});
  let moisture=Float64Array.from(land,v=>v?.25:1),lastChange=0;
  // Jacobi transport uses previous-pass values, with periodic longitude.
  for(let pass=0;pass<iterations;pass++){
   const next=new Float64Array(n);lastChange=0;
   for(let i=0;i<n;i++){if(!land[i]){next[i]=1;continue;}const y=Math.floor(i/w),x=i%w,a=Math.abs(lat[y]*180/Math.PI),eastWeight=(Math.tanh((a-30)/6)-Math.tanh((a-60)/6))/2,left=y*w+(x+w-1)%w,right=y*w+(x+1)%w;
    const mix=eastWeight*moisture[left]+(1-eastWeight)*moisture[right],rise=eastWeight*Math.max(0,ground[i]-ground[left])+(1-eastWeight)*Math.max(0,ground[i]-ground[right]),loss=clamp(.04+rise/5000,.04,.7);
    next[i]=clamp(.15*moisture[i]+.85*mix*(1-loss),0,1);lastChange=Math.max(lastChange,Math.abs(next[i]-moisture[i]));
   }moisture=next;
  }maxMoistureChange=Math.max(maxMoistureChange,lastChange);
  const p=ground.map((z,i)=>{const y=Math.floor(i/w),x=i%w,latitude=lat[y]*180/Math.PI,shift=6*summer*axialTiltDeg/23.44,a=Math.abs(latitude-shift),belt=(25+150*Math.exp(-((a/17)**2))+65*Math.exp(-(((a-52)/15)**2)))*(modern?1-.82*Math.exp(-(((a-28)/9)**2)):1),left=y*w+(x+w-1)%w,right=y*w+(x+1)%w,eastWeight=(Math.tanh((a-30)/6)-Math.tanh((a-60)/6))/2,rise=eastWeight*Math.max(0,z-ground[left])+(1-eastWeight)*Math.max(0,z-ground[right]),lift=clamp(rise/1000,0,3),cold=clamp((t[i]+30)/40,.12,1);
   return round(Math.max(0,precipitationScale*belt*(.12+.88*moisture[i])*(1+lift)*cold*DAYS[month]/30));});
  monthlyTemperatureC.push(t);monthlyPrecipitationMm.push(p);
 }
 const annualMeanTemperatureC=ground.map((_,i)=>round(monthlyTemperatureC.reduce((s,t,m)=>s+t[i]*DAYS[m]/365,0))),annualPrecipitationMm=ground.map((_,i)=>round(monthlyPrecipitationMm.reduce((s,p)=>s+p[i],0))),biome=ground.map((_,i)=>classifyBiome(monthlyTemperatureC.map(t=>t[i]),monthlyPrecipitationMm.map(p=>p[i]),{ocean:!land[i],lake:(snapshot.fields.lakeFillDepthM?.[i]??0)>0}));
 const warnings=[],waterCells=new Set((snapshot.references.lakes??[]).flatMap(l=>l.cells));for(const r of snapshot.references.rivers?.profiles??[])for(const p of r.points){const y=clamp(Math.floor((90-p.latDeg)/180*h),0,h-1),x=((Math.floor(p.lonDeg/360*w)%w)+w)%w;waterCells.add(y*w+x);}
 for(const i of waterCells)if(land[i]&&annualPrecipitationMm[i]<250)warnings.push({cellIndex:i,kind:'dry-climate-existing-water',annualPrecipitationMm:annualPrecipitationMm[i],interpretation:'Potential mismatch only; upstream imports can sustain dry-region rivers. No discharge balance evaluated.'});
 const content={schema:CLIMATE_SCHEMA,sourceWorldId:snapshot.worldId,profile,grid:{columns:w,rows:h},cellAreaM2:area,continentalityIndex:continentality,monthlyTemperatureC,monthlyPrecipitationMm,annualMeanTemperatureC,annualPrecipitationMm,biome,diagnostics:{maxFinalMoistureChange:round(maxMoistureChange),waterConsistencyWarnings:warnings,scope:'Heuristic climate normals, not weather or a mass-conserving atmosphere',missing:['meridional-moisture-transport','ocean-currents','monsoon-dynamics','soil','agricultural-yield','population-capacity','physical-water-balance','subgrid-biome-mixtures']}};
 if(snapshot.fields.downstream)content.catchmentWater=deriveClimateCatchments({downstream:snapshot.fields.downstream,cellAreaM2:area,landMask:land,monthlyPrecipitationMm,monthlyTemperatureC});
 return{...content,id:hashJson(content)};
}
