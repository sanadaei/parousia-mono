import {createSphericalNoise} from './spherical-noise.mjs';
export const RIDGE_STRATA_SHAPE='resistance-masked-ridge-strata@1';
const smooth=t=>t*t*(3-2*t),clamp=t=>Math.max(0,Math.min(1,t));
/** Analytic, bounded landform candidate. This is a declared material/profile
 * scenario, not plate tectonics or a reproduction of an erosion simulation. */
export function terrainBandGradientMultiplier(band){
 if(band.shape===undefined)return 1;
 if(band.shape!==RIDGE_STRATA_SHAPE)throw new RangeError('Unknown terrain band shape');
 // Ridge derivative <=2, strata remap <=6, spatial mask <=3 times
 // an 8x longer wavelength; difference between the two profiles <=2.
 return 13;
}
export function createTerrainBandNoise(seed,radiusM,band){
 terrainBandGradientMultiplier(band);
 const noise=createSphericalNoise(seed,radiusM,band.wavelengthM);
 if(band.shape===undefined)return noise;
 const resistance=createSphericalNoise(seed+'/resistance',radiusM,band.wavelengthM*8),epsilon=.03,normalization=Math.sqrt(1+epsilon*epsilon);
 return direction=>{
  const n=noise(direction),ridge=1-2*Math.sqrt(n*n+epsilon*epsilon)/normalization;
  const h=(ridge+1)*2,layer=Math.floor(h),phase=h-layer,terrace=(layer+smooth(clamp((phase-.375)/.25)))/2-1;
  const mask=smooth(clamp((resistance(direction)+.15)/.5));
  return ridge+(terrace-ridge)*mask;
 };
}
