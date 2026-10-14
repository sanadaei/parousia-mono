// Shared "look" for every WebGL view (terrain preview, asset gallery): sky,
// sun colour, aerial perspective and tone mapping. GLSL ES 3.0 source chunk,
// world Z up, distances in metres, lighting in linear units (sun ~ 3).
//
// Atmosphere: single-scattering approximation of an exponential Rayleigh
// (H = 8 km) + Mie (H = 1.2 km) atmosphere. The same coefficients give the
// sky colour, the reddening of a low sun and the wavelength-dependent haze
// that turns distant ridges blue, so terrain and sky always agree.
//
// Uniforms expected: uSun (unit, towards the sun), uHaze (aerosol multiplier, 1 = clear day),
// uClouds (cumulus coverage 0..1).

export const LOOK = `
uniform vec3 uSun; uniform float uHaze;
const vec3 BR = vec3(5.8e-6, 13.5e-6, 33.1e-6); // Rayleigh scattering /m at sea level
const float BM = 4.0e-6, HR = 8000.0, HM = 1200.0, G = 0.76, SUN_I = 2.8;
float airmass(float mu) { // Kasten-Young, mu = cos(zenith); grazing rays stay finite
  float z = degrees(acos(clamp(mu, -0.08, 1.0)));
  return 1.0 / (max(mu, -0.08) + 0.15 * pow(max(93.885 - z, 0.5), -1.253));
}
vec3 bm() { return vec3(BM * uHaze); }
/** Sunlight reaching height h (m) after the slant path through the atmosphere. */
vec3 sunColor(float h) {
  float m = airmass(uSun.z);
  vec3 tau = (BR * HR * exp(-h / HR) + bm() * 1.1 * HM * exp(-h / HM)) * m;
  return SUN_I * exp(-tau) * smoothstep(-0.10, 0.02, uSun.z);
}
float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
float phaseM(float c) { float g2 = G * G; return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * G * c, 1.5); }
/** Light scattered toward the eye along a ray through optical depths (dR, dM) (scattering x length). */
vec3 inscatter(vec3 d, vec3 dR, vec3 dM, float h) {
  float c = dot(d, uSun);
  vec3 ext = dR + dM * 1.1, T = exp(-ext);
  vec3 sc = dR * phaseR(c) + dM * phaseM(c);
  vec3 s = sunColor(h) * sc / max(ext, vec3(1e-6)) * (1.0 - T);
  return s + sunColor(h) * (dR + dM) * 0.012; // multiple-scattering floor: shadows and dusk are not black
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { p = mod(p, 4096.0); vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
/** Fair-weather cumulus layer at ~2 km: returns colour (rgb) and cover (a) along view ray d from height h. */
const float CLOUD_H = 2000.0;
uniform float uClouds; // coverage 0..1 (0 = clear)
vec4 clouds(vec3 d, float h) {
  if (uClouds <= 0.0 || d.z < 0.01 || h > CLOUD_H) return vec4(0.0);
  float t = (CLOUD_H - h) / d.z; if (t > 80000.0) return vec4(0.0);
  vec2 p = d.xy * t / 2400.0;
  float f = vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 + vnoise(p * 4.1 + 3.3) * 0.15 + vnoise(p * 8.3 + 1.7) * 0.10;
  float a = smoothstep(1.0 - uClouds * 0.75, 1.15 - uClouds * 0.6, f) * (1.0 - smoothstep(30000.0, 80000.0, t));
  // lit tops toward the sun, grey bases; thicker (higher f) is darker underneath
  vec3 lit = sunColor(CLOUD_H) * (0.55 + 0.45 * max(dot(d, uSun), 0.0)) * 0.42 + vec3(0.10, 0.12, 0.16);
  vec3 col = mix(lit, lit * 0.55, smoothstep(0.6, 1.0, f));
  vec3 tr = exp(-(BR * HR + bm() * HM) * (t / 30000.0)); // distant clouds sink into the haze
  return vec4(col * tr, a);
}
/** Sky radiance seen from height h (m) in direction d; clouds optional (off for rough-water reflections). */
vec3 skyColor(vec3 d, float h, bool withClouds) {
  h = min(h, 3000.0); // seen from above the air, the sky is the lit limb, not black space
  float m = airmass(d.z);
  vec3 dR = BR * HR * exp(-h / HR) * m, dM = bm() * HM * exp(-h / HM) * m;
  vec3 c = inscatter(d, dR, dM, h);
  float s = dot(d, uSun);
  c += sunColor(h) * smoothstep(0.99996, 0.99999, s) * 12.0 * step(0.0, d.z + 0.02); // sun disc
  if (withClouds) { vec4 cl = clouds(d, h); c = mix(c, cl.rgb + c * 0.15, cl.a); }
  if (d.z < 0.0) c = mix(c, c * 0.35, smoothstep(0.0, -0.25, d.z)); // below the horizon: dim ground glow
  return c;
}
vec3 skyColor(vec3 d, float h) { return skyColor(d, h, true); }
vec3 skyColor(vec3 d) { return skyColor(d, 0.0, true); }
/** Aerial perspective between eye height he and point height hp over distance dist. Returns T; adds inscatter to c. */
vec3 aerial(inout vec3 c, vec3 d, float dist, float he, float hp) {
  float aR = abs(hp - he) > 1.0 ? HR * (exp(-he / HR) - exp(-hp / HR)) / (hp - he) : exp(-he / HR);
  float aM = abs(hp - he) > 1.0 ? HM * (exp(-he / HM) - exp(-hp / HM)) / (hp - he) : exp(-he / HM);
  vec3 dR = BR * max(aR, 0.0) * dist, dM = bm() * max(aM, 0.0) * dist;
  vec3 T = exp(-(dR + dM * 1.1));
  c = c * T + inscatter(d, dR, dM, min(he, hp));
  return T;
}
/** Hemispherical sky + ground bounce irradiance for a surface normal n (approximation). */
vec3 ambient(vec3 n, float h) {
  vec3 up = skyColor(normalize(vec3(0.0, 0.0, 1.0) + uSun * 0.3), h, false) * 4.0 + vec3(0.02, 0.025, 0.035) * SUN_I;
  vec3 ground = sunColor(h) * max(uSun.z, 0.0) * vec3(0.10, 0.09, 0.07);
  return mix(ground, up, n.z * 0.5 + 0.5);
}
/** ACES filmic (Narkowicz fit) and sRGB encode. */
vec3 present(vec3 c) {
  c *= 0.70;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  return pow(c, vec3(1.0 / 2.2));
}
`;
