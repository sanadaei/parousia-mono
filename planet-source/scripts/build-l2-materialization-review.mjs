/**
 * Saved L2 review renderer. No I/O, dependencies, data generation, or mutation.
 * Limits bound both the serialized document and work done by its browser UI.
 */
export function buildL2MaterializationReview(data) {
  const MAX_GRID_VALUES = 262144;
  const MAX_TOTAL_GRID_VALUES = 1048576;
  let gridValues = 0;
  let vertices = 0;
  const fail = (path, message) => {
    throw new TypeError('L2検査入力 ' + path + ': ' + message);
  };
  const object = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'オブジェクトが必要です');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(path, '通常のデータオブジェクトが必要です');
    return value;
  };
  const string = (value, path, max = 1024) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(path, '空でない文字列が必要です（最大' + max + '文字）');
    return value;
  };
  const number = (value, path, min = -1e9, max = 1e9) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, '範囲内の有限数が必要です');
    return value;
  };
  const integer = (value, path, min = 0, max = 1e9) => {
    number(value, path, min, max);
    if (!Number.isSafeInteger(value)) fail(path, '安全な整数が必要です');
    return value;
  };
  const array = (value, path, min = 0, max = 65536) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, '配列長は' + min + '〜' + max + 'である必要があります');
    return value;
  };
  const equal = (a, b, path) => {
    if (a !== b) fail(path, '関連する保存値と一致しません');
  };
  const near = (a, b, path) => {
    if (Math.abs(a - b) > Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-9)) fail(path, '関連する保存値と整合しません');
  };
  const member = (value, values, path) => {
    if (!values.includes(value)) fail(path, '対応していない値です');
    return value;
  };
  const strings = (value, path) => array(value, path, 0, 128).map((v, i) => string(v, path + '[' + i + ']', 2000));
  const optionalString = (value, path) => value == null ? null : string(value, path, 2000);
  const geographic = (value, path) => {
    object(value, path);
    return {
      latDeg: number(value.latDeg, path + '.latDeg', -90, 90),
      lonDeg: number(value.lonDeg, path + '.lonDeg', -180, 180)
    };
  };
  const bounds = (value, path) => {
    object(value, path);
    const b = {};
    for (const k of ['minXM', 'maxXM', 'minYM', 'maxYM']) b[k] = number(value[k], path + '.' + k);
    if (b.minXM >= b.maxXM || b.minYM >= b.maxYM) fail(path, '面積のある境界が必要です');
    return b;
  };
  const sameBounds = (a, b, path) => {
    for (const k of ['minXM', 'maxXM', 'minYM', 'maxYM']) near(a[k], b[k], path + '.' + k);
  };
  const point = (value, path, pairAllowed = false) => {
    vertices += 1;
    if (vertices > 524288) fail(path, '全体の座標数が上限を超えました');
    if (pairAllowed && Array.isArray(value)) {
      array(value, path, 2, 2);
      return { xM: number(value[0], path + '[0]'), yM: number(value[1], path + '[1]') };
    }
    object(value, path);
    return { xM: number(value.xM, path + '.xM'), yM: number(value.yM, path + '.yM') };
  };
  const inSurface = (p, surface, path) => {
    const epsilon = 1e-4;
    if (Math.abs(p.xM) > surface.widthM / 2 + epsilon || Math.abs(p.yM) > surface.heightM / 2 + epsilon) fail(path, '候補原点を中心とした地形範囲を外れています');
  };
  const boundsInSurface = (b, surface, path) => {
    inSurface({ xM: b.minXM, yM: b.minYM }, surface, path);
    inSurface({ xM: b.maxXM, yM: b.maxYM }, surface, path);
  };
  const target = (value, path) => {
    if (value == null) return null;
    const geo = geographic(value, path);
    return {
      ...geo,
      id: string(value.id, path + '.id'),
      kind: member(value.kind, ['local-boundary-portal'], path + '.kind'),
      provenance: optionalString(value.provenance, path + '.provenance')
    };
  };
  const profiles = (value, path, surface = null) => array(value, path, 0, 2048).map((profile, i) => {
    const p = path + '[' + i + ']';
    object(profile, p);
    let lastDistance = -1;
    const samples = array(profile.samples, p + '.samples', 2, 65536).map((sample, j) => {
      const q = p + '.samples[' + j + ']';
      const xy = point(sample, q);
      if (surface) inSurface(xy, surface, q);
      const distanceM = number(sample.distanceM, q + '.distanceM', 0, 1e9);
      if (distanceM <= lastDistance) fail(q + '.distanceM', '距離は単調増加する必要があります');
      lastDistance = distanceM;
      return {
        ...xy, distanceM,
        roadElevationM: number(sample.roadElevationM, q + '.roadElevationM'),
        segmentKind: optionalString(sample.segmentKind, q + '.segmentKind'),
        structureKind: optionalString(sample.structureKind, q + '.structureKind')
      };
    });
    return {
      roadId: string(profile.roadId, p + '.roadId'),
      halfWidthM: number(profile.halfWidthM, p + '.halfWidthM', 0.01, 1000),
      samples
    };
  });
  const root = object(data, '$');
  equal(root.schema, 'l2-native-layout-review@1', '$.schema');
  equal(root.platform, 'PC', '$.platform');
  const examples = array(root.examples, '$.examples', 1, 8).map((example, index) => {
    const p = '$.examples[' + index + ']';
    object(example, p);
    const label = string(example.label, p + '.label', 160);
    const cellIndex = integer(example.cellIndex, p + '.cellIndex');
    const c = object(example.candidate, p + '.candidate');
    const candidate = {
      ...geographic(c, p + '.candidate'),
      id: string(c.id, p + '.candidate.id'),
      kind: member(c.kind, ['city', 'town', 'village', 'hamlet'], p + '.candidate.kind'),
      population: integer(c.population, p + '.candidate.population', 1)
    };
    const s = object(example.surface, p + '.surface');
    const g = object(s.grid, p + '.surface.grid');
    const grid = {
      columns: integer(g.columns, p + '.surface.grid.columns', 2, 2049),
      rows: integer(g.rows, p + '.surface.grid.rows', 2, 2049),
      cellSizeM: number(g.cellSizeM, p + '.surface.grid.cellSizeM', 0.01, 1e6),
      cellSizeYM: number(g.cellSizeYM, p + '.surface.grid.cellSizeYM', 0.01, 1e6),
      row0: member(g.row0, ['north'], p + '.surface.grid.row0'),
      yDirection: member(g.yDirection, ['south'], p + '.surface.grid.yDirection')
    };
    const count = grid.columns * grid.rows;
    gridValues += count;
    if (count > MAX_GRID_VALUES || gridValues > MAX_TOTAL_GRID_VALUES) fail(p + '.surface.grid', '表示格子の値数が上限を超えました');
    const surface = {
      id: string(s.id, p + '.surface.id'),
      grid,
      widthM: number(s.widthM, p + '.surface.widthM', 0.01, 1e7),
      heightM: number(s.heightM, p + '.surface.heightM', 0.01, 1e7),
      elevationM: array(s.elevationM, p + '.surface.elevationM', count, count).map((v, i) => number(v, p + '.surface.elevationM[' + i + ']')),
      waterDepthM: array(s.waterDepthM, p + '.surface.waterDepthM', count, count).map((v, i) => number(v, p + '.surface.waterDepthM[' + i + ']', 0, 1e6))
    };
    near(surface.widthM, (grid.columns - 1) * grid.cellSizeM, p + '.surface.widthM');
    near(surface.heightM, (grid.rows - 1) * grid.cellSizeYM, p + '.surface.heightM');
    const spacing = object(s.nativeSpacingM, p + '.surface.nativeSpacingM');
    surface.nativeSpacingM = {
      east: number(spacing.east, p + '.surface.nativeSpacingM.east', 0.01, 1e6),
      north: number(spacing.north, p + '.surface.nativeSpacingM.north', 0.01, 1e6)
    };
    near(surface.nativeSpacingM.east, grid.cellSizeM, p + '.surface.nativeSpacingM.east');
    near(surface.nativeSpacingM.north, grid.cellSizeYM, p + '.surface.nativeSpacingM.north');
    surface.rivers = array(s.rivers, p + '.surface.rivers', 0, 2048).map((river, i) => {
      const q = p + '.surface.rivers[' + i + ']';
      object(river, q);
      const points = array(river.points, q + '.points', 2, 65536).map((v, j) => {
        const xy = point(v, q + '.points[' + j + ']');
        inSurface(xy, surface, q + '.points[' + j + ']');
        return xy;
      });
      const widths = array(river.widthM, q + '.widthM', points.length - 1, points.length).map((v, j) => number(v, q + '.widthM[' + j + ']', 0.01, 10000));
      return { id: string(river.id, q + '.id'), points, widthM: widths };
    });
    const provenance = object(s.provenance, p + '.surface.provenance');
    surface.provenance = {};
    for (const key of ['generator', 'method', 'parentSurfaceId', 'placement', 'scope', 'seed', 'water']) {
      surface.provenance[key] = optionalString(provenance[key], p + '.surface.provenance.' + key);
    }
    const r = object(example.result, p + '.result');
    equal(r.schema, 'l2-settlement-materialization@1', p + '.result.schema');
    equal(r.candidateId, candidate.id, p + '.result.candidateId');
    equal(r.surfaceId, surface.id, p + '.result.surfaceId');
    equal(r.cellIndex, cellIndex, p + '.result.cellIndex');
    equal(r.kind, candidate.kind, p + '.result.kind');
    const status = member(r.status, ['held', 'materialized'], p + '.result.status');
    const origin = geographic(r.origin, p + '.result.origin');
    near(origin.latDeg, candidate.latDeg, p + '.result.origin.latDeg');
    near(origin.lonDeg, candidate.lonDeg, p + '.result.origin.lonDeg');
    const districtCount = integer(r.districtCount, p + '.result.districtCount', 1, 1e6);
    const districtIndex = integer(r.districtIndex, p + '.result.districtIndex', 0, districtCount - 1);
    const slot = integer(r.slot, p + '.result.slot', 0, 1e6);
    const h = object(r.housing, p + '.result.housing');
    const housing = {};
    for (const key of ['placedDwellings', 'representedPopulation', 'requestedDwellings', 'requestedPopulation', 'totalPopulation', 'unresolvedPopulation', 'unvisitedPopulation', 'districtCount', 'districtIndex']) {
      housing[key] = integer(h[key], p + '.result.housing.' + key);
    }
    equal(housing.districtCount, districtCount, p + '.result.housing.districtCount');
    equal(housing.districtIndex, districtIndex, p + '.result.housing.districtIndex');
    equal(housing.totalPopulation, candidate.population, p + '.result.housing.totalPopulation');
    equal(housing.representedPopulation + housing.unresolvedPopulation, housing.requestedPopulation, p + '.result.housing.requestedPopulation');
    equal(housing.requestedPopulation + housing.unvisitedPopulation, housing.totalPopulation, p + '.result.housing.totalPopulation');
    if (housing.requestedPopulation < 1 || housing.requestedDwellings < 1 || housing.placedDwellings > housing.requestedDwellings || housing.requestedDwellings > housing.requestedPopulation) fail(p + '.result.housing', '住宅要求または配置戸数が人口予算に収まりません');
    if ((housing.placedDwellings === 0) !== (housing.representedPopulation === 0)) fail(p + '.result.housing', '住宅戸数と配置人口が整合しません');
    const f = object(r.fields, p + '.result.fields');
    const fields = {
      status: member(f.status, ['local-field-page', 'regional-supply-unresolved'], p + '.result.fields.status'),
      limit: integer(f.limit, p + '.result.fields.limit', 1, 16),
      offset: integer(f.offset, p + '.result.fields.offset', 0, 1e6),
      totalPlots: integer(f.totalPlots, p + '.result.fields.totalPlots', 0, 1e6)
    };
    for (const key of ['totalDemandM2', 'requestedM2', 'surveyedM2', 'unresolvedM2', 'outsidePageM2']) fields[key] = number(f[key], p + '.result.fields.' + key, 0, 1e15);
    near(fields.surveyedM2 + fields.unresolvedM2, fields.requestedM2, p + '.result.fields.requestedM2');
    near(fields.requestedM2 + fields.outsidePageM2, fields.totalDemandM2, p + '.result.fields.totalDemandM2');
    if (fields.offset > fields.totalPlots) fail(p + '.result.fields.offset', '区画総数を超えています');
    const plotIds = new Set();
    const parsePlots = (items, accepted) => array(items, p + '.result.fields.' + (accepted ? 'accepted' : 'rejected'), 0, fields.limit).map((plot, i) => {
      const q = p + '.result.fields.' + (accepted ? 'accepted' : 'rejected') + '[' + i + ']';
      object(plot, q);
      const id = string(plot.id, q + '.id');
      if (plotIds.has(id)) fail(q + '.id', '農地区画IDが重複しています');
      plotIds.add(id);
      const b = bounds(plot.bounds, q + '.bounds');
      boundsInSurface(b, surface, q + '.bounds');
      const points = array(plot.points, q + '.points', 3, 512).map((v, j) => point(v, q + '.points[' + j + ']', true));
      const actual = { minXM: Infinity, maxXM: -Infinity, minYM: Infinity, maxYM: -Infinity };
      let twiceArea = 0;
      const anchor = points[0];
      for (let j = 0; j < points.length; j += 1) {
        const a = points[j];
        const next = points[(j + 1) % points.length];
        actual.minXM = Math.min(actual.minXM, a.xM);
        actual.maxXM = Math.max(actual.maxXM, a.xM);
        actual.minYM = Math.min(actual.minYM, a.yM);
        actual.maxYM = Math.max(actual.maxYM, a.yM);
        twiceArea += (a.xM - anchor.xM) * (next.yM - anchor.yM) - (next.xM - anchor.xM) * (a.yM - anchor.yM);
      }
      sameBounds(actual, b, q + '.bounds');
      const areaM2 = number(plot.areaM2, q + '.areaM2', 0.01, 1e15);
      near(Math.abs(twiceArea) / 2, areaM2, q + '.areaM2');
      return {
        id, bounds: b, points, areaM2,
        status: member(plot.status, [accepted ? 'surveyed-dry-footprint' : 'unresolved'], q + '.status'),
        reason: accepted ? null : string(plot.reason, q + '.reason', 2000)
      };
    });
    fields.accepted = parsePlots(f.accepted, true);
    fields.rejected = parsePlots(f.rejected, false);
    if (fields.accepted.length + fields.rejected.length > fields.limit) fail(p + '.result.fields', '今回の農地ページ上限を超えています');
    if (fields.accepted.length + fields.rejected.length > Math.max(0, fields.totalPlots - fields.offset)) fail(p + '.result.fields', '区画総数を超えています');
    near(fields.accepted.reduce((sum, v) => sum + v.areaM2, 0), fields.surveyedM2, p + '.result.fields.surveyedM2');
    const rejectedArea = fields.rejected.reduce((sum, v) => sum + v.areaM2, 0);
    if (rejectedArea > fields.unresolvedM2 + 1e-6) fail(p + '.result.fields.unresolvedM2', '保留輪郭の面積が保留予算を超えています');
    if (fields.status === 'regional-supply-unresolved' && (fields.requestedM2 !== 0 || plotIds.size !== 0)) fail(p + '.result.fields', '地域供給未解決の候補にローカル農地を追加できません');
    let layout = null;
    if (r.layout != null) {
      const l = object(r.layout, p + '.result.layout');
      const b = bounds(l.bounds, p + '.result.layout.bounds');
      boundsInSurface(b, surface, p + '.result.layout.bounds');
      const buildingIds = new Set();
      const color = (value, path) => array(value, path, 3, 3).map((v, i) => number(v, path + '[' + i + ']', 0, 1));
      const buildings = array(l.buildings, p + '.result.layout.buildings', 0, 4096).map((building, i) => {
        const q = p + '.result.layout.buildings[' + i + ']';
        object(building, q);
        const id = string(building.id, q + '.id');
        if (buildingIds.has(id)) fail(q + '.id', '建物IDが重複しています');
        buildingIds.add(id);
        const bb = bounds(building.bounds, q + '.bounds');
        boundsInSurface(bb, surface, q + '.bounds');
        return {
          id, bounds: bb,
          baseElevationM: number(building.baseElevationM, q + '.baseElevationM'),
          heightM: number(building.heightM, q + '.heightM', 0.01, 1000),
          roofHeightM: number(building.roofHeightM, q + '.roofHeightM', 0, 1000),
          roofColor: color(building.roofColor, q + '.roofColor'),
          wallColor: color(building.wallColor, q + '.wallColor'),
          residential: /\/house:\d+$/.test(id)
        };
      });
      equal(buildings.filter(v => v.residential).length, housing.placedDwellings, p + '.result.layout.buildings（住宅のみ）');
      const padIds = new Set();
      const buildingMap = new Map(buildings.map(v => [v.id, v]));
      const buildingPads = array(l.buildingPads, p + '.result.layout.buildingPads', 0, 4096).map((pad, i) => {
        const q = p + '.result.layout.buildingPads[' + i + ']';
        object(pad, q);
        const id = string(pad.id, q + '.id');
        if (padIds.has(id) || !buildingMap.has(id)) fail(q + '.id', '重複または対応する建物のない敷地です');
        padIds.add(id);
        const bb = bounds(pad.bounds, q + '.bounds');
        sameBounds(bb, buildingMap.get(id).bounds, q + '.bounds');
        return { id, bounds: bb, targetPadElevationM: number(pad.targetPadElevationM, q + '.targetPadElevationM') };
      });
      const ls = object(l.layoutStatus, p + '.result.layout.layoutStatus');
      for (const key of ['placedDwellings', 'representedPopulation', 'requestedDwellings', 'districtCount', 'districtIndex']) equal(ls[key], housing[key], p + '.result.layout.layoutStatus.' + key);
      if (typeof ls.complete !== 'boolean' || typeof ls.districtComplete !== 'boolean') fail(p + '.result.layout.layoutStatus', '完了フラグは真偽値である必要があります');
      layout = {
        bounds: b, buildings, buildingPads,
        roadCenterlineProfiles: profiles(l.roadCenterlineProfiles, p + '.result.layout.roadCenterlineProfiles', surface),
        layoutStatus: {
          complete: ls.complete, districtComplete: ls.districtComplete,
          placedDwellings: housing.placedDwellings,
          representedPopulation: housing.representedPopulation,
          requestedDwellings: housing.requestedDwellings,
          districtCount, districtIndex,
          limitations: strings(ls.limitations, p + '.result.layout.layoutStatus.limitations')
        },
        connections: array(l.connections, p + '.result.layout.connections', 0, 128).map((connection, i) => {
          const q = p + '.result.layout.connections[' + i + ']';
          object(connection, q);
          return {
            axis: member(connection.axis, ['x', 'y'], q + '.axis'),
            sign: member(connection.sign, [-1, 1], q + '.sign'),
            status: string(connection.status, q + '.status')
          };
        })
      };
    }
    if (status === 'materialized' && !layout) fail(p + '.result.layout', '詳細化済み候補には保存レイアウトが必要です');
    if (!layout && (housing.placedDwellings !== 0 || housing.representedPopulation !== 0)) fail(p + '.result.housing', 'レイアウトのない住宅配置は表示できません');
    if (status === 'held' && layout) fail(p + '.result.layout', '立地保留候補には住宅レイアウトを追加できません');
    const a = object(r.access, p + '.result.access');
    let recipe = null;
    if (a.recipe != null) {
      const rec = object(a.recipe, p + '.result.access.recipe');
      const projection = object(rec.projection, p + '.result.access.recipe.projection');
      recipe = {
        id: string(rec.id, p + '.result.access.recipe.id'),
        bounds: bounds(rec.bounds, p + '.result.access.recipe.bounds'),
        status: string(rec.status, p + '.result.access.recipe.status', 160),
        reason: optionalString(rec.reason, p + '.result.access.recipe.reason'),
        projection: {
          kind: member(projection.kind, ['spherical-azimuthal-equidistant@1'], p + '.result.access.recipe.projection.kind'),
          centerLatDeg: number(projection.centerLatDeg, p + '.result.access.recipe.projection.centerLatDeg', -90, 90),
          centerLonDeg: number(projection.centerLonDeg, p + '.result.access.recipe.projection.centerLonDeg', -180, 180),
          radiusM: number(projection.radiusM, p + '.result.access.recipe.projection.radiusM', 1, 1e9),
          maxRadiusM: number(projection.maxRadiusM, p + '.result.access.recipe.projection.maxRadiusM', 0.01, 1e9)
        },
        roadCenterlineProfiles: profiles(rec.roadCenterlineProfiles, p + '.result.access.recipe.roadCenterlineProfiles')
      };
    }
    const access = {
      status: string(a.status, p + '.result.access.status', 160),
      reason: optionalString(a.reason, p + '.result.access.reason'),
      receivingConnection: member(a.receivingConnection, ['unresolved'], p + '.result.access.receivingConnection'),
      target: target(a.target, p + '.result.access.target'),
      recipe
    };
    if (access.status === 'not-generated' && (recipe || access.target)) fail(p + '.result.access', '未生成状態と保存調査が整合しません');
    const options = object(r.options, p + '.result.options');
    equal(options.districtIndex, districtIndex, p + '.result.options.districtIndex');
    equal(options.slot, slot, p + '.result.options.slot');
    equal(options.fieldLimit, fields.limit, p + '.result.options.fieldLimit');
    equal(options.fieldOffset, fields.offset, p + '.result.options.fieldOffset');
    const accessTarget = target(options.accessTarget, p + '.result.options.accessTarget');
    if (access.target && accessTarget) equal(access.target.id, accessTarget.id, p + '.result.access.target.id');
    const accessPolyline = array(example.accessPolyline, p + '.accessPolyline', 0, 65536).map((v, i) => {
      const xy = point(v, p + '.accessPolyline[' + i + ']', true);
      inSurface(xy, surface, p + '.accessPolyline[' + i + ']');
      return xy;
    });
    if (accessPolyline.length === 1 || (accessPolyline.length > 0 && !recipe)) fail(p + '.accessPolyline', '調査レシピに対応する2点以上の変換済み座標が必要です');
    const reasons = strings(r.reasons, p + '.result.reasons');
    if (status === 'held' && reasons.length === 0) fail(p + '.result.reasons', '立地保留の理由が必要です');
    const result = {
      schema: r.schema, status, kind: candidate.kind,
      candidateId: candidate.id, surfaceId: surface.id, cellIndex,
      districtCount, districtIndex, slot, origin, housing, fields, layout, access, reasons,
      options: { districtIndex, fieldLimit: fields.limit, fieldOffset: fields.offset, slot, accessTarget },
      limitations: strings(r.limitations, p + '.result.limitations')
    };
    for (const key of ['detailKind', 'settlementClass', 'handoffId', 'populationId', 'sourceLayerId', 'worldId', 'interpretation']) result[key] = optionalString(r[key], p + '.result.' + key);
    return { label, cellIndex, candidate, surface, result, accessPolyline };
  });
  const ids = new Set();
  for (const example of examples) {
    if (ids.has(example.candidate.id)) fail('$.examples', '同じ候補が重複しています');
    ids.add(example.candidate.id);
  }
  // Serialize only owned, validated fields. Unknown input properties/toJSON are ignored.
  const serialized = JSON.stringify({ schema: root.schema, platform: root.platform, examples });
  if (serialized.length > 33554432) fail('$', 'HTMLに埋め込む保存データが32Mi文字を超えました');
  const escaped = serialized.replace(/[<>&\u2028\u2029]/g, ch => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029'
  })[ch]);
  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'none\'; font-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '<title>L2 接続診断 — 仮配置・景観として未採用</title>',
    '<style>', reviewStyles(), '</style></head><body>',
    '<header class="page-header"><div><p class="eyebrow">PLANET / L2 DIAGNOSTIC REVIEW</p><h1>L2 接続診断</h1><p class="subtitle">仮配置の予算・保留・保存を確認する。地形・村のリアリティは未受入</p></div><span class="saved-badge">PC用 · 景観として未採用</span></header>',
    '<main>',
    '<section class="candidate-bar" aria-labelledby="candidate-heading"><div><h2 id="candidate-heading">検査する候補</h2><label class="sr-only" for="candidate">候補を切り替える</label><select id="candidate"></select></div><div id="candidate-summary"></div></section>',
    '<p class="scope"><strong>住宅の直交配置と矩形農地は診断用の仮配置です。この配置をそのまま全球へ採用しません。</strong> 保存範囲：各固定候補の住宅一区画＋農地一ページ（最大16区画）。候補原点は変更していません。「今回の対象外」はこの保存に含めていない要求分で、累積の未生成量ではありません。</p>',
    '<div class="workspace"><section class="map-panel" aria-labelledby="map-heading">',
    '<div class="map-toolbar"><h2 id="map-heading">詳細地形と保存輪郭</h2><div class="view-buttons" role="group" aria-label="地図の視点"><button type="button" id="view-full">全景</button><button type="button" id="view-settlement">集落周辺</button><button type="button" id="view-fields">農地周辺</button></div></div>',
    '<div class="map-stage"><canvas id="map" tabindex="0" aria-label="L2詳細地形。矢印で移動、プラスとマイナスで拡大縮小、Homeで全景。対象をクリックすると一覧でも選択されます。" aria-describedby="map-help map-description"></canvas><div class="north" aria-hidden="true">↑<span>北 / N</span></div><div class="elevation-key"><span>表示標高</span><span class="ramp"></span><span id="elevation-range"></span></div><div class="scale-box" aria-hidden="true"><div id="scale-line"></div><span id="scale-label"></span></div></div>',
    '<div class="map-readout"><span id="coordinate">原点から東・北の距離を表示</span><span id="view-state"></span></div>',
    '<p class="map-help" id="map-help">ホイール：拡大縮小 · ドラッグ：移動 · 地図にフォーカスして矢印 / ＋ / − / Home。12mの住宅は「集落周辺」または一覧の選択で確認できます。</p>',
    '<p class="map-description" id="map-description"></p>',
    '<ul class="legend" aria-label="地図の凡例"><li><i class="legend-house"></i>住宅：茶色の矩形・屋根線</li><li><i class="legend-public"></i>公共施設：紫の矩形・菱形</li><li><i class="legend-pass"></i>農地通過：緑の点模様</li><li><i class="legend-held"></i>農地保留：橙の斜線・破線</li><li><i class="legend-road"></i>内部道路：白い設計線（集落内のみ）</li><li><i class="legend-access"></i>外部アクセス：紫の破線・調査点（隣接接続未確定）</li><li><i class="legend-water"></i>水面：青（保存格子・設計河川）</li><li><i class="legend-selected"></i>選択対象：水色の縁取り</li></ul>',
    '</section>',
    '<aside class="inspector" aria-labelledby="objects-heading"><div class="inspector-top"><h2 id="objects-heading">保存対象を選ぶ</h2><p id="object-counts"></p></div>',
    '<label for="object-filter">対象の種類</label><select id="object-filter"><option value="all">すべての住宅・施設・農地</option><option value="house">住宅</option><option value="public">公共施設</option><option value="accepted">農地：調査通過</option><option value="rejected">農地：保留</option></select>',
    '<label for="object-search">名前・区画番号・保留理由で絞り込み</label><input id="object-search" type="search" placeholder="例：住宅 03、農地、水域" autocomplete="off">',
    '<label for="object-select">対象一覧（選ぶと地図で拡大）</label><select id="object-select"></select><p id="filter-count" class="muted"></p>',
    '<div id="object-list" class="object-list" aria-label="対象の一覧"></div>',
    '<div class="selection-actions"><button type="button" id="focus-object">選択対象へ近づく</button><button type="button" id="reveal-object">選択を一覧に表示</button></div>',
    '<section class="selection-card" aria-labelledby="selection-heading"><h3 id="selection-heading">選択対象の詳細</h3><div id="selection-detail"></div></section><p id="selection-announcement" class="sr-only" role="status" aria-live="polite"></p>',
    '</aside></div>',
    '<div class="budgets"><section class="budget-panel" aria-labelledby="population-heading"><h2 id="population-heading">人口と住宅の予算</h2><p id="housing-status"></p><table><caption class="sr-only">候補の全人口と今回の住宅区画の配分</caption><thead><tr><th scope="col">範囲・状態</th><th scope="col">人数枠</th><th scope="col">住宅</th></tr></thead><tbody id="population-body"></tbody></table><p class="table-note">配置住宅の正本は保存された住宅戸数です。公共施設を住宅数へ加算しません。表示人数は統計上の需要と住宅容量の枠であり、住民個体の生成数を表していません。</p></section>',
    '<section class="budget-panel" aria-labelledby="fields-heading"><h2 id="fields-heading">農地の面積予算</h2><p id="fields-status"></p><table><caption class="sr-only">候補の農地全需要と今回の農地ページの配分</caption><thead><tr><th scope="col">範囲・状態</th><th scope="col">面積</th></tr></thead><tbody id="fields-body"></tbody></table><p class="table-note">「通過」は乾燥・勾配の標本調査を通った区画輪郭です。食料供給・土地の権利・年間収量・農道の確保は未完了です。</p></section></div>',
    '<section class="access-panel" aria-labelledby="access-heading"><h2 id="access-heading">道路と外部アクセス</h2><div id="access-summary"></div></section>',
    '<section class="limits-panel" aria-labelledby="limits-heading"><h2 id="limits-heading">この保存から確認できる範囲</h2><p>地形は局地生成例の保存表示格子です。細かい格子や補間だけで、谷・川岸・村の自然さを証明しません。河川は幅を持つ設計水面で、内外の河川連続性・洪水・飲料水は未検証です。地域端の調査点は隣接地域への接続を保証しません。</p><p>予算・保留・保存の接続を診断した段階です。街路・宅地・住宅・農地の形態は未受入で、全球ランタイムには未採用です。</p></section>',
    '<details class="technical"><summary>技術詳細：候補ID・surface ID・保存状態と座標系</summary><pre id="technical-data"></pre></details>',
    '<footer class="roadmap"><strong>現在：L0統計 → L1配分 → L2候補受け渡し。局地配置は接続診断まで</strong><p>次のロードマップ：地形と村のリアリティを比較・設計 → 複数地域で景観を確認 → 隣接地形・道路と全球画面へ統合</p></footer>',
    '</main><noscript>保存データの地図と一覧を表示するにはJavaScriptを有効にしてください。このHTMLはネットワーク接続を使いません。</noscript>',
    '<script type="application/json" id="review-data">', escaped, '</script>',
    '<script>(', initializeReview.toString(), ')();</script>',
    '</body></html>'
  ].join('\n');
}

function reviewStyles() {
  return [
    ':root{color-scheme:light;--ink:#172c31;--muted:#50646b;--border:#c7d4d5;--paper:#fff;--teal:#125b60;--focus:#005bda;--amber:#855015;font-family:system-ui,-apple-system,"Segoe UI","Yu Gothic UI",Meiryo,sans-serif;font-size:15px;line-height:1.6}',
    '*{box-sizing:border-box}body{margin:0;background:#eef2f1;color:var(--ink);min-width:1050px}button,input,select{font:inherit}button,select,input{border:1px solid #91a7ab;border-radius:6px;background:#fff;color:var(--ink)}button{cursor:pointer;padding:7px 13px;font-weight:600}button:hover:not(:disabled){background:#e7f1f0;border-color:#417c80}button:disabled,select:disabled{opacity:.55;cursor:default}button[aria-pressed="true"]{background:var(--teal);color:white;border-color:var(--teal)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}select{padding:8px 30px 8px 10px;max-width:100%;width:100%}input{padding:8px 10px;width:100%}',
    'h1,h2,h3,p{margin:0}h1{font-size:29px;letter-spacing:.03em;font-weight:750}h2{font-size:18px}h3{font-size:15px}.page-header{background:#153d43;color:#f5fbf9;padding:25px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}.eyebrow{font-size:11px;letter-spacing:.18em;color:#b6d8d3;margin-bottom:4px}.subtitle{color:#d5e5e2;margin-top:4px}.saved-badge{border:1px solid #6a999a;padding:7px 13px;border-radius:24px;font-size:13px;white-space:nowrap}main{padding:22px 28px 34px;max-width:1920px;margin:auto}',
    '.candidate-bar{background:var(--paper);border:1px solid var(--border);border-radius:10px;padding:16px 19px;display:grid;grid-template-columns:minmax(300px,400px) 1fr;gap:25px;align-items:center}.candidate-bar h2{margin-bottom:7px}#candidate-summary strong{font-size:19px}.candidate-meta{color:var(--muted);font-size:13px;margin-top:5px}.status-chip{display:inline-block;margin-right:9px;border-radius:4px;padding:3px 8px;font-size:13px;background:#e0efea;color:#195842;font-weight:700}.status-chip.held{background:#fff0d6;color:#855015}.scope{font-size:13px;color:#3e565d;margin:12px 2px 17px;max-width:1300px}',
    '.workspace{display:grid;grid-template-columns:minmax(625px,1fr) 345px;gap:18px;align-items:start}.map-panel,.inspector,.budget-panel,.access-panel,.limits-panel{background:var(--paper);border:1px solid var(--border);border-radius:10px;overflow:hidden}.map-toolbar{padding:12px 15px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}.view-buttons{display:flex;gap:6px}.view-buttons button{font-size:13px;padding:6px 10px}.map-stage{height:clamp(600px,68vh,880px);position:relative;background:#d7e0dc;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}canvas{display:block;width:100%;height:100%;cursor:grab}canvas.dragging{cursor:grabbing}canvas:focus-visible{outline:4px solid var(--focus);outline-offset:-5px}.north{position:absolute;top:16px;right:17px;pointer-events:none;text-align:center;color:#163139;text-shadow:0 1px 3px #fff;font-size:30px;line-height:1.1}.north span{display:block;font-size:11px;font-weight:800;margin-top:4px}.elevation-key,.scale-box{position:absolute;pointer-events:none;background:#fffffff0;border:1px solid #bdcccb;border-radius:5px;font-size:11px;color:#25424a}.elevation-key{left:12px;bottom:12px;padding:7px 9px;display:grid;gap:4px;min-width:175px}.ramp{display:block;height:9px;background:linear-gradient(90deg,#849984,#b7b68b,#e9dfbf)}.scale-box{right:12px;bottom:12px;padding:8px 10px;text-align:center}#scale-line{border:solid #26434b;border-width:0 2px 2px;height:7px;min-width:15px}',
    '.map-readout{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:8px 13px;background:#f5f8f7;font-size:12px;font-variant-numeric:tabular-nums;color:#35515a}.map-help,.map-description{padding:9px 14px 0;font-size:12px;color:var(--muted)}.legend{list-style:none;padding:12px 14px;margin:0;display:flex;flex-wrap:wrap;gap:8px 17px;font-size:12px}.legend li{display:flex;align-items:center;gap:7px}.legend i{display:inline-block;width:18px;height:13px;border:2px solid;flex-shrink:0}.legend-house{background:#b96d3e;border-color:#663b25!important;background-image:linear-gradient(90deg,transparent 45%,#5f3627 45%,#5f3627 55%,transparent 55%)}.legend-public{background:#ceb2eb;border-color:#633784!important;transform:rotate(-10deg)}.legend-pass{background-color:#d1e8af;background-image:radial-gradient(#387336 1px,transparent 1px);background-size:5px 5px;border-color:#347a3b!important}.legend-held{border:2px dashed #b56813!important;background:repeating-linear-gradient(135deg,#fbdb9d 0 4px,#c68a3f 4px 5px)}.legend-road{background:#fff4dc;border-color:#63706a!important;height:7px!important}.legend-access{border:2px dashed #a93d92!important;background:#f5e3f2;height:7px!important}.legend-water{background:#63b7d1;border-color:#327e99!important}.legend-selected{background:#efffff;border-color:#00aeca!important}',
    '.inspector{padding:15px;display:flex;flex-direction:column;gap:7px}.inspector-top p{font-size:12px;color:var(--muted);margin:4px 0 7px}.inspector label{font-size:12px;font-weight:650;margin-top:4px}.muted{color:var(--muted);font-size:12px}.object-list{max-height:245px;overflow:auto;border:1px solid #d6e0df;border-radius:5px;background:#f6f9f8}.object-group{font-size:11px;font-weight:700;color:#416067;padding:5px 9px;background:#edf3f1;position:sticky;top:0;margin:0}.object-row{display:block;border:0;border-radius:0;border-bottom:1px solid #dce5e3;width:100%;padding:8px 10px;text-align:left;background:#fff;font-size:13px;font-weight:500}.object-row small{display:block;font-size:11px;color:#52676c;margin-top:2px}.object-row[aria-pressed="true"]{background:#e0f4f6;color:#123c46;border-left:4px solid #00a0b9;padding-left:6px}.selection-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.selection-actions button{font-size:12px;padding:7px 8px}.selection-card{margin-top:6px;padding:12px;background:#f3f7f5;border:1px solid #d5e1dc;border-radius:7px}.selection-card h3{margin-bottom:7px}.detail-title{font-weight:750;margin-bottom:7px}.selection-card p{font-size:12px;margin-top:5px}.selection-card dl{font-size:12px;display:grid;grid-template-columns:80px 1fr;gap:5px;margin:8px 0}.selection-card dt{color:var(--muted)}.selection-card dd{margin:0;overflow-wrap:anywhere}.empty{padding:13px;font-size:13px;color:var(--muted)}',
    '.budgets{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}.budget-panel{padding:17px 19px}.budget-panel>p:first-of-type{font-size:13px;color:#425f66;margin:7px 0 12px}table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 9px;border-bottom:1px solid #dce4e2}thead{background:#edf3f0;color:#3a565c}th:not(:first-child),td:not(:first-child){text-align:right;white-space:nowrap}tbody th{font-weight:500}.budget-total{background:#eff5f2;font-weight:750}.budget-sub th{padding-left:22px}.budget-held{color:#855015;background:#fff9ed}.budget-outside{color:#52676c}.table-note{font-size:12px;color:var(--muted);margin-top:12px}',
    '.access-panel,.limits-panel{padding:17px 19px;margin-top:18px}.access-panel p,.limits-panel p{font-size:13px;margin-top:7px}.access-panel{border-left:4px solid #a176a6}.technical{margin-top:17px;border:1px solid var(--border);border-radius:7px;background:#fff}.technical summary{padding:12px 15px;cursor:pointer;font-size:13px;font-weight:600}.technical pre{margin:0;padding:0 15px 16px;max-height:430px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,Consolas,monospace}.roadmap{margin-top:20px;padding:16px 18px;border-radius:7px;background:#e1eae6;font-size:13px}.roadmap p{margin-top:5px;color:#3f5e61}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}noscript{display:block;margin:20px;padding:20px;background:#ffedbf}',
    '@media(min-width:1600px){.workspace{grid-template-columns:minmax(900px,1fr) 380px}.map-stage{height:clamp(650px,70vh,930px)}}'
  ].join('\n');
}

function initializeReview() {
  'use strict';
  const data = JSON.parse(document.getElementById('review-data').textContent);
  const $ = id => document.getElementById(id);
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    $('map-description').textContent = 'Canvasを利用できません。PCのCanvas対応ブラウザーで開いてください。';
    return;
  }
  const format = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const num = v => format.format(v);
  const area = v => num(v) + ' m²';
  const people = v => num(v) + ' 人';
  const kindName = { city: '都市', town: '町', village: '村', hamlet: '小集落' };
  const groupNames = { house: '配置住宅', public: '公共施設', accepted: '農地・調査通過', rejected: '農地・保留' };
  const groups = ['house', 'public', 'accepted', 'rejected'];
  const reasonName = reason => {
    const names = {
      'siting-unresolved:slope': '詳細地形の傾斜で立地保留',
      'siting-unresolved:wet': '詳細地形の水域で立地保留',
      slope: '勾配', wet: '水域', unknown: '調査値不明',
      'road-width-wet-or-unknown': '道路幅の範囲に水域または不明値',
      'blocked-water': '水域で保留',
      'not-generated': '未調査'
    };
    return names[reason] || '保存理由あり（技術詳細を参照）';
  };
  const statusName = e => e.result.status === 'materialized' ? '部分詳細化' : '立地保留';
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  let example = null;
  let records = [];
  let selected = null;
  let terrain = null;
  let terrainMin = 0;
  let terrainMax = 0;
  let accessTargetPoint = null;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let frame = 0;
  let activeView = 'full';
  let pointer = null;
  const camera = { x: 0, y: 0, scale: 1 };
  const savedViews = {};
  for (const [i, e] of data.examples.entries()) {
    const option = element('option', e.label + '｜' + kindName[e.candidate.kind] + ' ' + people(e.candidate.population) + '｜' + statusName(e));
    option.value = String(i);
    $('candidate').append(option);
  }
  const screen = p => ({ x: width / 2 + (p.xM - camera.x) * camera.scale, y: height / 2 - (p.yM - camera.y) * camera.scale });
  const world = (x, y) => ({ xM: camera.x + (x - width / 2) / camera.scale, yM: camera.y - (y - height / 2) / camera.scale });
  const rectBounds = b => [
    { xM: b.minXM, yM: b.minYM }, { xM: b.maxXM, yM: b.minYM },
    { xM: b.maxXM, yM: b.maxYM }, { xM: b.minXM, yM: b.maxYM }
  ];
  const center = b => ({ xM: (b.minXM + b.maxXM) / 2, yM: (b.minYM + b.maxYM) / 2 });
  const fullScale = () => Math.min((width - 74) / example.surface.widthM, (height - 74) / example.surface.heightM);
  const clampCamera = () => {
    if (!example) return;
    camera.scale = Math.max(Math.max(1e-6, fullScale() * 0.35), Math.min(20, camera.scale));
    const sx = example.surface.widthM / 2 + width / (2 * camera.scale) * 0.7;
    const sy = example.surface.heightM / 2 + height / (2 * camera.scale) * 0.7;
    camera.x = Math.max(-sx, Math.min(sx, camera.x));
    camera.y = Math.max(-sy, Math.min(sy, camera.y));
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  };
  const viewButtons = () => {
    for (const name of ['full', 'settlement', 'fields']) $('view-' + name).setAttribute('aria-pressed', String(activeView === name));
  };
  const fit = (bounds, padding = 1.3, minimum = 100) => {
    if (!bounds) return;
    const b = bounds;
    camera.x = (b.minXM + b.maxXM) / 2;
    camera.y = (b.minYM + b.maxYM) / 2;
    camera.scale = Math.min((width - 75) / (Math.max(minimum, b.maxXM - b.minXM) * padding), (height - 75) / (Math.max(minimum, b.maxYM - b.minYM) * padding));
    clampCamera();
    schedule();
  };
  const union = items => {
    if (!items.length) return null;
    return items.reduce((b, item) => {
      const a = item.bounds || item;
      b.minXM = Math.min(b.minXM, a.minXM);
      b.maxXM = Math.max(b.maxXM, a.maxXM);
      b.minYM = Math.min(b.minYM, a.minYM);
      b.maxYM = Math.max(b.maxYM, a.maxYM);
      return b;
    }, { minXM: Infinity, maxXM: -Infinity, minYM: Infinity, maxYM: -Infinity });
  };
  const fullBounds = () => ({
    minXM: -example.surface.widthM / 2, maxXM: example.surface.widthM / 2,
    minYM: -example.surface.heightM / 2, maxYM: example.surface.heightM / 2
  });
  const setView = name => {
    activeView = name;
    if (name === 'settlement') fit(example.result.layout ? example.result.layout.bounds : { minXM: -250, maxXM: 250, minYM: -250, maxYM: 250 }, 1.22, 400);
    else if (name === 'fields') fit(union(records.filter(r => r.type === 'accepted' || r.type === 'rejected')), 1.18, 500);
    else fit(fullBounds(), 1, 1);
    viewButtons();
  };
  const targetCoordinates = target => {
    if (!target) return null;
    const radians = Math.PI / 180;
    const lat0 = example.result.origin.latDeg * radians;
    const lat = target.latDeg * radians;
    const dl = (target.lonDeg - example.result.origin.lonDeg) * radians;
    const cosC = Math.max(-1, Math.min(1, Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(dl)));
    const c = Math.acos(cosC);
    if (c > Math.PI - 1e-6) return null;
    const k = c < 1e-8 ? 1 : c / Math.sin(c);
    const radius = example.result.access.recipe ? example.result.access.recipe.projection.radiusM : 6371000;
    return {
      xM: radius * k * Math.cos(lat) * Math.sin(dl),
      yM: radius * k * (Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(dl))
    };
  };
  const prepareTerrain = () => {
    const s = example.surface;
    const g = s.grid;
    terrain = document.createElement('canvas');
    terrain.width = g.columns;
    terrain.height = g.rows;
    const context = terrain.getContext('2d');
    const pixels = context.createImageData(g.columns, g.rows);
    terrainMin = Infinity;
    terrainMax = -Infinity;
    for (const z of s.elevationM) {
      terrainMin = Math.min(terrainMin, z);
      terrainMax = Math.max(terrainMax, z);
    }
    const span = Math.max(1, terrainMax - terrainMin);
    const stops = [[132, 153, 132], [183, 182, 139], [233, 223, 191]];
    for (let y = 0; y < g.rows; y += 1) {
      for (let x = 0; x < g.columns; x += 1) {
        const i = y * g.columns + x;
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(g.columns - 1, x + 1);
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(g.rows - 1, y + 1);
        const dx = (s.elevationM[y * g.columns + x1] - s.elevationM[y * g.columns + x0]) / ((x1 - x0) * g.cellSizeM);
        const dy = (s.elevationM[y1 * g.columns + x] - s.elevationM[y0 * g.columns + x]) / ((y1 - y0) * g.cellSizeYM);
        const dot = (dx * 0.45 + dy * 0.55 + 0.70) / Math.hypot(dx, dy, 1);
        const shade = Math.max(0.48, Math.min(1.12, 0.68 + 0.42 * dot));
        const t = (s.elevationM[i] - terrainMin) / span * 2;
        const start = t < 1 ? stops[0] : stops[1];
        const end = t < 1 ? stops[1] : stops[2];
        const mix = t < 1 ? t : t - 1;
        for (let channel = 0; channel < 3; channel += 1) pixels.data[i * 4 + channel] = (start[channel] * (1 - mix) + end[channel] * mix) * shade;
        if (s.waterDepthM[i] > 0) {
          const depth = Math.min(1, Math.log1p(s.waterDepthM[i]) / 4);
          pixels.data[i * 4] = 95 - depth * 40;
          pixels.data[i * 4 + 1] = 178 - depth * 35;
          pixels.data[i * 4 + 2] = 205 - depth * 20;
        }
        pixels.data[i * 4 + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    $('elevation-range').textContent = num(terrainMin) + ' 〜 ' + num(terrainMax) + ' m';
  };
  const polygon = points => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const a = screen(p);
      if (i === 0) ctx.moveTo(a.x, a.y);
      else ctx.lineTo(a.x, a.y);
    });
    ctx.closePath();
  };
  const segment = (a, b) => {
    const start = screen(a);
    const end = screen(b);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  };
  const visible = bounds => {
    const a = screen({ xM: bounds.minXM, yM: bounds.maxYM });
    const b = screen({ xM: bounds.maxXM, yM: bounds.minYM });
    return b.x >= -15 && a.x <= width + 15 && b.y >= -15 && a.y <= height + 15;
  };
  const linePath = points => {
    ctx.beginPath();
    points.forEach((p, i) => {
      const a = screen(p);
      if (i === 0) ctx.moveTo(a.x, a.y);
      else ctx.lineTo(a.x, a.y);
    });
  };
  const drawField = record => {
    if (!visible(record.bounds)) return;
    const accepted = record.type === 'accepted';
    const points = record.data.points;
    polygon(points);
    ctx.fillStyle = accepted ? 'rgba(189,226,146,.42)' : 'rgba(255,203,107,.45)';
    ctx.fill();
    ctx.save();
    polygon(points);
    ctx.clip();
    const a = screen({ xM: record.bounds.minXM, yM: record.bounds.maxYM });
    const b = screen({ xM: record.bounds.maxXM, yM: record.bounds.minYM });
    const left = Math.max(-12, a.x);
    const top = Math.max(-12, a.y);
    const right = Math.min(width + 12, b.x);
    const bottom = Math.min(height + 12, b.y);
    if (accepted) {
      ctx.fillStyle = 'rgba(36,99,47,.50)';
      for (let y = Math.floor(top / 11) * 11; y <= bottom; y += 11) {
        for (let x = Math.floor(left / 11) * 11; x <= right; x += 11) ctx.fillRect(x, y, 1.5, 1.5);
      }
    } else {
      ctx.strokeStyle = 'rgba(142,78,9,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = Math.floor((left + top) / 12) * 12; k <= right + bottom; k += 12) {
        const y0 = Math.max(top, k - right);
        const y1 = Math.min(bottom, k - left);
        ctx.moveTo(k - y0, y0);
        ctx.lineTo(k - y1, y1);
      }
      ctx.stroke();
    }
    ctx.restore();
    polygon(points);
    ctx.strokeStyle = accepted ? '#267536' : '#aa5b0e';
    ctx.lineWidth = 1.7;
    ctx.setLineDash(accepted ? [] : [6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    if ((record.bounds.maxXM - record.bounds.minXM) * camera.scale > 70 && (record.bounds.maxYM - record.bounds.minYM) * camera.scale > 35) {
      const c = screen(center(record.bounds));
      const text = record.shortName + (accepted ? ' 通過' : ' 保留');
      ctx.font = '600 12px system-ui,sans-serif';
      ctx.textAlign = 'center';
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = accepted ? 'rgba(243,255,236,.94)' : 'rgba(255,246,221,.96)';
      ctx.fillRect(c.x - textWidth / 2 - 5, c.y - 10, textWidth + 10, 21);
      ctx.fillStyle = accepted ? '#205a2a' : '#7a4107';
      ctx.fillText(text, c.x, c.y + 5);
    }
  };
  const drawBuilding = record => {
    if (!visible(record.bounds)) return;
    const b = record.bounds;
    const a = screen({ xM: b.minXM, yM: b.maxYM });
    const z = screen({ xM: b.maxXM, yM: b.minYM });
    const publicBuilding = record.type === 'public';
    polygon(rectBounds(b));
    ctx.fillStyle = publicBuilding ? '#c4a4e6' : '#b96d3e';
    ctx.fill();
    ctx.strokeStyle = publicBuilding ? '#633784' : '#603921';
    ctx.lineWidth = publicBuilding ? 1.7 : 1;
    ctx.stroke();
    const cx = (a.x + z.x) / 2;
    const cy = (a.y + z.y) / 2;
    if (Math.min(z.x - a.x, z.y - a.y) < 5) {
      ctx.fillStyle = publicBuilding ? '#633784' : '#713c22';
      if (publicBuilding) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 3);
        ctx.lineTo(cx + 3, cy);
        ctx.lineTo(cx, cy + 3);
        ctx.lineTo(cx - 3, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (publicBuilding) {
      ctx.beginPath();
      ctx.moveTo(cx, a.y + 2);
      ctx.lineTo(z.x - 2, cy);
      ctx.lineTo(cx, z.y - 2);
      ctx.lineTo(a.x + 2, cy);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, a.y);
      ctx.lineTo(cx, z.y);
      ctx.stroke();
    }
  };
  const drawGrid = () => {
    const target = 110 / camera.scale;
    const power = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map(v => v * power).find(v => v >= target) || power * 10;
    const left = Math.max(-example.surface.widthM / 2, world(0, 0).xM);
    const right = Math.min(example.surface.widthM / 2, world(width, height).xM);
    const bottom = Math.max(-example.surface.heightM / 2, world(width, height).yM);
    const top = Math.min(example.surface.heightM / 2, world(0, 0).yM);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(36,65,62,.13)';
    ctx.font = '10px system-ui,sans-serif';
    ctx.fillStyle = '#294a47';
    ctx.textAlign = 'left';
    for (let x = Math.ceil(left / step) * step, count = 0; x <= right && count < 100; x += step, count += 1) {
      segment({ xM: x, yM: bottom }, { xM: x, yM: top });
      const a = screen({ xM: x, yM: top });
      ctx.fillText('東 ' + num(x), a.x + 3, Math.max(14, a.y + 13));
    }
    for (let y = Math.ceil(bottom / step) * step, count = 0; y <= top && count < 100; y += step, count += 1) {
      segment({ xM: left, yM: y }, { xM: right, yM: y });
      const a = screen({ xM: left, yM: y });
      ctx.fillText('北 ' + num(y), Math.max(5, a.x + 4), a.y - 4);
    }
  };
  const draw = () => {
    if (!example || !terrain) return;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#dae3de';
    ctx.fillRect(0, 0, width, height);
    const s = example.surface;
    const g = s.grid;
    const nw = screen({ xM: -s.widthM / 2, yM: s.heightM / 2 });
    ctx.save();
    ctx.beginPath();
    ctx.rect(nw.x, nw.y, s.widthM * camera.scale, s.heightM * camera.scale);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    // Grid samples are nodes: each offscreen pixel is centered on its saved node.
    const origin = screen({ xM: -s.widthM / 2 - g.cellSizeM / 2, yM: s.heightM / 2 + g.cellSizeYM / 2 });
    ctx.drawImage(terrain, origin.x, origin.y, g.columns * g.cellSizeM * camera.scale, g.rows * g.cellSizeYM * camera.scale);
    drawGrid();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const river of s.rivers) {
      for (let i = 0; i < river.points.length - 1; i += 1) {
        ctx.strokeStyle = '#3d91ae';
        ctx.lineWidth = Math.max(.65, river.widthM[i] * camera.scale);
        segment(river.points[i], river.points[i + 1]);
      }
    }
    for (const record of records) if (record.type === 'accepted' || record.type === 'rejected') drawField(record);
    const layout = example.result.layout;
    if (layout) {
      polygon(rectBounds(layout.bounds));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(54,75,71,.65)';
      ctx.setLineDash([4, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const profile of layout.roadCenterlineProfiles) {
        linePath(profile.samples);
        ctx.lineWidth = Math.max(1.5, profile.halfWidthM * 2 * camera.scale + 2);
        ctx.strokeStyle = '#616d63';
        ctx.stroke();
        linePath(profile.samples);
        ctx.lineWidth = Math.max(.7, profile.halfWidthM * 2 * camera.scale);
        ctx.strokeStyle = '#fff1d1';
        ctx.stroke();
      }
    }
    if (example.accessPolyline.length > 1) {
      linePath(example.accessPolyline);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#a23791';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const record of records) if (record.type === 'house' || record.type === 'public') drawBuilding(record);
    ctx.restore();
    // Survey target is a marker only. Empty saved routes never acquire invented lines.
    if (accessTargetPoint) {
      const p = screen(accessTargetPoint);
      if (p.x > -15 && p.x < width + 15 && p.y > -15 && p.y < height + 15) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x + 8, p.y);
        ctx.lineTo(p.x, p.y + 8);
        ctx.lineTo(p.x - 8, p.y);
        ctx.closePath();
        ctx.fillStyle = '#fff9fd';
        ctx.fill();
        ctx.strokeStyle = '#a23791';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '600 11px system-ui,sans-serif';
        const label = example.result.access.target ? '地域端の調査点 · 接続未解決' : '予定調査点 · 未調査';
        ctx.textAlign = p.x > width * .6 ? 'right' : 'left';
        const labelX = p.x > width * .6 ? p.x - 13 : p.x + 13;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fffffff0';
        ctx.strokeText(label, labelX, p.y + 4);
        ctx.fillStyle = '#792666';
        ctx.fillText(label, labelX, p.y + 4);
      }
    }
    const zero = screen({ xM: 0, yM: 0 });
    ctx.strokeStyle = '#293e43';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(zero.x - 6, zero.y);
    ctx.lineTo(zero.x + 6, zero.y);
    ctx.moveTo(zero.x, zero.y - 6);
    ctx.lineTo(zero.x, zero.y + 6);
    ctx.stroke();
    if (selected) {
      polygon(selected.points);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.stroke();
      polygon(selected.points);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#00a7c4';
      ctx.stroke();
      const p = screen(center(selected.bounds));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#003d4b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#00c4e0';
      ctx.fill();
    }
    const maxDistance = Math.max(.001, Math.min(150, width * .2) / camera.scale);
    const power = Math.pow(10, Math.floor(Math.log10(maxDistance)));
    const distance = [1, 2, 5].map(v => v * power).filter(v => v <= maxDistance).pop() || power;
    $('scale-line').style.width = Math.max(15, distance * camera.scale) + 'px';
    $('scale-label').textContent = distance >= 1000 ? decimal.format(distance / 1000) + ' km' : decimal.format(distance) + ' m';
    $('view-state').textContent = '表示幅 ' + decimal.format(width / camera.scale) + ' m · 原点から東/北 m';
  };
  const makeRecords = () => {
    records = [];
    const layout = example.result.layout;
    let house = 0;
    let facility = 0;
    if (layout) for (const building of layout.buildings) {
      const type = building.residential ? 'house' : 'public';
      const index = building.residential ? ++house : ++facility;
      const shortName = groupNames[type] + ' ' + String(index).padStart(2, '0');
      records.push({
        key: 'building-' + records.length, type, shortName,
        label: shortName + '｜配置済み',
        search: shortName + ' 配置済み',
        bounds: building.bounds, points: rectBounds(building.bounds), data: building
      });
    }
    let ordinal = 0;
    for (const type of ['accepted', 'rejected']) {
      for (const plot of example.result.fields[type]) {
        const match = /\/field:(\d+)$/.exec(plot.id);
        ordinal += 1;
        const index = match ? Number(match[1]) + 1 : example.result.fields.offset + ordinal;
        const shortName = '農地 ' + String(index).padStart(2, '0');
        const status = type === 'accepted' ? '標本調査通過' : '保留・' + reasonName(plot.reason);
        records.push({
          key: 'plot-' + records.length, type, shortName,
          label: shortName + '｜' + status,
          search: shortName + ' ' + status + ' ' + area(plot.areaM2),
          bounds: plot.bounds, points: plot.points, data: plot
        });
      }
    }
  };
  const renderList = () => {
    const focusedRow = document.activeElement && document.activeElement.classList.contains('object-row')
      ? document.activeElement.dataset.key : null;
    const query = $('object-search').value.trim().normalize('NFKC').toLocaleLowerCase('ja-JP');
    const filter = $('object-filter').value;
    const matches = records.filter(r => (filter === 'all' || r.type === filter) && r.search.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(query));
    const select = $('object-select');
    const list = $('object-list');
    select.replaceChildren();
    list.replaceChildren();
    const placeholder = element('option', '対象を選択してください');
    placeholder.value = '';
    select.append(placeholder);
    for (const group of groups) {
      const items = matches.filter(r => r.type === group);
      if (!items.length) continue;
      const optgroup = element('optgroup');
      optgroup.label = groupNames[group] + '（' + num(items.length) + '）';
      list.append(element('p', optgroup.label, 'object-group'));
      for (const record of items) {
        const option = element('option', record.label);
        option.value = record.key;
        optgroup.append(option);
        const button = element('button', record.label, 'object-row');
        button.type = 'button';
        button.dataset.key = record.key;
        button.setAttribute('aria-pressed', String(selected && selected.key === record.key));
        const b = record.bounds;
        const sub = record.type === 'house' || record.type === 'public'
          ? decimal.format(b.maxXM - b.minXM) + ' × ' + decimal.format(b.maxYM - b.minYM) + ' m'
          : area(record.data.areaM2);
        button.append(element('small', sub));
        button.addEventListener('click', () => choose(record, true, false));
        list.append(button);
      }
      select.append(optgroup);
    }
    select.disabled = matches.length === 0;
    if (selected && matches.includes(selected)) select.value = selected.key;
    else if (selected) {
      const option = element('option', '現在選択：' + selected.label + '（絞り込み外）');
      option.value = selected.key;
      select.append(option);
      select.value = selected.key;
    }
    $('filter-count').textContent = num(matches.length) + ' / ' + num(records.length) + ' 対象を表示';
    if (!matches.length) list.append(element('p', records.length ? '条件に合う対象がありません。種類や検索条件を変更してください。' : 'この候補には保存された住宅・施設・農地輪郭がありません。保留予算は下の表で確認できます。', 'empty'));
    // Preserve keyboard focus when selection buttons are rebuilt.
    if (focusedRow) for (const row of list.querySelectorAll('button')) {
      if (row.dataset.key === focusedRow) { row.focus({ preventScroll: true }); break; }
    }
  };
  const showSelection = () => {
    const box = $('selection-detail');
    box.replaceChildren();
    $('focus-object').disabled = !selected;
    $('reveal-object').disabled = !selected;
    if (!selected) {
      box.append(element('p', records.length ? '地図・一覧・選択欄から対象を選んでください。選択欄と一覧から選ぶと輪郭へ近づきます。' : '立地保留のため住宅輪郭は保存されていません。候補原点と人口予算は同じままです。'));
      return;
    }
    const record = selected;
    box.append(element('p', record.label, 'detail-title'));
    const dl = element('dl');
    const entry = (name, value) => { dl.append(element('dt', name), element('dd', value)); };
    const c = center(record.bounds);
    entry('中心位置', '東 ' + decimal.format(c.xM) + ' m / 北 ' + decimal.format(c.yM) + ' m');
    entry('輪郭寸法', decimal.format(record.bounds.maxXM - record.bounds.minXM) + ' × ' + decimal.format(record.bounds.maxYM - record.bounds.minYM) + ' m');
    if (record.type === 'house' || record.type === 'public') {
      entry('用途', record.type === 'house' ? '住宅（戸数に算入）' : '公共施設（住宅数に含めない）');
      entry('基礎標高', decimal.format(record.data.baseElevationM) + ' m');
      entry('建物高', decimal.format(record.data.heightM) + ' m ＋ 屋根 ' + decimal.format(record.data.roofHeightM) + ' m');
    } else {
      entry('面積', area(record.data.areaM2));
      entry('調査状態', record.type === 'accepted' ? '乾燥・勾配の標本調査を通過' : '保留：' + reasonName(record.data.reason));
    }
    box.append(dl);
    if (record.type === 'accepted') box.append(element('p', '通過したのは区画輪郭の標本調査です。農道・権利・年間収量・食料は確保されていません。'));
    if (record.type === 'rejected') box.append(element('p', '保留輪郭として表示しています。利用可能な農地面積へ加算していません。'));
  };
  const updateTechnical = () => {
    const r = example.result;
    const s = example.surface;
    $('technical-data').textContent = JSON.stringify({
      schema: data.schema, platform: data.platform,
      candidateId: example.candidate.id, surfaceId: s.id,
      cellIndex: example.cellIndex, slot: r.slot,
      sourceLayerId: r.sourceLayerId, handoffId: r.handoffId, populationId: r.populationId, worldId: r.worldId,
      status: r.status, reasons: r.reasons, origin: r.origin,
      districtIndex: r.districtIndex, districtCount: r.districtCount,
      housing: r.housing,
      fields: {
        status: r.fields.status, offset: r.fields.offset, limit: r.fields.limit, totalPlots: r.fields.totalPlots,
        acceptedFootprints: r.fields.accepted.length, rejectedFootprints: r.fields.rejected.length
      },
      coordinates: {
        terrainExtent: '候補原点から東 ±widthM/2、北 ±heightM/2（m）',
        grid: s.grid, widthM: s.widthM, heightM: s.heightM,
        nativeSpacingM: s.nativeSpacingM,
        gridOrigin: 'nativeNW（北西）・X東 / Y南・行優先',
        shapes: '住宅bounds・農地points・内部道路sample・accessPolylineは候補原点から東/北m',
        accessRecipe: 'recipe内の座標はrecipe.projection固有。Canvasの道路線には直接使わない',
        targetMarker: 'target緯度経度を候補原点の球面正距方位図法へ表示変換。予定調査点はoptions.accessTargetを使用',
        displayOnly: '保存格子を補間して表示。地形サンプラの再実行・再生成なし'
      },
      access: {
        status: r.access.status, reason: r.access.reason, receivingConnection: r.access.receivingConnection,
        target: r.access.target, plannedTarget: r.options.accessTarget,
        recipeId: r.access.recipe ? r.access.recipe.id : null,
        recipeStatus: r.access.recipe ? r.access.recipe.status : null,
        recipeReason: r.access.recipe ? r.access.recipe.reason : null,
        projection: r.access.recipe ? r.access.recipe.projection : null,
        savedRecipeProfiles: r.access.recipe ? r.access.recipe.roadCenterlineProfiles.length : 0,
        convertedPolylinePoints: example.accessPolyline.length
      },
      layoutStatus: r.layout ? r.layout.layoutStatus : null,
      internalRoadProfileCount: r.layout ? r.layout.roadCenterlineProfiles.length : 0,
      localConnections: r.layout ? r.layout.connections : [],
      provenance: s.provenance,
      limitations: r.limitations,
      selected: selected ? {
        id: selected.data.id, type: selected.type, status: selected.data.status || 'saved-building',
        reason: selected.data.reason || null, bounds: selected.bounds
      } : null
    }, null, 2);
  };
  const revealSelected = () => {
    if (!selected) return;
    $('object-filter').value = 'all';
    $('object-search').value = '';
    renderList();
    for (const row of $('object-list').querySelectorAll('button')) {
      if (row.dataset.key === selected.key) {
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        break;
      }
    }
  };
  function choose(record, focus, reveal) {
    selected = record || null;
    if (focus && selected) {
      activeView = 'selection';
      fit(selected.bounds, 1.65, selected.type === 'house' || selected.type === 'public' ? 100 : 250);
      viewButtons();
    }
    if (reveal) revealSelected();
    else renderList();
    showSelection();
    updateTechnical();
    $('selection-announcement').textContent = selected ? selected.label + 'を選択しました。' : '対象の選択を解除しました。';
    schedule();
  }
  const tableRow = (body, cells, className) => {
    const row = element('tr', null, className);
    cells.forEach((value, i) => {
      const cell = element(i === 0 ? 'th' : 'td', value);
      if (i === 0) cell.scope = 'row';
      row.append(cell);
    });
    body.append(row);
  };
  const renderBudgets = () => {
    const r = example.result;
    const h = r.housing;
    const f = r.fields;
    const population = $('population-body');
    population.replaceChildren();
    tableRow(population, ['この固定候補の全需要', people(h.totalPopulation), '—'], 'budget-total');
    tableRow(population, ['今回の住宅区画の要求', people(h.requestedPopulation), num(h.requestedDwellings) + ' 戸']);
    tableRow(population, ['うち配置住宅の容量', people(h.representedPopulation), num(h.placedDwellings) + ' 戸'], 'budget-sub');
    tableRow(population, ['うち今回の保留', people(h.unresolvedPopulation), num(h.requestedDwellings - h.placedDwellings) + ' 戸'], 'budget-sub budget-held');
    tableRow(population, ['今回の対象外（保存範囲外）', people(h.unvisitedPopulation), '—'], 'budget-outside');
    $('housing-status').textContent = r.status === 'held'
      ? r.reasons.map(reasonName).join(' / ') + '。今回の住宅要求を保留し、候補原点は動かしていません。'
      : '保存住宅 ' + num(h.placedDwellings) + ' 戸、公共施設 ' + num(records.filter(v => v.type === 'public').length) + ' 棟。住宅要求には未配置分が残っています。';
    $('housing-status').textContent += ' 保留 ' + num(h.requestedDwellings-h.placedDwellings) + ' 戸分は今回配置しなかった需要です。地図・一覧には配置した住宅輪郭だけを表示しています。';
    const fields = $('fields-body');
    fields.replaceChildren();
    tableRow(fields, ['この固定候補の全需要', area(f.totalDemandM2)], 'budget-total');
    tableRow(fields, ['今回の一ページの要求', area(f.requestedM2)]);
    tableRow(fields, ['うち標本調査通過', area(f.surveyedM2)], 'budget-sub');
    tableRow(fields, ['うち今回の保留', area(f.unresolvedM2)], 'budget-sub budget-held');
    tableRow(fields, ['今回の対象外（保存範囲外）', area(f.outsidePageM2)], 'budget-outside');
    const unlocated = Math.max(0, f.unresolvedM2 - f.rejected.reduce((sum, plot) => sum + plot.areaM2, 0));
    $('fields-status').textContent = f.status === 'regional-supply-unresolved'
      ? '地域からの供給が未解決です。この候補のローカル農地輪郭は保存されていません。全需要は今回の対象外欄に残っています。'
      : '今回：通過 ' + num(f.accepted.length) + ' 区画 / 保留輪郭 ' + num(f.rejected.length) + ' 区画（上限 ' + num(f.limit) + ' 区画）。' + (unlocated > 0 ? '保留のうち ' + area(unlocated) + ' は輪郭未保存です。地図には補って描きません。' : '');
  };
  const renderAccess = () => {
    const r = example.result;
    const a = r.access;
    const box = $('access-summary');
    box.replaceChildren();
    const internal = r.layout ? r.layout.roadCenterlineProfiles.length : 0;
    box.append(element('p', '内部道路：保存した中心線プロファイル ' + num(internal) + ' 件。白い線は地域内の設計線です。'));
    let state;
    if (a.status === 'not-generated') state = '外部アクセス：未調査。';
    else if (a.reason || /blocked|unresolved|failed|invalid/.test(a.status)) state = '外部アクセス：保留。' + (a.reason ? '理由：' + reasonName(a.reason) + '。' : '');
    else state = '外部アクセス：保存調査あり。';
    box.append(element('p', state + (example.accessPolyline.length > 1 ? '変換済みの保存調査線を紫の破線で表示します。建設済み道路を表しません。' : '変換済みの保存調査線はありません。経路を補って描きません。')));
    if (a.recipe && !a.recipe.roadCenterlineProfiles.length) box.append(element('p', '外部アクセスのレシピには有効な道路中心線プロファイルが保存されていません。'));
    const target = a.target || r.options.accessTarget;
    if (target) box.append(element('p', (a.target ? '地域端の調査点' : '予定調査点（未調査）') + '：緯度 ' + target.latDeg.toFixed(6) + '° / 経度 ' + target.lonDeg.toFixed(6) + '°。隣接地域の受け側接続は未解決です。'));
    else box.append(element('p', '地域端の調査点は未保存です。隣接地域の受け側接続は未解決です。'));
  };
  const changeExample = index => {
    if (example) savedViews[$('candidate').dataset.previous || ''] = { ...camera, activeView, key: selected ? selected.key : null };
    example = data.examples[index];
    $('candidate').dataset.previous = String(index);
    $('candidate').value = String(index);
    selected = null;
    $('object-filter').value = 'all';
    $('object-search').value = '';
    makeRecords();
    prepareTerrain();
    accessTargetPoint = targetCoordinates(example.result.access.target || example.result.options.accessTarget);
    const summary = $('candidate-summary');
    summary.replaceChildren();
    const line = element('p');
    line.append(element('span', statusName(example), 'status-chip' + (example.result.status === 'held' ? ' held' : '')));
    line.append(element('strong', example.label + ' · ' + kindName[example.candidate.kind] + ' ' + people(example.candidate.population)));
    summary.append(line);
    summary.append(element('p', '固定原点：緯度 ' + example.result.origin.latDeg.toFixed(6) + '° / 経度 ' + example.result.origin.lonDeg.toFixed(6) + '° · 保存は住宅一区画と農地一ページ', 'candidate-meta'));
    $('object-counts').textContent = '住宅 ' + num(example.result.housing.placedDwellings) + ' 戸 / 公共施設 ' + num(records.filter(v => v.type === 'public').length) + ' 棟 / 農地輪郭 ' + num(example.result.fields.accepted.length + example.result.fields.rejected.length) + ' 区画';
    $('view-fields').disabled = !records.some(r => r.type === 'accepted' || r.type === 'rejected');
    const g = example.surface.grid;
    $('map-description').textContent = '表示格子 ' + num(g.columns) + ' × ' + num(g.rows) + '、東西 ' + decimal.format(g.cellSizeM) + ' m × 南北 ' + decimal.format(g.cellSizeYM) + ' m。北西から東・南へ格納した標高と水深を表示しています。全景で小さい住宅は位置記号となり、拡大すると実寸の輪郭を表示します。' + (example.result.status === 'held' ? ' 立地保留のため、集落周辺ボタンは固定候補の原点周辺を表示します。' : '');
    const saved = savedViews[String(index)];
    if (saved) {
      Object.assign(camera, { x: saved.x, y: saved.y, scale: saved.scale });
      activeView = saved.activeView;
      selected = records.find(v => v.key === saved.key) || null;
      clampCamera();
      viewButtons();
    } else {
      selected = records.find(v => v.type === 'house') || null;
      setView(example.result.status === 'materialized' ? 'settlement' : 'full');
    }
    renderList();
    showSelection();
    renderBudgets();
    renderAccess();
    updateTechnical();
    $('coordinate').textContent = '原点から東・北の距離を表示';
    $('selection-announcement').textContent = example.label + '、' + statusName(example) + 'を表示しました。';
    schedule();
  };
  const resize = () => {
    const box = canvas.getBoundingClientRect();
    width = Math.max(100, box.width);
    height = Math.max(100, box.height);
    pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, 4096 / width, 4096 / height));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    if (example) {
      if (activeView === 'full' || activeView === 'settlement' || activeView === 'fields') setView(activeView);
      else clampCamera();
    }
    schedule();
  };
  const manualView = () => {
    activeView = 'custom';
    viewButtons();
    clampCamera();
    schedule();
  };
  const zoom = (factor, x, y) => {
    const before = world(x, y);
    camera.scale *= factor;
    clampCamera();
    const after = world(x, y);
    camera.x += before.xM - after.xM;
    camera.y += before.yM - after.yM;
    manualView();
  };
  const localPointer = event => {
    const b = canvas.getBoundingClientRect();
    return { x: event.clientX - b.left, y: event.clientY - b.top };
  };
  const contains = (p, points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if ((a.yM > p.yM) !== (b.yM > p.yM) && p.xM < (b.xM - a.xM) * (p.yM - a.yM) / (b.yM - a.yM) + a.xM) inside = !inside;
    }
    return inside;
  };
  const hit = p => {
    const xy = world(p.x, p.y);
    const sorted = records.slice().reverse().sort((a, b) => (a.type === 'house' || a.type === 'public' ? 0 : 1) - (b.type === 'house' || b.type === 'public' ? 0 : 1));
    for (const record of sorted) if (contains(xy, record.points)) return record;
    let nearest = null;
    let best = 8;
    for (const record of records) {
      if (record.type !== 'house' && record.type !== 'public') continue;
      const c = screen(center(record.bounds));
      const distance = Math.hypot(p.x - c.x, p.y - c.y);
      if (distance < best) { best = distance; nearest = record; }
    }
    return nearest;
  };
  const coordinateReadout = p => {
    const xy = world(p.x, p.y);
    const s = example.surface;
    const g = s.grid;
    const gx = (xy.xM + s.widthM / 2) / g.cellSizeM;
    const gy = (s.heightM / 2 - xy.yM) / g.cellSizeYM;
    let text = '東 ' + decimal.format(xy.xM) + ' m / 北 ' + decimal.format(xy.yM) + ' m';
    if (gx >= 0 && gx <= g.columns - 1 && gy >= 0 && gy <= g.rows - 1) {
      const x0 = Math.min(g.columns - 2, Math.floor(gx));
      const y0 = Math.min(g.rows - 2, Math.floor(gy));
      const tx = gx - x0;
      const ty = gy - y0;
      const sample = values => {
        const i = y0 * g.columns + x0;
        return (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - ty) +
          (values[i + g.columns] * (1 - tx) + values[i + g.columns + 1] * tx) * ty;
      };
      text += ' · 格子補間標高 ' + decimal.format(sample(s.elevationM)) + ' m / 水深 ' + decimal.format(sample(s.waterDepthM)) + ' m';
    } else text += ' · 保存地形の範囲外';
    $('coordinate').textContent = text;
  };
  $('candidate').addEventListener('change', () => changeExample(Number($('candidate').value)));
  $('object-filter').addEventListener('change', renderList);
  $('object-search').addEventListener('input', renderList);
  $('object-select').addEventListener('change', () => {
    const record = records.find(v => v.key === $('object-select').value);
    choose(record, Boolean(record), false);
  });
  $('focus-object').addEventListener('click', () => { if (selected) choose(selected, true, false); });
  $('reveal-object').addEventListener('click', revealSelected);
  for (const name of ['full', 'settlement', 'fields']) $('view-' + name).addEventListener('click', () => setView(name));
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const p = localPointer(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * .0015), p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const p = localPointer(event);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointer = { id: event.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false };
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    const p = localPointer(event);
    if (pointer && event.pointerId === pointer.id) {
      if (Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > 4) pointer.moved = true;
      if (pointer.moved) {
        camera.x -= (p.x - pointer.x) / camera.scale;
        camera.y += (p.y - pointer.y) / camera.scale;
        manualView();
      }
      pointer.x = p.x;
      pointer.y = p.y;
    }
    coordinateReadout(p);
  });
  const endPointer = (event, cancelled) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const click = !cancelled && !pointer.moved;
    pointer = null;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (click) {
      const record = hit(localPointer(event));
      if (record) choose(record, false, true);
    }
  };
  canvas.addEventListener('pointerup', event => endPointer(event, false));
  canvas.addEventListener('pointercancel', event => endPointer(event, true));
  canvas.addEventListener('lostpointercapture', () => { pointer = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('keydown', event => {
    const pan = (event.shiftKey ? 140 : 55) / camera.scale;
    let handled = true;
    if (event.key === 'ArrowLeft') camera.x -= pan;
    else if (event.key === 'ArrowRight') camera.x += pan;
    else if (event.key === 'ArrowUp') camera.y += pan;
    else if (event.key === 'ArrowDown') camera.y -= pan;
    else if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') zoom(1.3, width / 2, height / 2);
    else if (event.key === '-' || event.key === '−' || event.code === 'NumpadSubtract') zoom(1 / 1.3, width / 2, height / 2);
    else if (event.key === 'Home') setView('full');
    else handled = false;
    if (handled) {
      event.preventDefault();
      if (event.key.startsWith('Arrow')) manualView();
    }
  });
  resize();
  const hilly = data.examples.findIndex(e => e.result.status === 'materialized' && e.label.includes('起伏'));
  const materialized = data.examples.findIndex(e => e.result.status === 'materialized');
  changeExample(hilly >= 0 ? hilly : materialized >= 0 ? materialized : 0);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas.parentElement);
  else window.addEventListener('resize', resize);
}
