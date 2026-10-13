const BUDGET_KEYS = ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities'];
const KIND_BUDGETS = {village: ['ruralPopulation', 'villages'], town: ['townPopulation', 'towns'], city: ['cityPopulation', 'cities']};

// Validate and copy the presentation contract. Nothing is generated, repaired,
// fetched, or written here; extra properties never enter the standalone HTML.
function validateReviewData(input) {
  const fail = (path, message) => { throw new TypeError('L2集落確認: ' + path + ' — ' + message); };
  const check = (condition, path, message) => { if (!condition) fail(path, message); };
  const object = (value, path) => {
    check(value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), path, 'オブジェクトが必要です');
    return value;
  };
  const text = (value, path) => { check(typeof value === 'string' && value.trim().length > 0, path, '空でない文字列が必要です'); return value; };
  const integer = (value, path, min = 0) => { check(Number.isSafeInteger(value) && value >= min, path, min + '以上の安全な整数が必要です'); return value; };
  const finite = (value, path, min, max = Infinity) => { check(Number.isFinite(value) && value >= min && value <= max, path, '範囲内の有限数が必要です'); return value; };
  const area = (value, path) => value === null ? null : finite(value, path, 0);
  const list = (value, path) => {
    check(Array.isArray(value), path, '配列が必要です');
    for (let index = 0; index < value.length; index++) check(Object.hasOwn(value, index), path + '[' + index + ']', '配列の要素が欠けています');
    return value;
  };
  const sum = (values, path) => { const result = values.reduce((a, b) => a + b, 0); return integer(result, path); };
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
  const longitude = value => ((value % 360) + 360) % 360;
  const span = bounds => bounds.east > bounds.west ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const inside = (bounds, lon, lat) => {
    const delta = longitude(longitude(lon) - longitude(bounds.west));
    return lat >= bounds.south - 1e-9 && lat <= bounds.north + 1e-9 && delta <= span(bounds) + 1e-9;
  };
  const budget = (value, path) => {
    object(value, path);
    const result = Object.fromEntries(BUDGET_KEYS.map(key => [key, integer(value[key], path + '.' + key)]));
    check(result.population === sum([result.ruralPopulation, result.townPopulation, result.cityPopulation], path), path, '総人口と村・町・都市の人口合計が一致しません');
    for (const [population, count] of Object.values(KIND_BUDGETS)) {
      check((result[population] === 0) === (result[count] === 0), path, population + 'と' + count + 'のゼロ／非ゼロが一致しません');
      check(result[population] >= result[count], path, '集落数がその人口を超えています');
    }
    sum([result.villages, result.towns, result.cities], path + '.集落数合計');
    return result;
  };
  const candidateBudget = candidates => {
    const result = Object.fromEntries(BUDGET_KEYS.map(key => [key, 0]));
    for (const candidate of candidates) {
      const [population, count] = KIND_BUDGETS[candidate.kind];
      result.population += candidate.population;
      result[population] += candidate.population;
      result[count]++;
    }
    return result;
  };
  const compareBudget = (actual, expected, path) => {
    for (const key of BUDGET_KEYS) check(actual[key] === expected[key], path + '.' + key, '候補の整数集計と一致しません');
  };
  const compareArea = (actual, candidates, path) => {
    if (actual === null) return; // null means an explicitly unavailable estimate, never zero.
    check(candidates.every(candidate => candidate.requestedCultivatedAreaM2 !== null), path, '需要が不明な候補から面積を確定集計できません');
    const expected = candidates.reduce((total, candidate) => total + candidate.requestedCultivatedAreaM2, 0);
    check(Number.isFinite(expected) && close(actual, expected), path, '候補の農地需要合計と一致しません');
  };

  const data = object(input, 'data');
  check(data.schema === 'l2-settlement-review@1', 'schema', 'l2-settlement-review@1 が必要です');
  check(typeof data.seed === 'string', 'seed', '文字列が必要です');
  const seed = data.seed;
  object(data.census, 'census');
  const census = Object.fromEntries(['requestedPopulation', 'supportedPopulation', 'unplacedPopulation'].map(key => [key, integer(data.census[key], 'census.' + key)]));
  check(census.requestedPopulation === sum([census.supportedPopulation, census.unplacedPopulation], 'census'), 'census', '要求人口＝割り当て人口＋容量で割り当てられない人口、が成立しません');
  object(data.global, 'global');
  object(data.global.grid, 'global.grid');
  const grid = {columns: integer(data.global.grid.columns, 'global.grid.columns', 1), rows: integer(data.global.grid.rows, 'global.grid.rows', 1)};
  const cellCount = integer(grid.columns * grid.rows, 'global.grid.セル数', 1);
  for (const key of ['population', 'surface', 'cellAreaM2']) check(list(data.global[key], 'global.' + key).length === cellCount, 'global.' + key, 'グリッドのセル数と長さが一致しません');
  const global = {grid, population: [], surface: [], cellAreaM2: []};
  for (let i = 0; i < cellCount; i++) {
    const population = integer(data.global.population[i], 'global.population[' + i + ']');
    const surface = data.global.surface[i];
    check(['land', 'sea', 'lake'].includes(surface), 'global.surface[' + i + ']', 'land / sea / lake が必要です');
    const cellArea = finite(data.global.cellAreaM2[i], 'global.cellAreaM2[' + i + ']', Number.MIN_VALUE);
    check(Number.isFinite(population / cellArea * 1e6), 'global.cellAreaM2[' + i + ']', '人口密度が有限数になりません');
    check(surface === 'land' || population === 0, 'global.population[' + i + ']', '海・湖のセルには人口を割り当てられません');
    global.population.push(population); global.surface.push(surface); global.cellAreaM2.push(cellArea);
  }
  const globalPopulation = sum(global.population, 'global.population.合計');
  // L1 can still have budgets not distributed down from L0. Do not invent them.
  check(globalPopulation <= census.supportedPopulation, 'global.population', 'L1セルの人口合計が割り当て人口を超えています');
  object(data.sizePolicy, 'sizePolicy');
  const sizePolicy = {};
  for (const kind of Object.keys(KIND_BUDGETS)) {
    const source = object(data.sizePolicy[kind], 'sizePolicy.' + kind);
    const min = integer(source.min, 'sizePolicy.' + kind + '.min', 1);
    const max = integer(source.max, 'sizePolicy.' + kind + '.max', min);
    const mean = finite(source.mean, 'sizePolicy.' + kind + '.mean', min, max);
    sizePolicy[kind] = {min, max, mean};
  }
  const regionIds = new Set(), regionCells = new Set();
  const sources = list(data.regions, 'regions');
  check(sources.length > 0, 'regions', '代表地域を一つ以上保存してください');
  const regions = sources.map((source, regionIndex) => {
    const path = 'regions[' + regionIndex + ']';
    object(source, path);
    const id = text(source.id, path + '.id'), label = text(source.label, path + '.label');
    check(!regionIds.has(id), path + '.id', '地域IDが重複しています'); regionIds.add(id);
    const cellIndex = integer(source.cellIndex, path + '.cellIndex');
    check(cellIndex < cellCount && !regionCells.has(cellIndex), path + '.cellIndex', '範囲外または重複した代表セルです'); regionCells.add(cellIndex);
    const rootCell = integer(source.rootCell, path + '.rootCell');
    const b = object(source.bounds, path + '.bounds');
    const bounds = {west: finite(b.west, path + '.bounds.west', 0, 360), east: finite(b.east, path + '.bounds.east', 0, 360), south: finite(b.south, path + '.bounds.south', -90, 90), north: finite(b.north, path + '.bounds.north', -90, 90)};
    check(bounds.north > bounds.south && bounds.east !== bounds.west && span(bounds) > 0 && span(bounds) <= 360, path + '.bounds', '正の幅と高さが必要です');
    const centerLon = (cellIndex % grid.columns + 0.5) * 360 / grid.columns;
    const centerLat = 90 - (Math.floor(cellIndex / grid.columns) + 0.5) * 180 / grid.rows;
    check(inside(bounds, centerLon, centerLat), path + '.bounds', '代表セルの中心が地域の境界内にありません');
    const regionBudget = budget(source.budget, path + '.budget');
    check(regionBudget.population === global.population[cellIndex], path + '.budget.population', '代表L1セルの人口と一致しません');
    const a = object(source.agriculture, path + '.agriculture');
    check(['demand-only', 'unresolved'].includes(a.status), path + '.agriculture.status', 'demand-only / unresolved が必要です');
    const agriculture = {status: a.status, requestedCultivatedAreaM2: area(a.requestedCultivatedAreaM2, path + '.agriculture.requestedCultivatedAreaM2')};
    const pageSources = list(source.pages, path + '.pages');
    check(pageSources.length > 0, path + '.pages', '確認用の保存ページが必要です');
    const offsets = new Set(), bySlot = new Map(), candidateIds = new Map();
    let slotBase = null;
    const totalSettlements = sum([regionBudget.villages, regionBudget.towns, regionBudget.cities], path + '.集落数合計');
    const pages = pageSources.map((pageSource, pageIndex) => {
      const pp = path + '.pages[' + pageIndex + ']';
      object(pageSource, pp);
      const offset = integer(pageSource.offset, pp + '.offset');
      const total = integer(pageSource.total, pp + '.total');
      check(total === totalSettlements && offset <= total && !offsets.has(offset), pp, '全候補数、ページ位置または重複が不正です'); offsets.add(offset);
      const candidates = list(pageSource.candidates, pp + '.candidates').map((raw, index) => {
        const cp = pp + '.candidates[' + index + ']';
        object(raw, cp);
        const candidateId = text(raw.id, cp + '.id');
        const slot = integer(raw.slot, cp + '.slot');
        const base = slot - offset - index;
        check(base === 0 || base === 1, cp + '.slot', 'offsetから連続する0始まりまたは1始まりのslotが必要です');
        if (slotBase === null) slotBase = base;
        check(base === slotBase, cp + '.slot', '地域内でslotの起点が一致しません');
        const kind = raw.kind, settlementClass = raw.settlementClass;
        check(Object.hasOwn(KIND_BUDGETS, kind), cp + '.kind', 'village / town / city が必要です');
        check(kind === 'village' ? ['hamlet', 'village'].includes(settlementClass) : settlementClass === kind, cp + '.settlementClass', 'kindと集落区分が一致しません');
        const population = integer(raw.population, cp + '.population', 1);
        const latDeg = finite(raw.latDeg, cp + '.latDeg', -90, 90), lonDeg = finite(raw.lonDeg, cp + '.lonDeg', -180, 360);
        check(inside(bounds, lonDeg, latDeg), cp, '候補の座標が地域の境界外です');
        const requestedCultivatedAreaM2 = area(raw.requestedCultivatedAreaM2, cp + '.requestedCultivatedAreaM2');
        const status = raw.status;
        check(['sited-needs-local-layout', 'unresolved'].includes(status), cp + '.status', '未対応の調査状態です');
        check(raw.reason === null || typeof raw.reason === 'string', cp + '.reason', '文字列またはnullが必要です');
        const reason = raw.reason;
        const candidate = {id: candidateId, slot, kind, settlementClass, population, latDeg, lonDeg, requestedCultivatedAreaM2, status, reason};
        const signature = JSON.stringify(candidate);
        check(!bySlot.has(slot) || bySlot.get(slot).signature === signature, cp, '同じslotの保存候補がページ間で矛盾しています');
        check(!candidateIds.has(candidateId) || candidateIds.get(candidateId) === slot, cp + '.id', '候補IDが別のslotと重複しています');
        bySlot.set(slot, {signature, candidate}); candidateIds.set(candidateId, slot);
        return candidate;
      });
      check(candidates.length <= total - offset && (total === 0 ? offset === 0 && candidates.length === 0 : candidates.length > 0 && offset < total), pp + '.candidates', '候補数がページ範囲と一致しません');
      const requestedBudget = budget(pageSource.requestedBudget, pp + '.requestedBudget');
      const acceptedBudget = budget(pageSource.acceptedBudget, pp + '.acceptedBudget');
      const unresolvedBudget = budget(pageSource.unresolvedBudget, pp + '.unresolvedBudget');
      const unvisitedBudget = budget(pageSource.unvisitedBudget, pp + '.unvisitedBudget');
      const accepted = candidates.filter(candidate => candidate.status === 'sited-needs-local-layout');
      const unresolved = candidates.filter(candidate => candidate.status === 'unresolved');
      compareBudget(requestedBudget, candidateBudget(candidates), pp + '.requestedBudget');
      compareBudget(acceptedBudget, candidateBudget(accepted), pp + '.acceptedBudget');
      compareBudget(unresolvedBudget, candidateBudget(unresolved), pp + '.unresolvedBudget');
      for (const key of BUDGET_KEYS) {
        check(requestedBudget[key] === sum([acceptedBudget[key], unresolvedBudget[key]], pp + '.' + key), pp + '.' + key, '今回＝通過＋保留、が成立しません');
        check(regionBudget[key] === sum([requestedBudget[key], unvisitedBudget[key]], pp + '.' + key), pp + '.' + key, '地域全体＝今回＋このページの対象外、が成立しません');
      }
      const requestedAgricultureM2 = area(pageSource.requestedAgricultureM2, pp + '.requestedAgricultureM2');
      const acceptedAgricultureM2 = area(pageSource.acceptedAgricultureM2, pp + '.acceptedAgricultureM2');
      const unresolvedAgricultureM2 = area(pageSource.unresolvedAgricultureM2, pp + '.unresolvedAgricultureM2');
      compareArea(requestedAgricultureM2, candidates, pp + '.requestedAgricultureM2');
      compareArea(acceptedAgricultureM2, accepted, pp + '.acceptedAgricultureM2');
      compareArea(unresolvedAgricultureM2, unresolved, pp + '.unresolvedAgricultureM2');
      if ([requestedAgricultureM2, acceptedAgricultureM2, unresolvedAgricultureM2].every(value => value !== null)) {
        check(close(requestedAgricultureM2, acceptedAgricultureM2 + unresolvedAgricultureM2), pp, '今回の農地需要＝通過分＋保留分、が成立しません');
      }
      if (agriculture.requestedCultivatedAreaM2 !== null && requestedAgricultureM2 !== null) check(requestedAgricultureM2 <= agriculture.requestedCultivatedAreaM2 || close(requestedAgricultureM2, agriculture.requestedCultivatedAreaM2), pp, 'ページの農地需要が地域全体を超えています');
      return {offset, total, requestedBudget, acceptedBudget, unresolvedBudget, unvisitedBudget, requestedAgricultureM2, acceptedAgricultureM2, unresolvedAgricultureM2, candidates};
    }).sort((left, right) => left.offset - right.offset);
    const savedCandidates = [...bySlot.values()].map(value => value.candidate);
    const savedBudget = candidateBudget(savedCandidates);
    for (const key of BUDGET_KEYS) check(savedBudget[key] <= regionBudget[key], path + '.pages', '保存された異なる候補の合計が地域の' + key + 'を超えています');
    if (savedCandidates.length === totalSettlements) compareBudget(savedBudget, regionBudget, path + '.pages.全候補');
    if (agriculture.requestedCultivatedAreaM2 !== null) {
      const knownArea = savedCandidates.reduce((total, candidate) => total + (candidate.requestedCultivatedAreaM2 ?? 0), 0);
      check(Number.isFinite(knownArea) && (knownArea <= agriculture.requestedCultivatedAreaM2 || close(knownArea, agriculture.requestedCultivatedAreaM2)), path + '.agriculture', '保存候補の既知の農地需要が地域全体を超えています');
      if (savedCandidates.length === totalSettlements && savedCandidates.every(candidate => candidate.requestedCultivatedAreaM2 !== null)) check(close(knownArea, agriculture.requestedCultivatedAreaM2), path + '.agriculture', '全候補の農地需要が地域全体と一致しません');
    }
    return {id, label, cellIndex, rootCell, bounds, budget: regionBudget, agriculture, pages};
  });
  return {schema: data.schema, seed, census, global, sizePolicy, regions};
}

// This entire runtime is embedded below; it has no imports or network calls.
function l2ReviewRuntime(data) {
  const $ = id => document.getElementById(id);
  const report = error => {
    const target = $('l2-error');
    target.hidden = false;
    target.textContent = '表示を続けられません。' + (error instanceof Error ? error.message : String(error));
    console.error('L2集落確認の表示エラー', error);
  };
  const guard = action => (...args) => { try { return action(...args); } catch (error) { report(error); } };
  guard(() => {
    const number = value => value.toLocaleString('ja-JP');
    const decimal = value => value.toLocaleString('ja-JP', {maximumSignificantDigits: 4, ...(value >= 1e12 ? {notation: 'scientific'} : {})});
    const area = value => value === null ? '見積もり不明' : value < 10000 ? decimal(value) + ' m²' : decimal(value / 1e6) + ' km²';
    const longitude = value => ((value % 360) + 360) % 360;
    const lonLabel = value => { const n = longitude(value); return n === 0 ? '0°' : n <= 180 ? '東経' + decimal(n) + '°' : '西経' + decimal(360 - n) + '°'; };
    const latLabel = value => value === 0 ? '0°' : (value > 0 ? '北緯' : '南緯') + decimal(Math.abs(value)) + '°';
    const kindNames = {village: '村・小集落', town: '町', city: '都市'};
    const classNames = {hamlet: '小集落', village: '村', town: '町', city: '都市'};
    const shapes = {village: '●', town: '▲', city: '◆'};
    const colors = {village: '#196452', town: '#a64b18', city: '#5a46a2'};
    const rows = [['population', '人口合計', '人'], ['ruralPopulation', '村・小集落の人口', '人'], ['townPopulation', '町の人口', '人'], ['cityPopulation', '都市の人口', '人'], ['villages', '村・小集落の数', 'か所'], ['towns', '町の数', 'か所'], ['cities', '都市の数', 'か所']];
    const make = (tag, className, content) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const writeNumber = (id, value) => {
      const target = $(id), formatted = number(value);
      target.textContent = formatted;
      target.style.setProperty('--digits', String(formatted.length));
      if (target.parentElement.tagName === 'DD') target.parentElement.style.setProperty('--digits', String(formatted.length));
    };
    let regionIndex = 0, pageIndex = 0, candidateIndex = 0;
    let worldPoints = [], localPoints = [], candidateButtons = [], worldCache = null, frame = 0;
    const currentRegion = () => data.regions[regionIndex];
    const currentPage = () => currentRegion().pages[pageIndex];
    const pageRange = page => page.candidates.length ? '候補 ' + number(page.offset + 1) + '–' + number(page.offset + page.candidates.length) + ' / 全' + number(page.total) + '件' : '候補なし / 全0件';
    const announce = message => { $('selection-live').textContent = message; };
    const worldCanvas = $('world-map'), localCanvas = $('local-map');
    const worldContext = worldCanvas.getContext('2d'), localContext = localCanvas.getContext('2d');
    if (!worldContext || !localContext) throw new Error('Canvas 2Dを利用できません。地図を含む確認にはCanvas対応ブラウザーが必要です。');
    const setupCanvas = (canvas, context) => {
      const box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
      if (!(box.width > 0 && box.height > 0 && Number.isFinite(ratio) && ratio > 0)) throw new Error('Canvasの表示寸法または解像度を取得できません。');
      const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      return {width: box.width, height: box.height, ratio};
    };
    const latitudeY = lat => (1 - Math.sin(lat * Math.PI / 180)) / 2;
    const densityLimits = [1, 10, 50, 200, 1000];
    const densityColors = ['#e8edc8', '#b8d5a0', '#73af87', '#34847b', '#286375', '#253b65'];
    const drawWorld = () => {
      const {width, height, ratio} = setupCanvas(worldCanvas, worldContext);
      if (!worldCache || worldCache.width !== worldCanvas.width || worldCache.height !== worldCanvas.height || worldCache.ratio !== ratio) {
        const canvas = document.createElement('canvas');
        canvas.width = worldCanvas.width; canvas.height = worldCanvas.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('全球地図の描画領域を作成できません。');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#d6e6ef'; context.fillRect(0, 0, width, height);
        const {columns, rows: gridRows} = data.global.grid;
        for (let row = 0; row < gridRows; row++) {
          const top = latitudeY(90 - row * 180 / gridRows) * height;
          const bottom = latitudeY(90 - (row + 1) * 180 / gridRows) * height;
          for (let column = 0; column < columns; column++) {
            const index = row * columns + column, surface = data.global.surface[index];
            const density = data.global.population[index] / data.global.cellAreaM2[index] * 1e6;
            let bin = densityLimits.findIndex(limit => density < limit); if (bin < 0) bin = densityColors.length - 1;
            context.fillStyle = surface === 'sea' ? '#d6e6ef' : surface === 'lake' ? '#78b1c9' : data.global.population[index] === 0 ? '#f0f0e8' : densityColors[bin];
            context.fillRect(column / columns * width, top, width / columns + 0.15, bottom - top + 0.15);
          }
        }
        context.strokeStyle = 'rgba(24,50,69,.15)'; context.lineWidth = 0.7;
        for (const lat of [-60, -30, 0, 30, 60]) { const y = latitudeY(lat) * height; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
        for (const lon of [90, 180, 270]) { const x = lon / 360 * width; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
        worldCache = {canvas, width: canvas.width, height: canvas.height, ratio};
      }
      worldContext.drawImage(worldCache.canvas, 0, 0, width, height);
      const bounds = currentRegion().bounds;
      const west = longitude(bounds.west), lonSpan = bounds.east > bounds.west ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
      const segments = west + lonSpan <= 360 ? [[west, west + lonSpan]] : [[west, 360], [0, west + lonSpan - 360]];
      const top = latitudeY(bounds.north) * height, bottom = latitudeY(bounds.south) * height;
      for (const [start, end] of segments) {
        worldContext.strokeStyle = '#fff'; worldContext.lineWidth = 4; worldContext.strokeRect(start / 360 * width, top, (end - start) / 360 * width, bottom - top);
        worldContext.strokeStyle = '#172e3b'; worldContext.lineWidth = 1.5; worldContext.strokeRect(start / 360 * width, top, (end - start) / 360 * width, bottom - top);
      }
      worldPoints = data.regions.map((region, index) => {
        const {columns, rows: gridRows} = data.global.grid;
        const lon = (region.cellIndex % columns + 0.5) * 360 / columns;
        const lat = 90 - (Math.floor(region.cellIndex / columns) + 0.5) * 180 / gridRows;
        const actualX = lon / 360 * width, actualY = latitudeY(lat) * height;
        return {index, actualX, actualY, x: Math.max(13, Math.min(width - 13, actualX)), y: Math.max(13, Math.min(height - 13, actualY))};
      });
      const ordered = [...worldPoints.filter(point => point.index !== regionIndex), worldPoints[regionIndex]];
      for (const point of ordered) {
        const selected = point.index === regionIndex;
        worldContext.strokeStyle = '#172e3b'; worldContext.lineWidth = 1;
        worldContext.beginPath(); worldContext.moveTo(point.actualX, point.actualY); worldContext.lineTo(point.x, point.y); worldContext.stroke();
        worldContext.fillStyle = '#172e3b'; worldContext.beginPath(); worldContext.arc(point.actualX, point.actualY, 2, 0, Math.PI * 2); worldContext.fill();
        worldContext.beginPath(); worldContext.arc(point.x, point.y, selected ? 12 : 10, 0, Math.PI * 2);
        worldContext.fillStyle = selected ? '#152c3a' : '#fff'; worldContext.fill();
        worldContext.strokeStyle = selected ? '#fff' : '#152c3a'; worldContext.lineWidth = 2; worldContext.stroke();
        worldContext.fillStyle = selected ? '#fff' : '#152c3a'; worldContext.font = 'bold 12px system-ui'; worldContext.textAlign = 'center'; worldContext.textBaseline = 'middle';
        worldContext.fillText(String(point.index + 1), point.x, point.y);
      }
      worldCanvas.setAttribute('aria-label', 'L1全球人口密度。代表地域' + data.regions.length + 'か所。選択中は' + currentRegion().label);
    };
    const drawShape = (context, candidate, x, y, size) => {
      context.beginPath();
      if (candidate.kind === 'village') context.arc(x, y, size, 0, Math.PI * 2);
      else if (candidate.kind === 'town') { context.moveTo(x, y - size - 1); context.lineTo(x + size, y + size); context.lineTo(x - size, y + size); context.closePath(); }
      else { context.moveTo(x, y - size - 1); context.lineTo(x + size + 1, y); context.lineTo(x, y + size + 1); context.lineTo(x - size - 1, y); context.closePath(); }
      const held = candidate.status === 'unresolved';
      context.fillStyle = held ? '#fff' : colors[candidate.kind]; context.fill();
      context.strokeStyle = colors[candidate.kind]; context.lineWidth = 2; context.stroke();
      if (held) {
        context.strokeStyle = '#172e3b'; context.lineWidth = 1.5; context.beginPath();
        context.moveTo(x - 2.5, y - 2.5); context.lineTo(x + 2.5, y + 2.5); context.moveTo(x + 2.5, y - 2.5); context.lineTo(x - 2.5, y + 2.5); context.stroke();
      }
    };
    const drawLocal = () => {
      const {width, height} = setupCanvas(localCanvas, localContext), bounds = currentRegion().bounds;
      const paddingX = Math.min(40, width * 0.12), paddingY = 33;
      const left = paddingX, top = paddingY, plotWidth = width - 2 * paddingX, plotHeight = height - 2 * paddingY;
      if (!(plotWidth > 0 && plotHeight > 0)) throw new Error('地域の図を表示する余白が足りません。');
      const lonSpan = bounds.east > bounds.west ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
      localContext.fillStyle = '#fbfaf6'; localContext.fillRect(0, 0, width, height);
      localContext.fillStyle = '#f0f1eb'; localContext.fillRect(left, top, plotWidth, plotHeight);
      localContext.strokeStyle = '#697b79'; localContext.lineWidth = 1.5; localContext.strokeRect(left, top, plotWidth, plotHeight);
      localContext.fillStyle = '#506167'; localContext.font = '11px system-ui'; localContext.textBaseline = 'middle';
      localContext.textAlign = 'left'; localContext.fillText(lonLabel(bounds.west), left, height - 13);
      localContext.textAlign = 'right'; localContext.fillText(lonLabel(bounds.east), left + plotWidth, height - 13);
      localContext.textAlign = 'left'; localContext.fillText(latLabel(bounds.north), left, 15); localContext.fillText(latLabel(bounds.south), left, height - 29);
      localPoints = currentPage().candidates.map((candidate, index) => ({index, x: left + longitude(longitude(candidate.lonDeg) - longitude(bounds.west)) / lonSpan * plotWidth, y: top + (bounds.north - candidate.latDeg) / (bounds.north - bounds.south) * plotHeight}));
      for (const point of localPoints) if (point.index !== candidateIndex) drawShape(localContext, currentPage().candidates[point.index], point.x, point.y, 5);
      if (localPoints[candidateIndex]) {
        const point = localPoints[candidateIndex];
        localContext.beginPath(); localContext.arc(point.x, point.y, 12, 0, Math.PI * 2); localContext.strokeStyle = '#fff'; localContext.lineWidth = 5; localContext.stroke();
        localContext.strokeStyle = '#172e3b'; localContext.lineWidth = 2; localContext.stroke();
        drawShape(localContext, currentPage().candidates[candidateIndex], point.x, point.y, 6);
      }
      localCanvas.setAttribute('aria-label', currentRegion().label + 'の境界と、このページの仮候補' + currentPage().candidates.length + '件。詳細地形は含みません。');
    };
    const scheduleDraw = () => {
      if (frame) return;
      frame = requestAnimationFrame(guard(() => { frame = 0; drawWorld(); drawLocal(); }));
    };
    const selectCandidate = (index, scroll = false) => {
      if (!currentPage().candidates.length) return;
      candidateIndex = Math.max(0, Math.min(currentPage().candidates.length - 1, index));
      candidateButtons.forEach((button, i) => { button.setAttribute('aria-pressed', String(i === candidateIndex)); button.closest('li').classList.toggle('selected', i === candidateIndex); });
      const candidate = currentPage().candidates[candidateIndex];
      const status = candidate.status === 'unresolved' ? '地形条件で保留' : '広域条件を通過';
      $('candidate-current').textContent = '選択中：候補' + number(currentPage().offset + candidateIndex + 1) + '・' + classNames[candidate.settlementClass] + '・' + number(candidate.population) + '人・' + status;
      announce($('candidate-current').textContent);
      drawLocal();
      if (scroll) candidateButtons[candidateIndex].scrollIntoView({block: 'nearest', behavior: 'auto'});
    };
    const renderBudget = () => {
      const page = currentPage(), body = $('budget-body'); body.replaceChildren();
      const columns = [currentRegion().budget, page.requestedBudget, page.acceptedBudget, page.unresolvedBudget, page.unvisitedBudget];
      const columnNames = ['地域全体', '今回', '広域条件を通過', '地形条件で保留', 'このページの対象外'];
      for (const [key, label, unit] of rows) {
        const row = make('tr'); row.setAttribute('role', 'row'); const heading = make('th', '', label + '（' + unit + '）'); heading.scope = 'row'; heading.setAttribute('role', 'rowheader'); row.append(heading);
        columns.forEach((column, index) => { const cell = make('td', 'integer', number(column[key])); cell.setAttribute('role', 'cell'); cell.dataset.label = columnNames[index]; row.append(cell); });
        body.append(row);
      }
      const regionArea = currentRegion().agriculture.requestedCultivatedAreaM2;
      const unvisitedArea = regionArea === null || page.requestedAgricultureM2 === null ? null : Math.max(0, regionArea - page.requestedAgricultureM2);
      const measures = [['この地域全体の需要', regionArea], ['今回の候補の需要', page.requestedAgricultureM2], ['広域条件を通過した候補の需要', page.acceptedAgricultureM2], ['地形条件で保留した候補の需要', page.unresolvedAgricultureM2], ['このページの対象外の需要（差し引き）', unvisitedArea]];
      const target = $('agriculture-values'); target.replaceChildren();
      for (const [label, value] of measures) { const group = make('div', 'measure'); group.append(make('dt', '', label), make('dd', 'area-value', area(value))); target.append(group); }
      $('agriculture-state').textContent = currentRegion().agriculture.status === 'unresolved' ? 'この地域の農地需要には未解決の条件があります。数値があっても、面積の確保を示しません。' : '需要の面積だけを見積もっています。耕地の場所と確保はこれからです。';
    };
    const renderPolicy = () => {
      const body = $('policy-body'); body.replaceChildren();
      for (const kind of Object.keys(kindNames)) {
        const samples = currentPage().candidates.filter(candidate => candidate.kind === kind).map(candidate => candidate.population);
        const min = samples.length ? samples.reduce((a, b) => Math.min(a, b)) : null;
        const max = samples.length ? samples.reduce((a, b) => Math.max(a, b)) : null;
        const row = make('tr'), heading = make('th', '', shapes[kind] + ' ' + kindNames[kind]); row.setAttribute('role', 'row'); heading.setAttribute('role', 'rowheader'); heading.scope = 'row'; row.append(heading);
        const values = [number(data.sizePolicy[kind].min) + '–' + number(data.sizePolicy[kind].max) + '人', min === null ? 'このページに候補なし' : number(min) + '–' + number(max) + '人（' + samples.length + '件）'];
        values.forEach((value, index) => { const cell = make('td', '', value); cell.setAttribute('role', 'cell'); cell.dataset.label = index ? 'このページの候補人口' : 'モデルの下限–上限'; row.append(cell); }); body.append(row);
      }
    };
    const renderCandidates = () => {
      const target = $('candidate-list'); target.replaceChildren(); candidateButtons = [];
      const page = currentPage(), maxPopulation = page.candidates.reduce((max, candidate) => Math.max(max, candidate.population), 0);
      $('candidate-empty').hidden = page.candidates.length !== 0;
      $('candidate-current').textContent = page.candidates.length ? '' : 'このページに候補はありません。';
      page.candidates.forEach((candidate, index) => {
        const item = make('li', 'candidate-card'), ordinal = page.offset + index + 1;
        const button = make('button', 'candidate-choice'); button.type = 'button'; button.id = 'candidate-choice-' + index;
        button.setAttribute('aria-pressed', 'false');
        const held = candidate.status === 'unresolved';
        button.append(make('span', 'candidate-name', shapes[candidate.kind] + ' 候補' + number(ordinal) + ' · ' + classNames[candidate.settlementClass]), make('strong', 'candidate-population integer', number(candidate.population) + '人'), make('span', 'status ' + (held ? 'held' : 'passed'), held ? '× 地形条件で保留' : '● 広域条件を通過'));
        const bar = make('span', 'population-bar'); bar.setAttribute('aria-hidden', 'true');
        const fill = make('span', 'population-fill'); fill.style.width = String(candidate.population / maxPopulation * 100) + '%'; fill.style.backgroundColor = colors[candidate.kind]; bar.append(fill); button.append(bar);
        button.addEventListener('click', guard(() => selectCandidate(index)));
        item.append(button);
        item.append(make('p', 'candidate-demand', '必要耕地の見積もり：' + area(candidate.requestedCultivatedAreaM2) + ' · 土地は未確保'));
        item.append(make('p', 'candidate-coordinates', latLabel(candidate.latDeg) + ' / ' + lonLabel(candidate.lonDeg)));
        if (held || candidate.reason) item.append(make('p', 'candidate-reason', (held ? '保留理由：' : '調査補足：') + (candidate.reason?.trim() || '詳細理由は保存されていません。条件は未解決です。')));
        const detail = make('details', 'candidate-technical'); detail.append(make('summary', '', '候補の技術情報'));
        const code = make('p', 'technical', 'ID: ' + candidate.id + ' / slot: ' + candidate.slot + ' / kind: ' + candidate.kind + ' / class: ' + candidate.settlementClass + ' / status: ' + candidate.status + ' / world経度: ' + candidate.lonDeg + '°'); detail.append(code); item.append(detail);
        target.append(item); candidateButtons.push(button);
      });
    };
    const renderPage = () => {
      const region = currentRegion(), page = currentPage();
      $('saved-page-select').value = String(pageIndex);
      $('page-range').textContent = pageRange(page);
      $('page-position').textContent = '保存ページ ' + (pageIndex + 1) + ' / ' + region.pages.length;
      $('page-first').disabled = $('page-prev').disabled = pageIndex === 0;
      $('page-next').disabled = $('page-last').disabled = pageIndex === region.pages.length - 1;
      writeNumber('page-passed', page.acceptedBudget.villages + page.acceptedBudget.towns + page.acceptedBudget.cities);
      writeNumber('page-held', page.unresolvedBudget.villages + page.unresolvedBudget.towns + page.unresolvedBudget.cities);
      writeNumber('page-unvisited', page.unvisitedBudget.villages + page.unvisitedBudget.towns + page.unvisitedBudget.cities);
      renderBudget(); renderPolicy(); renderCandidates(); drawLocal();
      if (page.candidates.length) selectCandidate(0);
      announce(region.label + '、' + pageRange(page) + '。保留' + number(page.unresolvedBudget.villages + page.unresolvedBudget.towns + page.unresolvedBudget.cities) + '件。');
    };
    const renderRegion = () => {
      const region = currentRegion();
      $('region-select').value = String(regionIndex);
      document.querySelectorAll('#region-buttons button').forEach((button, index) => button.setAttribute('aria-pressed', String(index === regionIndex)));
      $('region-name').textContent = region.label;
      writeNumber('region-population', region.budget.population);
      $('region-counts').textContent = '村・小集落 ' + number(region.budget.villages) + 'か所 / 町 ' + number(region.budget.towns) + 'か所 / 都市 ' + number(region.budget.cities) + 'か所';
      $('region-area').textContent = area(region.agriculture.requestedCultivatedAreaM2);
      $('region-technical').textContent = '地域ID: ' + region.id + ' / L1 cell: ' + region.cellIndex + ' / L0 rootCell: ' + region.rootCell + ' / world bounds: ' + JSON.stringify(region.bounds) + ' / agriculture.status: ' + region.agriculture.status;
      const selector = $('saved-page-select'); selector.replaceChildren();
      region.pages.forEach((page, index) => { const option = make('option', '', '保存' + (index + 1) + ' · ' + pageRange(page)); option.value = String(index); selector.append(option); });
      pageIndex = 0; candidateIndex = 0; renderPage(); drawWorld();
    };
    const selectRegion = index => { regionIndex = Math.max(0, Math.min(data.regions.length - 1, index)); renderRegion(); };
    const selectPage = index => { pageIndex = Math.max(0, Math.min(currentRegion().pages.length - 1, index)); candidateIndex = 0; renderPage(); };
    const nearest = (event, canvas, points) => {
      const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      let result = null, distance = 22 * 22;
      for (const point of points) { const d = (point.x - x) ** 2 + (point.y - y) ** 2; if (d < distance) { result = point.index; distance = d; } }
      return result;
    };
    const keyboardIndex = (event, index, count, select) => {
      if (!count) return;
      const actions = {ArrowLeft: () => (index + count - 1) % count, ArrowUp: () => (index + count - 1) % count, ArrowRight: () => (index + 1) % count, ArrowDown: () => (index + 1) % count, Home: () => 0, End: () => count - 1};
      if (Object.hasOwn(actions, event.key)) { event.preventDefault(); select(actions[event.key]()); }
    };
    data.regions.forEach((region, index) => {
      const option = make('option', '', (index + 1) + ' · ' + region.label); option.value = String(index); $('region-select').append(option);
      const button = make('button', 'region-choice', (index + 1) + ' · ' + region.label); button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', guard(() => selectRegion(index))); $('region-buttons').append(button);
    });
    $('region-select').addEventListener('change', guard(event => selectRegion(Number(event.target.value))));
    $('saved-page-select').addEventListener('change', guard(event => selectPage(Number(event.target.value))));
    $('page-first').addEventListener('click', guard(() => selectPage(0)));
    $('page-prev').addEventListener('click', guard(() => selectPage(pageIndex - 1)));
    $('page-next').addEventListener('click', guard(() => selectPage(pageIndex + 1)));
    $('page-last').addEventListener('click', guard(() => selectPage(currentRegion().pages.length - 1)));
    worldCanvas.addEventListener('click', guard(event => {
      const index = nearest(event, worldCanvas, worldPoints);
      if (index !== null) selectRegion(index); else announce('番号を付けた代表地点から選んでください。他のセルの候補は、この確認用HTMLには保存されていません。');
    }));
    worldCanvas.addEventListener('keydown', guard(event => keyboardIndex(event, regionIndex, data.regions.length, selectRegion)));
    localCanvas.addEventListener('click', guard(event => { const index = nearest(event, localCanvas, localPoints); if (index !== null) selectCandidate(index, true); }));
    localCanvas.addEventListener('keydown', guard(event => {
      keyboardIndex(event, candidateIndex, currentPage().candidates.length, index => selectCandidate(index, true));
      if (event.key === 'Enter' && candidateButtons[candidateIndex]) { event.preventDefault(); candidateButtons[candidateIndex].focus(); }
    }));
    writeNumber('census-requested', data.census.requestedPopulation);
    writeNumber('census-supported', data.census.supportedPopulation);
    writeNumber('census-unplaced', data.census.unplacedPopulation);
    $('minimum-policy').textContent = '町・都市の最小規模は更新後の仮定です：町 ' + number(data.sizePolicy.town.min) + '人、都市 ' + number(data.sizePolicy.city.min) + '人。点は仮候補、土地は未確保です。';
    $('source-info').textContent = 'schema: ' + data.schema + ' / seed: ' + data.seed;
    const l1AssignedPopulation = data.global.population.reduce((a,b)=>a+b,0);
    $('global-total').textContent = 'L1へ配分済み：' + number(l1AssignedPopulation) + '人\nL1への未配分：' + number(data.census.supportedPopulation-l1AssignedPopulation) + '人。';
    $('policy-means').textContent = Object.keys(kindNames).map(kind => kindNames[kind] + 'のモデル平均 ' + decimal(data.sizePolicy[kind].mean) + '人').join(' / ');
    renderRegion();
    window.addEventListener('resize', guard(scheduleDraw));
    if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(guard(scheduleDraw)); observer.observe(worldCanvas.parentElement); observer.observe(localCanvas.parentElement); }
    const watchResolution = () => {
      if (typeof window.matchMedia !== 'function') return;
      const query = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      const change = guard(() => { query.removeEventListener('change', change); worldCache = null; scheduleDraw(); watchResolution(); });
      if (typeof query.addEventListener === 'function') query.addEventListener('change', change);
    };
    watchResolution();
  })();
}

const REVIEW_STYLE = String.raw`
:root{color-scheme:light;--ink:#172e3b;--muted:#506167;--line:#d3dcd7;--paper:#fff;--soft:#f3f5ef;--accent:#196452;--held:#875014;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans JP",sans-serif;color:var(--ink);background:#f0f2ec;font-size:16px;line-height:1.65}
*{box-sizing:border-box}body{margin:0}main{max-width:1220px;margin:auto;padding:32px 28px 56px}h1,h2,h3,p,figure,dl{margin:0}h1{font-size:clamp(1.65rem,3.8vw,2.8rem);line-height:1.35;letter-spacing:.02em}h2{font-size:1.35rem;line-height:1.5}h3{font-size:1.03rem}p+p{margin-top:.5rem}button,select{font:inherit;color:inherit}button{cursor:pointer;min-height:44px;border:1px solid #83958b;border-radius:8px;background:#fff;padding:9px 14px;line-height:1.5}button:hover:not(:disabled){background:#e9f1e9}button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:#e7f0e8}button:disabled{cursor:default;color:#6d756f;background:#f1f1ed;border-color:#cdd3cd}select{min-width:0;max-width:100%;min-height:44px;border:1px solid #83958b;border-radius:8px;background:#fff;padding:8px;width:100%}a{color:#185e55;text-underline-offset:3px}:focus-visible{outline:3px solid #b45219;outline-offset:4px}canvas:focus-visible{outline-offset:-4px}[hidden]{display:none!important}.eyebrow{font-size:.8rem;font-weight:700;letter-spacing:.08em;color:var(--accent);margin-bottom:8px}.lead{margin-top:12px;max-width:850px}.warning{margin-top:14px;padding:14px 16px;background:#fff4dc;border-left:4px solid #b76c18;border-radius:0 8px 8px 0}.warning strong{display:block}.small{font-size:.85rem;color:var(--muted)}.roadmap{list-style:none;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:20px 0 0}.roadmap li{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#f8faf6;font-size:.87rem}.roadmap .current{background:#e4efe5;border-color:#61836d;font-weight:700}.roadmap span{display:block;font-size:.76rem;color:var(--muted)}.panel{margin-top:22px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}.panel-head{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}.stat{min-width:0;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}.stat dt{font-size:.83rem;color:var(--muted)}.stat dd{margin:6px 0 0;display:flex;gap:6px;align-items:baseline;min-width:0}.stat-number{font-size:clamp(1rem,calc(25rem / var(--digits,11)),2.35rem);line-height:1.4;letter-spacing:-.025em;font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}.stat .unit{font-size:.82rem}.integer{font-variant-numeric:tabular-nums;white-space:nowrap}.map-wrap{position:relative;aspect-ratio:2/1;overflow:hidden;border:1px solid #b7c5c7;border-radius:10px;background:#e6ebea}.map-wrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y}.local-wrap{aspect-ratio:4/3;min-height:250px;max-height:470px;margin-top:12px}.map-caption{margin-top:8px}.density-legend,.point-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;font-size:.78rem}.density-legend span{display:inline-flex;align-items:center;gap:5px}.swatch{display:inline-block;width:14px;height:14px;border:1px solid #71817e;border-radius:3px}.region-controls{display:grid;grid-template-columns:minmax(200px,1fr) 2fr;gap:14px;align-items:end;margin-top:18px}.field-label{display:block;font-size:.85rem;font-weight:700;margin-bottom:6px}.region-buttons{display:flex;flex-wrap:wrap;gap:8px}.region-choice{font-size:.85rem;max-width:100%;overflow-wrap:anywhere}.region-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:12px}.summary-block{padding:16px;background:var(--soft);border-radius:9px;min-width:0}.summary-label{font-size:.82rem;color:var(--muted)}.summary-value{font-size:1.45rem;font-weight:750;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.region-person{font-size:clamp(1rem,calc(24rem / var(--digits,11)),1.8rem);white-space:nowrap;letter-spacing:-.02em}.page-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:16px}.page-buttons{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.page-buttons button{font-size:.85rem;padding:9px 12px}.range{margin-top:16px;font-size:1.1rem;font-weight:750;overflow-wrap:anywhere}.sample-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.sample-total{padding:12px;border:1px solid var(--line);border-radius:8px;min-width:0}.sample-total dt{font-size:.78rem}.sample-total dd{margin:4px 0 0;font-size:clamp(.95rem,calc(17rem / var(--digits,10)),1.35rem);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:750}.explanation{margin-top:12px;font-size:.88rem}.budget-table,.policy-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.81rem;margin-top:16px}.budget-table caption,.policy-table caption{text-align:left;font-weight:700;margin-bottom:8px}.budget-table th,.budget-table td,.policy-table th,.policy-table td{border-bottom:1px solid var(--line);padding:11px 7px;vertical-align:top;overflow-wrap:anywhere}.budget-table thead th,.policy-table thead th{background:#f0f4ee;font-weight:650}.budget-table thead th:first-child{width:19%}.budget-table th[scope=row],.policy-table th[scope=row]{text-align:left;font-weight:600}.budget-table td{text-align:right;font-size:clamp(.58rem,.85vw,.83rem)}.budget-table th:nth-child(4),.budget-table td:nth-child(4){background:#edf4ed}.budget-table th:nth-child(5),.budget-table td:nth-child(5){background:#fff6e9}.agriculture{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}.agriculture-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.measure{background:var(--soft);padding:12px;border-radius:8px;min-width:0}.measure dt{font-size:.8rem;color:var(--muted)}.measure dd{margin:3px 0 0;font-size:1.17rem;font-weight:700;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.sample-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px}.sample-layout>div{min-width:0}.candidate-list{list-style:none;padding:0;margin:12px 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.candidate-card{min-width:0;border:1px solid var(--line);border-radius:10px;padding:12px;background:#fff;scroll-margin:14px}.candidate-card.selected{border:2px solid var(--accent);padding:11px;background:#f7faf5}.candidate-choice{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;text-align:left;width:100%;border:0;border-radius:6px;padding:6px;box-shadow:none!important;background:transparent!important}.candidate-name{font-size:.88rem;font-weight:700;overflow-wrap:anywhere;flex:1 1 auto}.candidate-population{font-size:clamp(.9rem,2.1vw,1.15rem);letter-spacing:-.02em}.status{display:block;font-size:.77rem;font-weight:650;flex:1 0 100%;padding:3px 7px;border-radius:4px}.passed{color:#1a5947;background:#e5f0e7}.held{color:#70400c;background:#fff0d9}.population-bar{display:block;flex:1 0 100%;height:7px;background:#e4e8e3;border-radius:4px;margin-top:5px;overflow:hidden}.population-fill{height:100%;display:block;min-width:2px;border-radius:4px}.candidate-demand,.candidate-coordinates,.candidate-reason{font-size:.81rem;margin-top:8px;overflow-wrap:anywhere}.candidate-coordinates{color:var(--muted)}.candidate-reason{padding:7px 8px;background:#fff4e2;border-radius:5px}.candidate-technical{margin-top:8px;font-size:.77rem}.candidate-technical summary{min-height:32px}details>summary{cursor:pointer;min-height:44px;display:list-item;padding:10px 0;font-weight:600}details p{margin:6px 0 12px;font-size:.86rem;overflow-wrap:anywhere}.technical{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;overflow-wrap:anywhere}.model-details{margin-top:16px;border-top:1px solid var(--line)}.footer{margin-top:22px}.footer a+a{margin-left:18px}.error{padding:16px;border:2px solid #a82d28;background:#ffefeb;margin:16px 0;border-radius:8px;font-weight:650;overflow-wrap:anywhere}.live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:1000px){.budget-table{display:block}.budget-table caption{display:block}.budget-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.budget-table tbody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.budget-table tr{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden}.budget-table th[scope=row]{display:block;background:#edf1eb;padding:9px 12px}.budget-table td{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:.86rem;padding:8px 12px;border-bottom:1px solid #e7ebe6;white-space:nowrap}.budget-table td::before{content:attr(data-label);font-size:.75rem;white-space:normal;text-align:left;max-width:53%;font-variant-numeric:normal}.sample-layout{grid-template-columns:1fr}.local-wrap{aspect-ratio:2/1}.candidate-population{font-size:1.05rem}}
@media(max-width:640px){main{padding:20px 14px 36px}.panel{padding:16px;border-radius:10px;margin-top:18px}.stats{grid-template-columns:1fr;gap:8px}.stat{padding:13px 16px}.roadmap{grid-template-columns:repeat(2,minmax(0,1fr))}.roadmap li{padding:8px;font-size:.8rem}.region-controls,.region-summary,.page-controls{grid-template-columns:1fr}.region-buttons{gap:6px}.region-choice{padding:7px 10px;font-size:.8rem}.page-buttons{grid-template-columns:repeat(4,minmax(0,1fr))}.page-buttons button{padding:9px 5px}.sample-totals{grid-template-columns:1fr}.sample-total{display:flex;gap:8px;justify-content:space-between;align-items:baseline}.sample-total dt{max-width:65%}.sample-total dd{margin:0}.budget-table tbody{grid-template-columns:1fr}.budget-table td{font-size:.9rem}.agriculture-values{grid-template-columns:1fr}.candidate-list{grid-template-columns:1fr}.candidate-population{font-size:1.05rem}.local-wrap{aspect-ratio:1/1;min-height:260px}.map-wrap:not(.local-wrap){aspect-ratio:1.8/1}.policy-table{display:block}.policy-table caption{display:block}.policy-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.policy-table tbody{display:block}.policy-table tr{display:block;margin-top:8px;border:1px solid var(--line);border-radius:8px;overflow:hidden}.policy-table th[scope=row]{display:block;padding:8px 10px;background:#f0f4ee}.policy-table td{display:block;padding:8px 10px}.policy-table td::before{content:attr(data-label);display:block;color:var(--muted);font-size:.74rem;margin-bottom:2px}.point-legend{gap:5px 12px}.panel-head{gap:4px}.warning{padding:12px}.summary-value{font-size:1.3rem}}
@media(max-width:450px){h1{font-size:1.5rem;letter-spacing:0}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

/** Return an offline, read-only review document; reject missing or inconsistent input. */
export function buildL2SettlementReview(data) {
  const validated = validateReviewData(data);
  const json = JSON.stringify(validated).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light">
<title>集落候補と農地の見積もり</title>
<style>${REVIEW_STYLE}</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">L1 代表地域 · L2へ進むための確認</p>
<h1>集落候補と農地の見積もり</h1>
<p id="minimum-policy" class="lead">町・都市の最小規模は更新後の仮定です。点は仮候補、土地は未確保です。</p>
<p class="small lead">保存されたL1の高さと水域から集落候補を選別しています。地域を選び、人数と必要農地を確認できます。</p>
<div class="warning"><strong>現在は広域条件で選んだ候補まで</strong>敷地・農地・接続道路はL2で具体化します。水源と洪水条件の確認もこれからです。</div>
<ol class="roadmap" aria-label="開発段階">
<li>1 · L0/L1の統計<span>人口と集落数を配分</span></li>
<li>2 · この地域の候補<span>仮の人口と候補点</span></li>
<li class="current" aria-current="step">3 · L1で候補を選別<span>現在：通過・保留を確認</span></li>
<li>4 · L2の敷地<span>土地・建物・道路はこれから</span></li>
</ol>
</header>
<div id="l2-error" class="error" role="alert" hidden></div>
<noscript><p class="error">このHTMLはJavaScriptを有効にして開いてください。データと表示処理はファイル内に含まれ、外部通信は不要です。</p></noscript>
<section aria-label="全球の人口統計">
<dl class="stats">
<div class="stat"><dt>要求人口</dt><dd><span id="census-requested" class="stat-number">—</span><span class="unit">人</span></dd></div>
<div class="stat"><dt>L0での割り当て人口</dt><dd><span id="census-supported" class="stat-number">—</span><span class="unit">人</span></dd></div>
<div class="stat"><dt>容量で割り当てられない人口</dt><dd><span id="census-unplaced" class="stat-number">—</span><span class="unit">人</span></dd></div>
</dl>
<p class="small" style="margin-top:8px">全球の人口統計です。候補ページの「保留」「対象外」は、この容量の値とは別です。</p>
</section>
<section class="panel" aria-labelledby="global-title">
<div class="panel-head"><h2 id="global-title">L1 全球の人口密度</h2><p class="small">番号が、今回保存した代表地域</p></div>
<p id="global-total" class="small" style="margin-bottom:8px;white-space:pre-line"></p><p class="small" style="margin-bottom:12px">未配分はL0親に保持しています。<a href="distribution.html">L0とL1の分布を比較</a></p>
<figure>
<div class="map-wrap"><canvas id="world-map" tabindex="0" role="group" aria-label="L1全球人口密度" aria-describedby="world-help">代表地域は下の選択欄から選べます。</canvas></div>
<figcaption class="map-caption small">密度＝人口 ÷ 各セルの実面積（人/km²）。横は経度0–360°、縦はsin緯度で面積を反映しています。上が北です。</figcaption>
</figure>
<div class="density-legend" aria-label="人口密度の凡例">
<span><i class="swatch" style="background:#f0f0e8"></i>人口0の陸地</span><span><i class="swatch" style="background:#e8edc8"></i>1未満</span><span><i class="swatch" style="background:#b8d5a0"></i>1–10未満</span><span><i class="swatch" style="background:#73af87"></i>10–50未満</span><span><i class="swatch" style="background:#34847b"></i>50–200未満</span><span><i class="swatch" style="background:#286375"></i>200–1,000未満</span><span><i class="swatch" style="background:#253b65"></i>1,000以上</span><span><i class="swatch" style="background:#d6e6ef"></i>海</span><span><i class="swatch" style="background:#78b1c9"></i>湖</span>
</div>
<p id="world-help" class="small" style="margin-top:10px">番号の地点か地域名を選択。地図にフォーカスして矢印キーでも切り替えられます。候補を保存したのは代表地域だけで、ほかのセルの候補はこのHTMLにありません。</p>
<div class="region-controls"><div><label class="field-label" for="region-select">代表地域を選ぶ</label><select id="region-select"></select></div><div id="region-buttons" class="region-buttons" role="group" aria-label="代表地域の一覧"></div></div>
</section>
<section class="panel" aria-labelledby="region-name">
<p class="eyebrow">選択した代表地域</p><h2 id="region-name">—</h2>
<div class="region-summary"><div class="summary-block"><p class="summary-label">この地域の人口</p><p><strong id="region-population" class="region-person">—</strong> 人</p><p id="region-counts" class="small">—</p></div><div class="summary-block"><p class="summary-label">必要耕地の面積見積もり</p><p id="region-area" class="summary-value">—</p><p class="small">需要の数値 · 土地は未確保</p></div></div>
<p class="small" style="margin-top:10px">「村」の数には、100人未満の小集落も含みます。</p>
<h3 style="margin-top:22px">確認用に保存したページ</h3>
<p class="small">全ページを保存したものではありません。先頭・次・末尾などの代表ページを切り替えます。ボタンは保存分の中を移動し、保存されていない候補を新しく調査しません。</p>
<div class="page-controls"><div><label class="field-label" for="saved-page-select">保存ページを選ぶ</label><select id="saved-page-select"></select></div><div class="page-buttons" role="group" aria-label="保存ページの移動"><button id="page-first" type="button" aria-label="保存分の先頭ページ">先頭</button><button id="page-prev" type="button" aria-label="一つ前の保存ページ">前</button><button id="page-next" type="button" aria-label="次の保存ページ">次</button><button id="page-last" type="button" aria-label="保存分の末尾ページ">末尾</button></div></div>
<p id="page-range" class="range">—</p><p id="page-position" class="small">—</p>
<dl class="sample-totals"><div class="sample-total"><dt>広域条件を通過</dt><dd><span id="page-passed">—</span> 件</dd></div><div class="sample-total"><dt>地形条件で保留</dt><dd><span id="page-held">—</span> 件</dd></div><div class="sample-total"><dt>このページの対象外</dt><dd><span id="page-unvisited">—</span> 件</dd></div></dl>
<p class="explanation"><strong>通過</strong>：広域条件を満たした仮候補。敷地は未成立です。<br><strong>保留</strong>：地形条件が解決していない候補。理由は各候補に表示します。<br><strong>このページの対象外</strong>：地域全体から今回の候補を除いた分。他の保存ページで調べた候補も含みます。</p>
<table class="budget-table" role="table" aria-describedby="budget-help"><caption>地域に割り当てた人口と集落数の内訳（整数）</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">項目</th><th scope="col" role="columnheader">地域全体<br>総計</th><th scope="col" role="columnheader">今回<br>調査した候補</th><th scope="col" role="columnheader">広域条件を通過</th><th scope="col" role="columnheader">地形条件で保留</th><th scope="col" role="columnheader">このページの対象外</th></tr></thead><tbody id="budget-body" role="rowgroup"></tbody></table>
<p id="budget-help" class="small" style="margin-top:10px">7項目とも「今回＝通過＋保留」「地域全体＝今回＋このページの対象外」です。別ページへ移動すると「今回」の範囲が変わります。表示操作で人口や配分は変更しません。</p>
<div class="agriculture"><h3>農地需要 · 面積の見積もり</h3><p id="agriculture-state" class="small">—</p><dl id="agriculture-values" class="agriculture-values"></dl><p class="small" style="margin-top:10px">通過分も保留分も「必要になる面積」です。確保できた面積ではありません。「見積もり不明」は0 m²を意味しません。未調査分は地域全体から今回を差し引いた値で、いずれかの見積もりが不明なら表示できません。</p></div>
</section>
<section class="panel" aria-labelledby="local-title">
<div class="sample-layout"><div><h2 id="local-title">地域の境界と候補点</h2><p class="small">このページの仮候補だけを描いた座標図です。詳細地形・道路・農地は含みません。縦横の距離比は模式的です。</p><figure><div class="map-wrap local-wrap"><canvas id="local-map" tabindex="0" role="group" aria-label="地域の境界と候補点" aria-describedby="local-help">各候補は下の一覧から選べます。</canvas></div><figcaption class="small map-caption">○系＝村・小集落、△＝町、◇＝都市。塗りつぶし＝通過、白抜き＋×＝保留。外側の二重円＝選択中。</figcaption></figure><div class="point-legend" aria-label="候補点の凡例"><span>● 村・小集落</span><span>▲ 町</span><span>◆ 都市</span><span>塗りつぶし：通過</span><span>白抜き＋×：保留</span></div><p id="local-help" class="small" style="margin-top:10px">点と一覧は連動します。地図にフォーカスし矢印キーで候補選択、Home/Endで先頭/末尾、Enterで選択候補のボタンへ移動できます。</p></div>
<div><h2>仮の規模モデルと候補人口</h2><p class="small">仮定の下限・上限と、このページに保存された候補の人口範囲を分けて表示します。候補人口は生成結果の数値で、現地の人口調査ではありません。</p><table class="policy-table" role="table"><caption>規模の仮定と、このページの値</caption><thead role="rowgroup"><tr role="row"><th scope="col">種類</th><th scope="col">モデルの下限–上限</th><th scope="col">このページの候補人口</th></tr></thead><tbody id="policy-body" role="rowgroup"></tbody></table><details class="model-details"><summary>モデル仮定と制限</summary><p id="policy-means"></p><p>モデルの下限・上限・平均は規模の仮定です。人口の端数配分や小集落の扱いを含む候補値とは区別し、画面では再生成・補正しません。村には100人未満の小集落も含まれます。</p><p>この調査は保存された代表地域・代表ページの標本です。世界全体の住宅完成率や、すべての候補の合否を示すものではありません。広域条件の通過後も、L2の区画、建物、耕地、道路、洪水・飲料水の確認が必要です。</p></details></div></div>
<h3 style="margin-top:22px">このページの候補一覧</h3><p class="small">カード内の棒は候補人口の比較です。このページの最大人口を100%とし、種類によらず同じ目盛りを使います。通過・保留の両方を含みます。</p><p id="candidate-current" class="small" style="margin-top:8px">—</p><p id="candidate-empty" class="small" hidden>このページに候補はありません。</p><ol id="candidate-list" class="candidate-list"></ol>
</section>
<section class="panel" aria-label="技術情報と結果ファイル"><details><summary>技術ID・座標・表示上の制限</summary><p id="source-info" class="technical"></p><p id="region-technical" class="technical"></p><p>全球グリッドは行優先、北から南、経度0–360°です。地域の局所図は西端から経度を巻き戻して投影し、日付変更線や0°をまたぐ境界にも対応します。L1への配分が残っている場合、全球図のセル人口合計は上部の割り当て人口を下回ることがあります。</p><p>候補slotは入力の0始まり／1始まりを保持し、画面の「候補」番号はoffsetに基づく1始まりです。農地はm²またはkm²の数値見積もりで、土地の取得や面積の成立を保証しません。画面解像度や選択操作で保存データは変更しません。</p></details><p class="footer small"><a href="manifest.json">manifest.json を開く</a><a href="summary.json">summary.json を開く</a></p></section>
<div id="selection-live" class="live" role="status" aria-live="polite" aria-atomic="true"></div>
</main>
<script id="l2-review-data" type="application/json">${json}</script>
<script>(${l2ReviewRuntime.toString()})(JSON.parse(document.getElementById('l2-review-data').textContent));</script>
</body>
</html>`;
}
