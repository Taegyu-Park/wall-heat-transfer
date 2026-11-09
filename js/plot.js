// 의존성 없는 SVG 그리기 도우미
const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function text(parent, x, y, str, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

export function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }

function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export function niceTicks(min, max, count = 5) {
  if (!(max > min)) { max = min + 1; }
  const step = niceNum(niceNum(max - min, false) / (count - 1), true);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function niceDomain(values, padFrac = 0.08) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

// 온도 색상: 차가움(파랑) → 따뜻함(빨강)
const STOPS = [[44, 123, 182], [118, 180, 214], [236, 236, 196], [250, 170, 100], [215, 48, 39]];
export function tempColor(T, lo, hi) {
  let u = (T - lo) / (hi - lo || 1);
  u = Math.min(1, Math.max(0, u)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(u)), f = u - i;
  const c = STOPS[i].map((v, j) => Math.round(v + (STOPS[i + 1][j] - v) * f));
  return `rgb(${c.join(',')})`;
}

// 12px 글꼴 기준 대략적인 글자 폭 (숨겨진 탭에서도 동작하도록 측정 대신 추정)
export const textWidth = s => [...s].reduce((w, c) => w + (/[ㄱ-힝]/.test(c) ? 12 : 6.8), 0);

export const fmt =(v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

/**
 * 범용 선 그래프
 * cfg: { width, height, x:{domain,label,ticks,format}, y:{domain,label}, series:[{points,color,dash,width,label}], vline, legend }
 */
export function lineChart(svg, cfg) {
  const W = cfg.width ?? 760, H = cfg.height ?? 270;
  const m = { l: 56, r: 16, t: 34, b: 42, ...cfg.margin };
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const [x0, x1] = cfg.x.domain, [y0, y1] = cfg.y.domain;
  const sx = v => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = v => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const g = el('g', {}, svg);
  for (const t of niceTicks(y0, y1, 5)) {
    el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: 'grid' }, g);
    text(g, m.l - 6, sy(t) + 4, cfg.y.format ? cfg.y.format(t) : String(t), { class: 'tick', 'text-anchor': 'end' });
  }
  for (const t of cfg.x.ticks ?? niceTicks(x0, x1, 7)) {
    el('line', { x1: sx(t), x2: sx(t), y1: H - m.b, y2: H - m.b + 4, class: 'axis' }, g);
    text(g, sx(t), H - m.b + 17, cfg.x.format ? cfg.x.format(t) : String(t), { class: 'tick', 'text-anchor': 'middle' });
  }
  el('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }, g);
  if (y0 < 0 && y1 > 0) el('line', { x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0), class: 'zero' }, g);
  if (cfg.x.label) text(g, (m.l + W - m.r) / 2, H - 6, cfg.x.label, { class: 'axlabel', 'text-anchor': 'middle' });
  if (cfg.y.label) text(g, 14, (m.t + H - m.b) / 2, cfg.y.label,
    { class: 'axlabel', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` });

  for (const s of cfg.series) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width ?? 2.2,
      'stroke-dasharray': s.dash, 'stroke-linejoin': 'round' }, g);
  }

  const vl = el('g', {}, svg);
  function setVline(v) {
    clear(vl);
    if (v == null) return;
    el('line', { x1: sx(v), x2: sx(v), y1: m.t, y2: H - m.b, class: 'vline' }, vl);
    for (const s of cfg.series) {
      if (!s.marker) continue;
      const y = s.valueAt(v);
      el('circle', { cx: sx(v), cy: sy(y), r: 4, fill: s.color, class: 'dot' }, vl);
    }
  }
  setVline(cfg.vline);

  if (cfg.legend !== false) {
    let lx = m.l;
    for (const s of cfg.series.filter(s => s.label)) {
      el('line', { x1: lx, x2: lx + 18, y1: 14, y2: 14, stroke: s.color, 'stroke-width': 2.5, 'stroke-dasharray': s.dash }, svg);
      text(svg, lx + 23, 18, s.label, { class: 'legend' });
      lx += 36 + textWidth(s.label);
    }
  }
  return { sx, sy, setVline };
}
