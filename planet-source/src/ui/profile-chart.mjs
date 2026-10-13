// Cross-section / longitudinal profile chart (canvas). Plots the ground line,
// the bed under water, the water surface, the pre-earthwork ground where roads
// cut or fill, and the road grade/bridge deck coloured by structure kind.
//
// Profiles come from `scene.lineProfile(a, b)` or `scene.roadPathProfile(id)`:
// `{ kind, label, lengthM, samples: [{ distanceM, xM, yM, groundElevationM,
//   waterSurfaceElevationM, waterDepthM, roadElevationM?, structureKind?,
//   baseGroundElevationM?, clearanceM? }], bridges? }`.

import { clamp, niceTicks, formatNumber, formatMeters, formatDistance, fitCanvas, STRUCTURE_COLORS, cssVar } from './util.mjs';

const MARGIN = { left: 58, right: 16, top: 22, bottom: 30 };

/** Index of the sample nearest to `distanceM` (samples sorted by distance). */
export function nearestSampleIndex(samples, distanceM) {
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid].distanceM < distanceM) lo = mid; else hi = mid; }
  return Math.abs(samples[lo].distanceM - distanceM) <= Math.abs(samples[hi].distanceM - distanceM) ? lo : hi;
}

/**
 * Tag cross-section samples that fall on a road, pad or batter using the
 * scene's structure classifier, so arbitrary lines show decks and pads too.
 */
export function annotateLineProfile(scene, profile) {
  for (const p of profile.samples) {
    const sample = { groundElevationM: p.groundElevationM, waterDepthM: p.waterDepthM,
      roadAdjustmentId: p.baseGroundElevationM !== undefined ? scene.roadAdjustmentId : null, waterSourceIds: [] };
    const s = scene.structureAt(p.xM, p.yM, sample);
    p.structureKind = s.structureKind;
    p.featureId = s.featureId ?? null;
    if (s.structureKind === 'bridge-deck') p.roadElevationM = s.roadElevationApproxM;
    else if (['at-grade', 'cut', 'fill', 'approach-ramp'].includes(s.structureKind)) p.roadElevationM = p.groundElevationM;
    else if (s.structureKind === 'building-pad') p.padElevationM = s.padElevationM;
  }
  return profile;
}

/** Elevation extent of the samples whose distance lies in [x0, x1]. */
export function profileExtent(samples, x0, x1, deckThicknessM = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const p of samples) {
    if (p.distanceM < x0 || p.distanceM > x1) continue;
    for (const v of [p.groundElevationM, p.waterSurfaceElevationM, p.baseGroundElevationM, p.padElevationM]) {
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (Number.isFinite(p.roadElevationM)) {
      hi = Math.max(hi, p.roadElevationM);
      lo = Math.min(lo, p.roadElevationM - (p.structureKind === 'bridge-deck' ? deckThicknessM : 0));
    }
  }
  if (!Number.isFinite(lo)) return { minM: 0, maxM: 1 };
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  const pad = (hi - lo) * 0.1;
  return { minM: lo - pad, maxM: hi + pad };
}

export class ProfileChart {
  constructor(canvas, { onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onHover = onHover;
    this.profile = null;
    this.extras = { crossings: [] };
    this.range = null;
    this.hoverIndex = null;
    this.externalDistance = null;
    this.drag = null;
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.render()) : null;
    this.resizeObserver?.observe(canvas);
    this.bindEvents();
  }

  /** Show a profile; `extras.crossings` adds required-deck lines; `range` zooms in [fromM, toM]. */
  setProfile(profile, { crossings = [], range = null } = {}) {
    this.profile = profile;
    this.extras = { crossings };
    this.hoverIndex = null;
    this.setRange(range);
  }
  clear() { this.profile = null; this.render(); }
  setRange(range) {
    const L = this.profile?.lengthM ?? 1;
    this.range = range ? { x0: clamp(range.fromM ?? range.x0, 0, L), x1: clamp(range.toM ?? range.x1, 0, L) } : { x0: 0, x1: L };
    if (this.range.x1 - this.range.x0 < 1e-3) this.range = { x0: 0, x1: L };
    this.render();
  }
  /** Show a crosshair at a distance driven from elsewhere (e.g. map hover). */
  setExternalDistance(distanceM) { this.externalDistance = distanceM; this.render(); }

  get deckThicknessM() {
    const t = this.profile?.bridges?.map(b => b.design?.deckThicknessM).filter(Number.isFinite) ?? [];
    return t.length ? Math.max(...t) : 0;
  }

  layout() {
    const { width, height, ratio } = fitCanvas(this.canvas);
    const plot = { x: MARGIN.left, y: MARGIN.top, w: Math.max(10, width - MARGIN.left - MARGIN.right), h: Math.max(10, height - MARGIN.top - MARGIN.bottom) };
    const { x0, x1 } = this.range, ext = profileExtent(this.profile.samples, x0, x1, this.deckThicknessM);
    const sx = d => plot.x + (d - x0) / (x1 - x0) * plot.w;
    const sy = z => plot.y + plot.h - (z - ext.minM) / (ext.maxM - ext.minM) * plot.h;
    const invX = px => x0 + (px - plot.x) / plot.w * (x1 - x0);
    return { width, height, ratio, plot, ext, sx, sy, invX };
  }

  render() {
    const ctx = this.ctx, { width, height, ratio } = fitCanvas(this.canvas);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = cssVar('--panel-bg', '#11161d');
    ctx.fillRect(0, 0, width, height);
    if (!this.profile?.samples?.length) {
      ctx.fillStyle = cssVar('--text-dim', '#8b949e'); ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Shift+drag on the map (or use the Profile tool) to draw a cross-section, or click a road.', width / 2, height / 2);
      ctx.textAlign = 'start';
      return;
    }
    const L = this.layout();
    this.lastLayout = L;
    const { plot, sx, sy, ext } = L, samples = this.profile.samples, { x0, x1 } = this.range;
    const visible = samples.filter((p, i) => (p.distanceM >= x0 && p.distanceM <= x1)
      || (samples[i + 1] && samples[i + 1].distanceM >= x0 && p.distanceM < x0) || (samples[i - 1] && samples[i - 1].distanceM <= x1 && p.distanceM > x1));

    this.drawAxes(L);
    ctx.save();
    ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();

    // Ground body.
    const ground = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    ground.addColorStop(0, 'rgba(150,120,86,0.85)'); ground.addColorStop(1, 'rgba(70,54,40,0.85)');
    ctx.beginPath();
    visible.forEach((p, i) => i ? ctx.lineTo(sx(p.distanceM), sy(p.groundElevationM)) : ctx.moveTo(sx(p.distanceM), sy(p.groundElevationM)));
    ctx.lineTo(sx(visible.at(-1).distanceM), plot.y + plot.h); ctx.lineTo(sx(visible[0].distanceM), plot.y + plot.h); ctx.closePath();
    ctx.fillStyle = ground; ctx.fill();

    // Water: fill between bed and surface on wet runs.
    const runs = [];
    let run = null;
    for (const p of visible) {
      if (Number.isFinite(p.waterSurfaceElevationM) && p.waterSurfaceElevationM > p.groundElevationM) { (run ??= []).push(p); }
      else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    for (const r of runs) {
      ctx.beginPath();
      r.forEach((p, i) => i ? ctx.lineTo(sx(p.distanceM), sy(p.waterSurfaceElevationM)) : ctx.moveTo(sx(p.distanceM), sy(p.waterSurfaceElevationM)));
      for (let i = r.length - 1; i >= 0; i--) ctx.lineTo(sx(r[i].distanceM), sy(r[i].groundElevationM));
      ctx.closePath(); ctx.fillStyle = 'rgba(64,150,230,0.55)'; ctx.fill();
      ctx.beginPath();
      r.forEach((p, i) => i ? ctx.lineTo(sx(p.distanceM), sy(p.waterSurfaceElevationM)) : ctx.moveTo(sx(p.distanceM), sy(p.waterSurfaceElevationM)));
      ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 1.6; ctx.stroke();
      // Bed.
      ctx.beginPath();
      r.forEach((p, i) => i ? ctx.lineTo(sx(p.distanceM), sy(p.groundElevationM)) : ctx.moveTo(sx(p.distanceM), sy(p.groundElevationM)));
      ctx.strokeStyle = '#3a5f86'; ctx.lineWidth = 3; ctx.stroke();
    }

    // Pre-earthwork ground.
    if (visible.some(p => Number.isFinite(p.baseGroundElevationM))) {
      ctx.beginPath();
      let pen = false;
      for (const p of visible) {
        const z = p.baseGroundElevationM ?? p.groundElevationM;
        pen ? ctx.lineTo(sx(p.distanceM), sy(z)) : ctx.moveTo(sx(p.distanceM), sy(z)); pen = true;
      }
      ctx.strokeStyle = 'rgba(230,220,200,0.7)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Ground line.
    ctx.beginPath();
    visible.forEach((p, i) => i ? ctx.lineTo(sx(p.distanceM), sy(p.groundElevationM)) : ctx.moveTo(sx(p.distanceM), sy(p.groundElevationM)));
    ctx.strokeStyle = '#d8b58a'; ctx.lineWidth = 1.6; ctx.stroke();

    // Building pads on cross-sections.
    for (let i = 1; i < visible.length; i++) {
      const a = visible[i - 1], b = visible[i];
      if (Number.isFinite(a.padElevationM) && Number.isFinite(b.padElevationM)) {
        ctx.beginPath(); ctx.moveTo(sx(a.distanceM), sy(a.padElevationM)); ctx.lineTo(sx(b.distanceM), sy(b.padElevationM));
        ctx.strokeStyle = STRUCTURE_COLORS['building-pad']; ctx.lineWidth = 4; ctx.stroke();
      }
    }

    this.drawRoad(L, visible);
    this.drawCrossings(L);
    ctx.restore();

    this.drawLegend(L);
    const hover = this.hoverIndex ?? (this.externalDistance !== null && this.externalDistance !== undefined
      ? nearestSampleIndex(samples, this.externalDistance) : null);
    if (hover !== null && samples[hover]) this.drawHover(L, samples[hover]);
    // Title / VE.
    const xScale = plot.w / (x1 - x0), yScale = plot.h / (ext.maxM - ext.minM);
    ctx.fillStyle = cssVar('--text', '#e6edf3'); ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${this.profile.label} · ${formatDistance(this.profile.lengthM)}`, plot.x, 14);
    ctx.fillStyle = cssVar('--text-dim', '#8b949e'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`vertical exaggeration ×${formatNumber(yScale / xScale, yScale / xScale >= 10 ? 0 : 1)}`, plot.x + plot.w, 14);
    ctx.textAlign = 'start';
  }

  drawAxes({ plot, sx, sy, ext }) {
    const ctx = this.ctx, { x0, x1 } = this.range;
    ctx.strokeStyle = 'rgba(140,150,165,0.18)'; ctx.lineWidth = 1;
    ctx.fillStyle = cssVar('--text-dim', '#8b949e'); ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const z of niceTicks(ext.minM, ext.maxM, Math.max(3, Math.floor(plot.h / 34)))) {
      const y = Math.round(sy(z)) + 0.5;
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      ctx.fillText(`${formatNumber(z, Math.abs(z) < 10 ? 1 : 0)} m`, plot.x - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const d of niceTicks(x0, x1, Math.max(3, Math.floor(plot.w / 90)))) {
      const x = Math.round(sx(d)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      ctx.fillText(formatDistance(d), x, plot.y + plot.h + 6);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'rgba(140,150,165,0.5)';
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w, plot.h);
  }

  drawRoad({ sx, sy }, visible) {
    const ctx = this.ctx, thickness = this.deckThicknessM;
    for (let i = 1; i < visible.length; i++) {
      const a = visible[i - 1], b = visible[i];
      if (!Number.isFinite(a.roadElevationM) || !Number.isFinite(b.roadElevationM)) continue;
      const kind = a.segmentKind ?? (a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' ? 'bridge-deck'
        : a.structureKind === 'bridge-deck' ? b.structureKind : a.structureKind);
      if (kind === 'bridge-deck') {
        const t = thickness || 0.8;
        ctx.beginPath();
        ctx.moveTo(sx(a.distanceM), sy(a.roadElevationM)); ctx.lineTo(sx(b.distanceM), sy(b.roadElevationM));
        ctx.lineTo(sx(b.distanceM), sy(b.roadElevationM - t)); ctx.lineTo(sx(a.distanceM), sy(a.roadElevationM - t)); ctx.closePath();
        ctx.fillStyle = 'rgba(242,184,75,0.85)'; ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(sx(a.distanceM), sy(a.roadElevationM)); ctx.lineTo(sx(b.distanceM), sy(b.roadElevationM));
      ctx.strokeStyle = STRUCTURE_COLORS[kind] ?? STRUCTURE_COLORS['at-grade']; ctx.lineWidth = kind === 'bridge-deck' ? 2.5 : 2.2; ctx.stroke();
    }
    // Abutments and minimum clearance per bridge (road profiles).
    for (const bridge of this.profile.bridges ?? []) {
      const t = bridge.design?.deckThicknessM ?? thickness;
      for (const d of [bridge.startDistanceM, bridge.endDistanceM]) {
        const i = nearestSampleIndex(this.profile.samples, d), p = this.profile.samples[i];
        ctx.beginPath(); ctx.moveTo(sx(d), sy(p.roadElevationM - t)); ctx.lineTo(sx(d), sy(p.groundElevationM));
        ctx.strokeStyle = '#c99a3c'; ctx.lineWidth = 3; ctx.stroke();
      }
      let min = null;
      for (const p of this.profile.samples) {
        if (p.distanceM < bridge.startDistanceM || p.distanceM > bridge.endDistanceM || !Number.isFinite(p.clearanceM)) continue;
        if (!min || p.clearanceM < min.clearanceM) min = p;
      }
      if (min && Number.isFinite(min.waterSurfaceElevationM)) {
        const x = sx(min.distanceM), top = sy(min.roadElevationM - t), bottom = sy(min.waterSurfaceElevationM);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        ctx.moveTo(x - 4, top + 4); ctx.lineTo(x, top); ctx.lineTo(x + 4, top + 4);
        ctx.moveTo(x - 4, bottom - 4); ctx.lineTo(x, bottom); ctx.lineTo(x + 4, bottom - 4); ctx.stroke();
        ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#fff';
        ctx.fillText(`clearance ${formatMeters(min.clearanceM)}`, x + 6, (top + bottom) / 2);
      }
    }
  }

  drawCrossings({ sx, sy }) {
    const ctx = this.ctx;
    for (const c of this.extras.crossings) {
      if (!Number.isFinite(c.requiredDeckElevationM)) continue;
      const y = sy(c.requiredDeckElevationM);
      ctx.beginPath(); ctx.moveTo(sx(c.startDistanceM), y); ctx.lineTo(sx(c.endDistanceM), y);
      ctx.strokeStyle = '#ff9e64'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ff9e64'; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('required deck', sx(c.startDistanceM) - 4, y - 3); ctx.textAlign = 'start';
    }
  }

  drawLegend({ plot }) {
    const ctx = this.ctx, samples = this.profile.samples;
    const items = [['Ground', '#d8b58a']];
    if (samples.some(p => Number.isFinite(p.waterSurfaceElevationM))) items.push(['Water surface', '#7cc4ff'], ['Bed', '#3a5f86']);
    if (samples.some(p => Number.isFinite(p.baseGroundElevationM))) items.push(['Pre-earthwork', 'rgba(230,220,200,0.8)']);
    const kinds = new Set(samples.filter(p => Number.isFinite(p.roadElevationM)).map(p => p.structureKind));
    for (const k of ['at-grade', 'cut', 'fill', 'approach-ramp', 'bridge-deck']) if (kinds.has(k)) items.push([k, STRUCTURE_COLORS[k]]);
    if (samples.some(p => Number.isFinite(p.padElevationM))) items.push(['building pad', STRUCTURE_COLORS['building-pad']]);
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    let x = plot.x + 8;
    const y = plot.y + 10;
    for (const [name, color] of items) {
      const w = ctx.measureText(name).width;
      if (x + w + 24 > plot.x + plot.w) break;
      ctx.fillStyle = color; ctx.fillRect(x, y - 2, 12, 4);
      ctx.fillStyle = cssVar('--text', '#e6edf3'); ctx.fillText(name, x + 16, y);
      x += w + 30;
    }
    ctx.textBaseline = 'alphabetic';
  }

  drawHover({ plot, sx, sy }, p) {
    const ctx = this.ctx, x = sx(p.distanceM);
    if (x < plot.x || x > plot.x + plot.w) return;
    ctx.strokeStyle = 'rgba(255,216,102,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, plot.y); ctx.lineTo(x + 0.5, plot.y + plot.h); ctx.stroke();
    const dot = (z, color) => { if (!Number.isFinite(z)) return; ctx.beginPath(); ctx.arc(x, sy(z), 3.5, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); };
    dot(p.groundElevationM, '#d8b58a'); dot(p.waterSurfaceElevationM, '#7cc4ff'); dot(p.roadElevationM, '#ffffff');
    const lines = [`station ${formatDistance(p.distanceM)}`, `ground ${formatMeters(p.groundElevationM)}`];
    if (Number.isFinite(p.waterSurfaceElevationM)) lines.push(`water ${formatMeters(p.waterSurfaceElevationM)} (depth ${formatMeters(p.waterDepthM)})`);
    if (Number.isFinite(p.baseGroundElevationM)) lines.push(`pre-earthwork ${formatMeters(p.baseGroundElevationM)}`);
    if (Number.isFinite(p.roadElevationM)) lines.push(`road ${formatMeters(p.roadElevationM)} · ${p.structureKind}`);
    else if (p.structureKind && p.structureKind !== 'natural-ground') lines.push(p.structureKind);
    if (Number.isFinite(p.clearanceM)) lines.push(`clearance ${formatMeters(p.clearanceM)}`);
    if (Number.isFinite(p.gradeSlope)) lines.push(`grade ${formatNumber(p.gradeSlope * 100, 2)} %`);
    ctx.font = '11px system-ui, sans-serif';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, h = lines.length * 15 + 8;
    const bx = x + 12 + w > plot.x + plot.w ? x - 12 - w : x + 12, by = plot.y + 22;
    ctx.fillStyle = 'rgba(13,17,23,0.92)'; ctx.strokeStyle = 'rgba(140,150,165,0.5)';
    ctx.fillRect(bx, by, w, h); ctx.strokeRect(bx + 0.5, by + 0.5, w, h);
    ctx.fillStyle = '#e6edf3'; ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 5 + i * 15));
    ctx.textBaseline = 'alphabetic';
  }

  bindEvents() {
    const c = this.canvas;
    const local = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointermove', e => {
      if (!this.profile || !this.lastLayout) return;
      const p = local(e), L = this.lastLayout;
      if (this.drag) {
        const dx = (p.x - this.drag.x) / L.plot.w * (this.drag.range.x1 - this.drag.range.x0);
        const span = this.drag.range.x1 - this.drag.range.x0, total = this.profile.lengthM;
        const x0 = clamp(this.drag.range.x0 - dx, 0, total - span);
        this.range = { x0, x1: x0 + span };
      }
      const inside = p.x >= L.plot.x && p.x <= L.plot.x + L.plot.w;
      this.hoverIndex = inside ? nearestSampleIndex(this.profile.samples, L.invX(p.x)) : null;
      this.externalDistance = null;
      this.render();
      this.onHover?.(this.hoverIndex === null ? null : this.profile.samples[this.hoverIndex]);
    });
    c.addEventListener('pointerleave', () => { this.hoverIndex = null; this.drag = null; this.render(); this.onHover?.(null); });
    c.addEventListener('pointerdown', e => { if (this.profile) { c.setPointerCapture(e.pointerId); this.drag = { x: local(e).x, range: { ...this.range } }; } });
    c.addEventListener('pointerup', () => { this.drag = null; });
    c.addEventListener('wheel', e => {
      if (!this.profile || !this.lastLayout) return;
      e.preventDefault();
      const L = this.lastLayout, at = L.invX(local(e).x), total = this.profile.lengthM;
      const k = Math.exp(e.deltaY * 0.0015), span = clamp((this.range.x1 - this.range.x0) * k, Math.min(total, 2), total);
      const f = (at - this.range.x0) / (this.range.x1 - this.range.x0);
      const x0 = clamp(at - f * span, 0, total - span);
      this.range = { x0, x1: x0 + span };
      this.render();
    }, { passive: false });
    c.addEventListener('dblclick', () => this.setRange(null));
  }

  destroy() { this.resizeObserver?.disconnect(); }
}
