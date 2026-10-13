import { GLOBAL_TERRAIN_SCHEMA, createGlobalTerrain } from '../global-terrain.mjs';

export function globalInput({ bands = [], height = (x, y) => [3, 4].includes(x)
  ? 120 + 50 * y + 40 * Math.sin((x + 0.5) * Math.PI / 4) : -500 + 30 * x + 20 * y } = {}) {
  const w = 8, h = 4, landMask = Array.from({ length: w * h }, (_, i) => [3, 4].includes(i % w) ? 1 : 0);
  return { schema: GLOBAL_TERRAIN_SCHEMA, seed: 'global-fixture', revision: 'fixture@1',
    frame: { radiusM: 6371000, sourceVerticalDatum: 'fixture-zero', verticalDatum: 'fixture-zero', elevationOffsetM: 0 },
    grid: { columns: w, rows: h, macroColumns: 4, macroRows: 2 }, derivativeStepM: 1,
    fields: { groundElevationM: Array.from({ length: w * h }, (_, i) => height(i % w, Math.floor(i / w))), landMask,
      downstream: landMask.map((land, i) => land ? i - 1 : -1),
      lakeFillDepthM: landMask.map(land => land * 80), runoffIndex: landMask.map(land => land * 5) },
    detail: { bands }, references: { macroCellIds: Array.from({ length: 8 }, (_, i) => `cell-${i}`),
      features: [{ id: 'fixture-range', type: 'ridge', name: 'Fixture Ridge', cellIndices: [1, 2, 5, 6] }] } };
}
export function globalFixture(options) { return createGlobalTerrain(globalInput(options)); }
export const detailBands = [{ id: 'hills', wavelengthM: 20000, amplitudeM: 20 }, { id: 'relief', wavelengthM: 5000, amplitudeM: 4 }];
