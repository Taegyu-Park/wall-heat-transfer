import { MATERIALS, PRESETS, steadyState, periodicResponse, parallelBridge, dominantLayerIndex } from './physics.js';
import { el, text, clear, lineChart, niceTicks, niceDomain, tempColor, fmt, textWidth } from './plot.js';

const $ = s => document.querySelector(s);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ───────────────── 상태 ─────────────────
let uid = 0;
const state = {
  layers: [],
  bc: { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 },
  tr: { Tmean: 30, Tamp: 7, peakHour: 15, t: 15, playing: false },
  par: { frac: 0.05, mat: 'concrete' },
  tab: 'steady',
};

function makeLayer({ mat, L, ...over }) {
  const m = MATERIALS[mat];
  return { uid: ++uid, mat, L, k: m.k, rho: m.rho, cp: m.cp, ...over };
}

function loadPreset(key) {
  const p = PRESETS[key];
  state.layers = p.layers.map(makeLayer);
  Object.assign(state.bc, p.bc);
  syncBcInputs();
  renderLayers();
  update();
}

// ───────────────── 입력 패널 ─────────────────
const matOptions = sel => Object.entries(MATERIALS)
  .map(([k, m]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${m.name}</option>`).join('');

function renderLayers() {
  const list = $('#layers');
  list.innerHTML = '';
  const n = state.layers.length;
  state.layers.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'layer';
    row.dataset.uid = l.uid;
    const mm = +(l.L * 1000).toFixed(1);
    row.innerHTML = `
      <div class="layer-head">
        <span class="swatch" style="background:${MATERIALS[l.mat].color}"></span>
        <span class="idx">${i + 1}</span>
        <select data-f="mat" aria-label="재료">${matOptions(l.mat)}</select>
        <div class="layer-btns">
          <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="바깥쪽으로">↑</button>
          <button type="button" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="안쪽으로">↓</button>
          <button type="button" data-act="del" ${n === 1 ? 'disabled' : ''} aria-label="삭제">✕</button>
        </div>
      </div>
      <div class="layer-body">
        <label>두께 <span class="unit">mm</span><input type="range" data-f="mm" min="5" max="500" step="1" value="${Math.min(mm, 500)}"></label>
        <label><input type="number" data-f="mm" min="1" max="2000" step="1" value="${mm}" aria-label="두께 mm"></label>
        <label class="full">열전도율 k <span class="unit">W/(m·K)</span>
          <input type="number" data-f="k" min="0.001" step="0.001" value="${l.k}"></label>
      </div>
      <details>
        <summary>축열 물성 (②탭에 사용)</summary>
        <div class="grid2">
          <label>밀도 ρ <span class="unit">kg/m³</span><input type="number" data-f="rho" min="0.1" step="10" value="${l.rho}"></label>
          <label>비열 c <span class="unit">J/kgK</span><input type="number" data-f="cp" min="1" step="10" value="${l.cp}"></label>
        </div>
      </details>`;
    list.appendChild(row);
  });
}

$('#layers').addEventListener('input', e => {
  const f = e.target.dataset.f;
  if (!f) return;
  const row = e.target.closest('.layer');
  const l = state.layers.find(x => x.uid === +row.dataset.uid);
  if (f === 'mat') {
    const m = MATERIALS[e.target.value];
    Object.assign(l, { mat: e.target.value, k: m.k, rho: m.rho, cp: m.cp });
    renderLayers();
  } else {
    const v = parseFloat(e.target.value);
    if (!(v > 0)) return;
    if (f === 'mm') {
      l.L = v / 1000;
      row.querySelectorAll('[data-f="mm"]').forEach(inp => { if (inp !== e.target) inp.value = v; });
    } else l[f] = v;
  }
  update();
});

$('#layers').addEventListener('click', e => {
  const act = e.target.dataset.act;
  if (!act) return;
  const i = state.layers.findIndex(x => x.uid === +e.target.closest('.layer').dataset.uid);
  const L = state.layers;
  if (act === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  if (act === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  if (act === 'del' && L.length > 1) L.splice(i, 1);
  renderLayers();
  update();
});

$('#addLayer').addEventListener('click', () => {
  state.layers.push(makeLayer({ mat: 'gypsum', L: 0.0125 }));
  renderLayers();
  update();
});
$('#reverse').addEventListener('click', () => {
  state.layers.reverse();
  renderLayers();
  update();
});

const bcIds = ['Tout', 'Tin', 'hOut', 'hIn'];
function syncBcInputs() {
  for (const id of bcIds) $('#' + id).value = state.bc[id];
  $('#surface').checked = state.bc.surface;
  $('#hbox').classList.toggle('off', !state.bc.surface);
}
for (const id of bcIds) {
  $('#' + id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || (id.startsWith('h') && v <= 0)) return;
    state.bc[id] = v;
    update();
  });
}
$('#surface').addEventListener('change', e => {
  state.bc.surface = e.target.checked;
  $('#hbox').classList.toggle('off', !state.bc.surface);
  update();
});

const presetSel = $('#preset');
presetSel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
presetSel.addEventListener('change', () => loadPreset(presetSel.value));

// 탭
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.tabpanel').forEach(p => { p.hidden = p.id !== 'tab-' + state.tab; });
  if (state.tab !== 'transient') stopPlay();
  // ②탭은 실외 온도 대신 외기 평균·일교차를 사용
  const tr = state.tab === 'transient';
  $('#Tout').disabled = tr;
  $('#Tout').title = tr ? '②탭에서는 위쪽의 외기 평균·일교차를 사용합니다' : '';
  update();
}));

// ───────────────── 벽 단면 그림 ─────────────────
/**
 * points: [{x, T}] 벽 내부 온도 (x=0 실외 표면 … Ltot 실내 표면)
 * opt: { Tout, Tin, range, ghost, q, labelInterfaces }
 */
function drawWall(svg, layers, points, opt) {
  const W = 760, H = 360, top = 46, bot = H - 66, axL = 50, airW = 74, right = W - 8;
  const wx0 = axL + airW, wx1 = right - airW, wallW = wx1 - wx0;
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // 층 폭 (얇은 층도 보이도록 최소 폭 보장)
  const Ltot = layers.reduce((s, l) => s + l.L, 0);
  const minW = 14;
  const small = layers.map(l => (l.L / Ltot) * wallW < minW);
  const restL = layers.reduce((s, l, i) => s + (small[i] ? 0 : l.L), 0);
  const fixed = small.filter(Boolean).length * minW;
  const widths = layers.map((l, i) => (small[i] || restL === 0 ? minW : (l.L / restL) * (wallW - fixed)));
  const px0 = [wx0], xm = [0];
  layers.forEach((l, i) => { px0.push(px0[i] + widths[i]); xm.push(xm[i] + l.L); });
  const X = x => {
    let i = 0;
    while (i < layers.length - 1 && x > xm[i + 1] + 1e-12) i++;
    return px0[i] + ((x - xm[i]) / layers[i].L) * widths[i];
  };
  const [lo, hi] = opt.range;
  const Y = T => bot - ((T - lo) / (hi - lo)) * (bot - top);

  // 공기 영역
  el('rect', { x: axL, y: top, width: airW, height: bot - top, class: 'air-out' }, svg);
  el('rect', { x: wx1, y: top, width: right - wx1, height: bot - top, class: 'air-in' }, svg);
  text(svg, axL + airW / 2, bot + 20, '실외 공기', { class: 'lname', 'text-anchor': 'middle' });
  text(svg, wx1 + (right - wx1) / 2, bot + 20, '실내 공기', { class: 'lname', 'text-anchor': 'middle' });

  // 층: 온도 그라데이션
  const defs = el('defs', {}, svg);
  layers.forEach((l, i) => {
    const id = `${svg.id}-g${i}`;
    const grad = el('linearGradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    const pts = points.filter(p => p.x >= xm[i] - 1e-12 && p.x <= xm[i + 1] + 1e-12);
    for (const p of pts) {
      el('stop', { offset: ((p.x - xm[i]) / l.L).toFixed(4), 'stop-color': tempColor(p.T, lo, hi) }, grad);
    }
    el('rect', { x: px0[i], y: top, width: widths[i], height: bot - top, fill: `url(#${id})` }, svg);
    el('rect', { x: px0[i], y: bot + 2, width: widths[i], height: 7, fill: MATERIALS[l.mat].color }, svg);
    el('line', { x1: px0[i], x2: px0[i], y1: top, y2: bot + 9, class: 'seg-border' }, svg);
    const cx = px0[i] + widths[i] / 2;
    const name = MATERIALS[l.mat].name;
    if (widths[i] >= textWidth(name) * 0.95 + 4) {
      text(svg, cx, bot + 24, name, { class: 'lname', 'text-anchor': 'middle' });
      text(svg, cx, bot + 38, `${+(l.L * 1000).toFixed(1)} mm`, { class: 'lsub', 'text-anchor': 'middle' });
    } else {
      text(svg, cx, bot + 24, String(i + 1), { class: 'lname', 'text-anchor': 'middle' });
    }
  });

  // 온도 축
  for (const t of niceTicks(lo, hi, 6)) {
    el('line', { x1: axL, x2: right, y1: Y(t), y2: Y(t), class: 'grid', opacity: 0.6 }, svg);
    text(svg, axL - 6, Y(t) + 4, `${t}`, { class: 'tick', 'text-anchor': 'end' });
  }
  text(svg, 13, (top + bot) / 2, '온도 (℃)', { class: 'axlabel', 'text-anchor': 'middle', transform: `rotate(-90 13 ${(top + bot) / 2})` });

  // 온도 곡선: 실외 공기 → (경계층) → 벽 → (경계층) → 실내 공기
  const bl = 24;
  const Tso = points[0].T, Tsi = points[points.length - 1].T;
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const line = (pts, Tout) => [
    [axL, Y(Tout)], [wx0 - bl, Y(Tout)], [wx0, Y(pts[0].T)],
    ...pts.map(p => [X(p.x), Y(p.T)]),
    [wx1, Y(pts[pts.length - 1].T)], [wx1 + bl, Y(opt.Tin)], [right, Y(opt.Tin)],
  ];
  if (opt.ghost) el('path', { d: path(line(opt.ghost, opt.ghostTout ?? opt.Tout)), class: 'ghost' }, svg);
  el('path', { d: path(line(points, opt.Tout)), class: 'tline' }, svg);

  // 표시점 + 라벨
  const marks = [{ x: 0, T: Tso }];
  if (opt.labelInterfaces) for (let i = 1; i < layers.length; i++) {
    const p = points.find(q => Math.abs(q.x - xm[i]) < 1e-9);
    if (p) marks.push(p);
  }
  marks.push({ x: Ltot, T: Tsi });
  marks.forEach((m, j) => {
    const cx = X(m.x), cy = Y(m.T);
    el('circle', { cx, cy, r: 4.5, class: 'tdot' }, svg);
    const up = j % 2 === 0;
    text(svg, cx, cy + (up ? -10 : 19), `${fmt(m.T, 1)}℃`, { class: 'tlabel', 'text-anchor': 'middle' });
  });
  // 공기온도 라벨은 표면온도와 다를 때만 (표면저항 미포함 시 겹침 방지)
  if (Math.abs(opt.Tout - Tso) > 0.05)
    text(svg, axL + 6, Y(opt.Tout) + (opt.Tout > (lo + hi) / 2 ? 18 : -8), `${fmt(opt.Tout, 1)}℃`, { class: 'tlabel' });
  if (Math.abs(opt.Tin - Tsi) > 0.05)
    text(svg, right - 6, Y(opt.Tin) + (opt.Tin > (lo + hi) / 2 ? 18 : -8), `${fmt(opt.Tin, 1)}℃`, { class: 'tlabel', 'text-anchor': 'end' });

  // 열류 화살표
  if (Math.abs(opt.q) > 1e-9) {
    const ay = 20, xa = wx0 + 20, xb = wx1 - 20;
    const [s, e] = opt.q > 0 ? [xa, xb] : [xb, xa];
    el('line', { x1: s, x2: e - Math.sign(e - s) * 10, y1: ay, y2: ay, class: 'arrow' }, svg);
    const d = Math.sign(e - s);
    el('path', { d: `M${e},${ay} L${e - d * 12},${ay - 6} L${e - d * 12},${ay + 6} Z`, class: 'arrow-head' }, svg);
    const lbl = `q = ${fmt(Math.abs(opt.q), 2)} W/m²  ${opt.q > 0 ? '실외 → 실내' : '실내 → 실외'}`;
    text(svg, (xa + xb) / 2, ay - 7, lbl, { class: 'qlabel', 'text-anchor': 'middle' });
  }
}

// ───────────────── ① 정상상태 ─────────────────
const card = (k, v, unit, sub = '', hl = false) =>
  `<div class="card${hl ? ' hl' : ''}"><div class="k">${k}</div><div class="v">${v}<small>${unit}</small></div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

function renderSteady() {
  const { layers, bc } = state;
  const r = steadyState(layers, bc);
  const dir = r.q > 0 ? '실외 → 실내 · 냉방부하' : r.q < 0 ? '실내 → 실외 · 난방부하' : '열 흐름 없음';
  $('#st-cards').innerHTML =
    card('전체 열저항 R<sub>total</sub>', fmt(r.Rtot, 3), 'm²K/W') +
    card('열관류율 U', fmt(r.U, 3), 'W/m²K') +
    card('열류 |q|', fmt(Math.abs(r.q), 2), 'W/m²', dir, true) +
    card('실내 표면온도', fmt(r.Tsi, 1), '℃', bc.surface ? `실내 공기와 ${fmt(Math.abs(r.Tsi - bc.Tin), 1)}℃ 차이` : '표면저항 미포함');

  const Ts = [bc.Tout, bc.Tin];
  const range = niceDomain(Ts, 0.12);
  drawWall($('#wall-steady'), layers, r.points, { Tout: bc.Tout, Tin: bc.Tin, range, q: r.q, labelInterfaces: true });
  drawRChain($('#rchain'), r);

  const rows = r.elems.map(e => {
    const isL = e.kind === 'layer';
    const l = isL ? layers[e.index] : null;
    const name = isL ? `<span class="sw" style="background:${MATERIALS[l.mat].color}"></span>${e.index + 1}. ${MATERIALS[l.mat].name}`
      : (e.side === 'out' ? '실외 표면 (1/h<sub>o</sub>)' : '실내 표면 (1/h<sub>i</sub>)');
    return `<tr><td>${name}</td><td>${isL ? +(l.L * 1000).toFixed(1) : '–'}</td><td>${isL ? l.k : '–'}</td>
      <td>${fmt(e.R, 3)}</td><td>${fmt(e.dT, 2)}</td>
      <td><span class="bar" style="width:${(e.share * 60).toFixed(1)}px"></span>${fmt(e.share * 100, 1)}%</td></tr>`;
  }).join('');
  $('#st-table tbody').innerHTML = rows;
  $('#st-table tfoot').innerHTML = `<tr><td>합계</td><td>${+(layers.reduce((s, l) => s + l.L, 0) * 1000).toFixed(1)}</td><td></td>
    <td>${fmt(r.Rtot, 3)}</td><td>${fmt(bc.Tout - bc.Tin, 2)}</td><td>100%</td></tr>`;
}

function drawRChain(svg, r) {
  const W = 760, H = 104, x0 = 10, x1 = W - 10, y = 34, h = 30;
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let x = x0;
  for (const e of r.elems) {
    const w = e.share * (x1 - x0);
    const color = e.kind === 'layer' ? MATERIALS[state.layers[e.index].mat].color : css('--ref');
    el('rect', { x, y, width: Math.max(w, 0.5), height: h, fill: color, rx: 3 }, svg);
    el('line', { x1: x, x2: x, y1: y - 4, y2: y + h + 4, class: 'seg-border' }, svg);
    const name = e.kind === 'layer' ? MATERIALS[state.layers[e.index].mat].name : (e.side === 'out' ? '실외표면' : '실내표면');
    if (w > textWidth(name) + 6) text(svg, x + w / 2, y - 8, name, { class: 'lname', 'text-anchor': 'middle' });
    const sub = `R ${fmt(e.R, 2)} · ΔT ${fmt(Math.abs(e.dT), 1)}℃`;
    if (w > textWidth(sub) * 0.9 + 6) text(svg, x + w / 2, y + h + 18, sub, { class: 'lsub', 'text-anchor': 'middle' });
    else if (w > 34) text(svg, x + w / 2, y + h + 18, fmt(e.R, 2), { class: 'lsub', 'text-anchor': 'middle' });
    x += w;
  }
}

// ───────────────── ② 하루 변화 ─────────────────
let trCache = null;
function computeTransient() {
  const { layers, bc, tr } = state;
  const o = { Tin: bc.Tin, Tmean: tr.Tmean, Tamp: tr.Tamp, peakHour: tr.peakHour, hOut: bc.hOut, hIn: bc.hIn, surface: bc.surface };
  const A = periodicResponse(layers, o);
  const B = periodicResponse([...layers].reverse(), o);
  const sA = A.series(10), sB = B.series(10);
  const allT = [tr.Tmean - tr.Tamp, tr.Tmean + tr.Tamp, bc.Tin];
  trCache = { o, A, B, sA, sB, range: niceDomain(allT, 0.12) };
}

const hhmm = t => {
  const m = Math.round(t * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const interp = (ser, key) => t => {
  const f = (t / 24) * (ser.length - 1), i = Math.min(ser.length - 2, Math.floor(f)), u = f - i;
  return ser[i][key] * (1 - u) + ser[i + 1][key] * u;
};

let chartT = null, chartQ = null;
function renderTransient() {
  computeTransient();
  const { A, B, sA, sB, o } = trCache;
  const a = A.metrics, b = B.metrics;
  const nameA = 'A 현재 벽', nameB = 'B 순서 뒤집은 벽';
  const row = (k, va, vb, note = '') => `<tr><td>${k}${note ? `<br><small class="hint">${note}</small>` : ''}</td><td>${va}</td><td>${vb}</td></tr>`;
  $('#tr-metrics').innerHTML = `
    <thead><tr><th></th><th class="la">${nameA}</th><th class="lb">${nameB}</th></tr></thead>
    <tbody>
      ${row('감쇠계수 f', fmt(a.decrement, 3), fmt(b.decrement, 3), '작을수록 외기 변동을 잘 걸러냄')}
      ${row('시간지연', `${fmt(a.lag, 1)} h`, `${fmt(b.lag, 1)} h`, '외기 최고 → 실내 열류 최고')}
      ${row('일평균 열류 q', `${fmt(a.qMean, 2)} W/m²`, `${fmt(b.qMean, 2)} W/m²`, 'R 합이 같으면 항상 같다')}
      ${row('열류 진폭', `±${fmt(a.qAmp, 2)} W/m²`, `±${fmt(b.qAmp, 2)} W/m²`, `정상상태 가정 시 ±${fmt(a.quasiAmp, 2)}`)}
      ${row('실내 표면온도 변동', `±${fmt(a.TsiAmp, 2)} ℃`, `±${fmt(b.TsiAmp, 2)} ℃`)}
      ${row('축열량 Σρ·c·L', `${fmt(a.heatCapacity / 1000, 0)} kJ/m²K`, `${fmt(b.heatCapacity / 1000, 0)} kJ/m²K`)}
    </tbody>`;

  const cA = css('--a'), cB = css('--b'), cR = css('--ref');
  const xs = { domain: [0, 24], ticks: [0, 3, 6, 9, 12, 15, 18, 21, 24], format: v => `${v}시`, label: '시각' };
  const P = (ser, key) => ser.map(r => [r.tHour, r[key]]);

  const tVals = [...sA.map(r => r.Tout), ...sA.map(r => r.Tsi), ...sB.map(r => r.Tsi), o.Tin];
  chartT = lineChart($('#chart-temp'), {
    x: xs, y: { domain: niceDomain(tVals), label: '온도 (℃)' },
    series: [
      { points: P(sA, 'Tout'), color: cR, label: '외기온도', marker: true, valueAt: interp(sA, 'Tout') },
      { points: [[0, o.Tin], [24, o.Tin]], color: cR, dash: '4 4', width: 1.5, label: '실내 공기' },
      { points: P(sA, 'Tsi'), color: cA, label: '실내 표면 A', marker: true, valueAt: interp(sA, 'Tsi') },
      { points: P(sB, 'Tsi'), color: cB, label: '실내 표면 B', marker: true, valueAt: interp(sB, 'Tsi') },
    ],
    vline: state.tr.t,
  });

  const qVals = [...sA.map(r => r.qQuasi), ...sA.map(r => r.qIn), ...sB.map(r => r.qIn), 0];
  chartQ = lineChart($('#chart-q'), {
    x: xs, y: { domain: niceDomain(qVals), label: 'q_in (W/m²)' },
    series: [
      { points: P(sA, 'qQuasi'), color: cR, dash: '6 4', label: '정상상태 가정', marker: true, valueAt: interp(sA, 'qQuasi') },
      { points: P(sA, 'qIn'), color: cA, label: nameA, marker: true, valueAt: interp(sA, 'qIn') },
      { points: P(sB, 'qIn'), color: cB, label: nameB, marker: true, valueAt: interp(sB, 'qIn') },
    ],
    vline: state.tr.t,
  });
  renderTransientFrame();
}

function renderTransientFrame() {
  if (!trCache) return;
  const t = state.tr.t;
  const { A, o, range } = trCache;
  const now = A.at(t);
  const ghost = steadyState(state.layers, { ...state.bc, Tout: now.Tout }).points;
  drawWall($('#wall-tr'), state.layers, now.points,
    { Tout: now.Tout, Tin: o.Tin, range, q: now.qIn, ghost, labelInterfaces: false });
  $('#trClock').textContent = hhmm(t);
  $('#trTime').value = t;
  chartT?.setVline(t);
  chartQ?.setVline(t);
}

function syncTrInputs() {
  $('#trMean').value = state.tr.Tmean;
  $('#trAmp').value = state.tr.Tamp;
  $('#trPeak').value = state.tr.peakHour;
}
[['trMean', 'Tmean'], ['trAmp', 'Tamp'], ['trPeak', 'peakHour']].forEach(([id, key]) => {
  $('#' + id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || (key === 'Tamp' && v < 0)) return;
    state.tr[key] = v;
    update();
  });
});
document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.season === 'summer') { Object.assign(state.tr, { Tmean: 30, Tamp: 7 }); state.bc.Tin = 26; }
  else { Object.assign(state.tr, { Tmean: -2, Tamp: 5 }); state.bc.Tin = 20; }
  syncTrInputs(); syncBcInputs(); update();
}));

$('#trTime').addEventListener('input', e => {
  state.tr.t = parseFloat(e.target.value);
  renderTransientFrame();
});
let raf = 0, last = 0;
function tick(ts) {
  if (!state.tr.playing) return;
  const dt = last ? (ts - last) / 1000 : 0;
  last = ts;
  state.tr.t = (state.tr.t + dt * 2.4) % 24; // 1초 = 2.4시간
  renderTransientFrame();
  raf = requestAnimationFrame(tick);
}
function stopPlay() {
  state.tr.playing = false;
  cancelAnimationFrame(raf);
  $('#trPlay').textContent = '▶';
  $('#trPlay').setAttribute('aria-label', '재생');
}
$('#trPlay').addEventListener('click', () => {
  if (state.tr.playing) return stopPlay();
  state.tr.playing = true;
  last = 0;
  $('#trPlay').textContent = '❚❚';
  $('#trPlay').setAttribute('aria-label', '일시정지');
  raf = requestAnimationFrame(tick);
});

// ───────────────── ③ 병렬 · 열교 ─────────────────
const parMat = $('#parMat');
parMat.innerHTML = matOptions(state.par.mat);
parMat.addEventListener('change', () => { state.par.mat = parMat.value; update(); });
$('#parFrac').addEventListener('input', e => { state.par.frac = parseFloat(e.target.value) / 100; update(); });

function renderParallel() {
  const { layers, bc, par } = state;
  const target = dominantLayerIndex(layers);
  const kB = MATERIALS[par.mat].k;
  const r = parallelBridge(layers, bc, par.frac, kB, target);
  const tName = MATERIALS[layers[target].mat].name;
  $('#parFracVal').textContent = `${fmt(par.frac * 100, 1)} %`;
  $('#parTarget').innerHTML = `열교 위치: <b>${target + 1}. ${tName}</b> 층(R 이 가장 큰 층)을 ${MATERIALS[par.mat].name}(k = ${kB})이 관통한다고 가정`;

  $('#par-cards').innerHTML =
    card('단열 부위 U<sub>A</sub>', fmt(r.A.U, 3), 'W/m²K') +
    card('열교 부위 U<sub>B</sub>', fmt(r.B.U, 3), 'W/m²K', `U<sub>A</sub>의 ${fmt(r.B.U / r.A.U, 1)}배`) +
    card('평균 U<sub>avg</sub>', fmt(r.U, 3), 'W/m²K', `열교 없을 때보다 +${fmt(r.increase * 100, 1)}%`, true) +
    card('열교로 새는 열', fmt(r.bridgeShare * 100, 1), '%', `면적은 ${fmt(par.frac * 100, 1)}%`);

  const fs = [];
  for (let f = 0; f <= 30; f += 0.5) fs.push(f);
  const curve = fs.map(f => [f, (1 - f / 100) * r.A.U + (f / 100) * r.B.U]);
  const ch = lineChart($('#chart-par'), {
    x: { domain: [0, 30], ticks: [0, 5, 10, 15, 20, 25, 30], format: v => `${v}%`, label: '열교 면적 비율' },
    y: { domain: niceDomain([0, ...curve.map(p => p[1])], 0.05), label: 'U (W/m²K)', format: v => v.toFixed(2) },
    series: [
      { points: curve, color: css('--a'), label: 'U_avg', marker: true, valueAt: f => (1 - f / 100) * r.A.U + (f / 100) * r.B.U },
      { points: [[0, r.A.U], [30, r.A.U]], color: css('--ref'), dash: '4 4', width: 1.5, label: '열교 없음 (U_A)' },
    ],
    vline: par.frac * 100,
  });
  void ch;
  drawShareBars($('#par-bars'), par.frac, r.bridgeShare);
}

function drawShareBars(svg, area, heat) {
  const W = 760, H = 112, x0 = 110, x1 = W - 16;
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const rows = [['면적 비중', area, 22], ['열손실 비중', heat, 66]];
  for (const [label, f, y] of rows) {
    text(svg, x0 - 10, y + 17, label, { class: 'lname', 'text-anchor': 'end' });
    const w = (x1 - x0);
    el('rect', { x: x0, y, width: w * (1 - f), height: 26, fill: css('--ref'), opacity: 0.35, rx: 3 }, svg);
    el('rect', { x: x0 + w * (1 - f), y, width: w * f, height: 26, fill: css('--a'), rx: 3 }, svg);
    const lbl = `열교 ${fmt(f * 100, 1)}%`;
    const inside = w * f > textWidth(lbl) + 12;
    text(svg, inside ? x1 - 8 : x0 + w * (1 - f) - 8, y + 17, lbl,
      { class: 'tlabel', 'text-anchor': 'end' });
  }
}

// ───────────────── 갱신 ─────────────────
function update() {
  if (state.tab === 'steady') renderSteady();
  else if (state.tab === 'transient') renderTransient();
  else renderParallel();
}

// 다크/라이트 변경 시 색 다시 그리기
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);

syncTrInputs();
loadPreset('lecture');
