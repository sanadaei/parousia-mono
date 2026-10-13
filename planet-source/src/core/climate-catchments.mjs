import {hashJson} from './json-contract.mjs';

export const CLIMATE_CATCHMENTS_SCHEMA = 'climate-catchments@2';
const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

/** A bounded monthly soil-bucket scenario on an EXISTING drainage graph.
 * Heights and receivers are never edited. Routed yield is potential supply,
 * not observed discharge: lake evaporation/storage, glacier processes and travel time are
 * unresolved. In particular a terminal basin is never given a new outlet.
 */
export function deriveClimateCatchments({downstream, cellAreaM2, landMask,
  monthlyPrecipitationMm, monthlyTemperatureC}, {soilCapacityMm=120, spinupYears=4, meltMmPerDegreeDay=3}={}) {
  const n = downstream?.length;
  if (!Number.isSafeInteger(n) || n<1 || n>131072 ||
      !Number.isFinite(soilCapacityMm) || soilCapacityMm<0 || soilCapacityMm>2000 ||
      !Number.isFinite(meltMmPerDegreeDay) || meltMmPerDegreeDay<0 || meltMmPerDegreeDay>20 ||
      !Number.isSafeInteger(spinupYears) || spinupYears<0 || spinupYears>12)
    throw new RangeError('Invalid catchment budget');
  const check=(a, predicate)=>Array.isArray(a)&&a.length===n&&a.every(predicate);
  if (!check(downstream,(v)=>Number.isSafeInteger(v)&&v>=-1&&v<n) ||
      !check(cellAreaM2,v=>Number.isFinite(v)&&v>0&&v<=1e16) ||
      !check(landMask,v=>v===0||v===1)) throw new RangeError('Invalid catchment fields');
  for(const [months,predicate] of [[monthlyPrecipitationMm,v=>Number.isFinite(v)&&v>=0&&v<=100000],
    [monthlyTemperatureC,v=>Number.isFinite(v)&&v>=-150&&v<=100]])
    if(!Array.isArray(months)||months.length!==12||!months.every(a=>check(a,predicate)))
      throw new RangeError('Invalid monthly catchment forcing');
  const incoming=new Uint32Array(n), order=[];
  for(let i=0;i<n;i++)if(downstream[i]>=0)incoming[downstream[i]]++;
  for(let i=0;i<n;i++)if(!incoming[i])order.push(i);
  for(let k=0;k<order.length;k++){const j=downstream[order[k]];if(j>=0&&!--incoming[j])order.push(j);}
  if(order.length!==n)throw new RangeError('Cyclic catchment drainage');
  const soil=new Float64Array(n),snow=new Float64Array(n),meanSnowWaterMm=Array(n).fill(0), annualLocalYieldMm=Array(n).fill(0),
    meanSoilMoisture=Array(n).fill(0), monthlyRoutedYieldM3=[], monthlyLocalYieldMm=[];
  let precipitationM3=0,evaporationM3=0,initialStorageM3=0,finalStorageM3=0;
  // Same explicitly heuristic evaporative demand as the climate classifier.
  // It is not Penman-Monteith or an atmospheric energy balance.
  for(let year=0;year<=spinupYears;year++){
    if(year===spinupYears)initialStorageM3=soil.reduce((s,v,i)=>s+(v+snow[i])*.001*cellAreaM2[i],0);
    for(let month=0;month<12;month++){
      const local=Array(n).fill(0),volume=Array(n).fill(0);
      for(let i=0;i<n;i++){
        if(!landMask[i])continue;
        const precipitation=monthlyPrecipitationMm[month][i],temperature=monthlyTemperatureC[month][i];
        if(temperature<=0)snow[i]+=precipitation;
        const melt=Math.min(snow[i],Math.max(0,temperature)*meltMmPerDegreeDay*DAYS[month]);snow[i]-=melt;
        const rain=(temperature>0?precipitation:0)+melt,demand=temperature<=0?0:Math.max(5,(temperature+5)*2)*DAYS[month]/30;
        const available=soil[i]+rain,evap=Math.min(available,demand);
        local[i]=Math.max(0,available-evap-soilCapacityMm);
        soil[i]=Math.min(soilCapacityMm,available-evap);
        if(year===spinupYears){
          precipitationM3+=precipitation*.001*cellAreaM2[i];evaporationM3+=evap*.001*cellAreaM2[i];
          annualLocalYieldMm[i]+=local[i];meanSoilMoisture[i]+=(soilCapacityMm?soil[i]/soilCapacityMm:0)/12;
          meanSnowWaterMm[i]+=snow[i]/12;volume[i]=local[i]*.001*cellAreaM2[i];
        }
      }
      if(year===spinupYears){
        for(const i of order){const j=downstream[i];if(j>=0)volume[j]+=volume[i];}
        monthlyLocalYieldMm.push(local);monthlyRoutedYieldM3.push(volume);
      }
    }
  }
  finalStorageM3=soil.reduce((s,v,i)=>s+(v+snow[i])*.001*cellAreaM2[i],0);
  const annualRoutedYieldM3=Array.from({length:n},(_,i)=>monthlyRoutedYieldM3.reduce((s,m)=>s+m[i],0));
  const exportedOrTerminalM3=annualRoutedYieldM3.reduce((s,v,i)=>s+(downstream[i]<0?v:0),0);
  // A read-only drainage reference for maps and later boundary contracts.
  // Stop catchment identity at the first non-land receiver; do not merge river
  // mouths merely because an ocean cell has another coarse-grid receiver.
  const terminalCell=Array(n),upstreamLandAreaM2=cellAreaM2.map((v,i)=>landMask[i]?v:0);
  for(let k=order.length-1;k>=0;k--){const i=order[k],j=downstream[i];terminalCell[i]=!landMask[i]||j<0?i:terminalCell[j];}
  for(const i of order){const j=downstream[i];if(landMask[i]&&j>=0)upstreamLandAreaM2[j]+=upstreamLandAreaM2[i];}
  const drainage={schema:'coarse-drainage-reference@1',terminalCell,upstreamLandAreaM2,
    terminalKind:terminalCell.map(i=>landMask[i]?'inland-terminal':'non-land-receiver'),
    interpretation:'Existing coarse drainage; not surveyed local river geometry or a flood boundary'};
  const content={schema:CLIMATE_CATCHMENTS_SCHEMA,
    inputId:hashJson({downstream,cellAreaM2,landMask,monthlyPrecipitationMm,monthlyTemperatureC}),
    profile:{soilCapacityMm,spinupYears,meltMmPerDegreeDay,snow:'monthly-zero-degree-partition-and-temperature-index-melt@1',evaporation:'climate-temperature-demand-proxy@1'},
    annualLocalYieldMm,meanSoilMoisture,meanSnowWaterMm,annualRoutedYieldM3,drainage,
    meanPotentialFlowM3PerSecond:annualRoutedYieldM3.map(v=>v/(365*86400)),
    yieldMonths:annualRoutedYieldM3.map((v,i)=>monthlyRoutedYieldM3.filter(m=>m[i]>Math.max(1e-9,v*1e-6)).length),
    diagnostics:{precipitationM3,evaporationM3,initialStorageM3,finalStorageM3,exportedOrTerminalM3,
      balanceErrorM3:precipitationM3+initialStorageM3-evaporationM3-finalStorageM3-exportedOrTerminalM3,
      storageChangeM3:finalStorageM3-initialStorageM3,
      scope:'Scenario water availability, not calibrated discharge or flood prediction',
      missing:['snow-energy-balance-and-glaciers','groundwater-delay','lake-water-balance','channel-losses','routing-travel-time']}};
  return {...content,id:hashJson(content)};
}
