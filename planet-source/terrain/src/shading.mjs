// Shared colouring: biome palette from height, temperature, precipitation,
// slope. Used by the 2D map tool and the browser preview.

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const DEEP = [12, 30, 70], MID = [20, 52, 100], SHELF = [38, 92, 130];
const SAND = [196, 172, 124], STEPPE = [160, 150, 100], GRASS = [104, 128, 66], FOREST = [46, 82, 40];
const RAIN = [30, 70, 34], TAIGA = [52, 72, 52], TUNDRA = [128, 122, 100], ROCK = [118, 106, 96], SNOW = [236, 240, 244];

/** Mean annual temperature (C) from latitude and elevation. */
export function temperatureC(latDeg, heightM) {
  const al = Math.abs(latDeg) * Math.PI / 180;
  return -18 + 46 * Math.cos(al) ** 1.4 - 6.5e-3 * Math.max(0, heightM);
}

export function oceanColor(depthM) {
  const d = -depthM;
  return d < 1500 ? mix(SHELF, MID, clamp01(d / 1500) ** 0.6) : mix(MID, DEEP, clamp01((d - 1500) / 4000));
}

/** slope as rise/run (true scale). precip ~0..2 factor. */
export function landColor(latDeg, heightM, precip, slope) {
  const T = temperatureC(latDeg, heightM);
  const wet = clamp01(precip / 1.1);
  let c;
  if (T > 18) c = wet < 0.25 ? mix(SAND, STEPPE, wet / 0.25) : wet < 0.55 ? mix(STEPPE, GRASS, (wet - 0.25) / 0.3) : mix(FOREST, RAIN, (wet - 0.55) / 0.45);
  else if (T > 5) c = wet < 0.25 ? mix(SAND, STEPPE, wet / 0.25) : wet < 0.5 ? mix(STEPPE, GRASS, (wet - 0.25) / 0.25) : mix(GRASS, FOREST, clamp01((wet - 0.5) / 0.3));
  else if (T > -1) c = mix(TUNDRA, TAIGA, clamp01(wet * 1.4) * clamp01((T + 1) / 3));
  else c = TUNDRA;
  c = mix(c, ROCK, clamp01((slope - 0.6) / 0.4)); // vegetation holds to ~30 deg
  const snow = clamp01((-T - 5) / 6) * (1 - clamp01((slope - 0.7) / 0.5));
  return mix(c, SNOW, snow);
}
