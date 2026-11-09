import { MATERIALS, PRESETS, SURFACE_DEFAULTS, steadyState, periodicResponse, parallelBridge, dominantLayerIndex,
  bridge2D, dewPoint, layersR, requiredThickness, annualLoss } from './physics.js';
import { REGIONS, REG_RS, CITIES, FUELS } from './standards.js';
import { el, text, clear, lineChart, niceTicks, niceDomain, tempColor, fmt, textWidth } from './plot.js';

const $ = s => document.querySelector(s);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ───────────────── 상태 ─────────────────
let uid = 0;
const state = {
  layers: [],
  bc: { Tout: -5, Tin: 20, surface: true, ...SURFACE_DEFAULTS },
  tr: { Tmean: 30, Tamp: 7, peakHour: 15, t: 15, playing: false },
  par: { frac: 0.05, mat: 'concrete', rh: 50 },
  reg: { city: 'gwangju', use: 'apt', expo: 'direct', layerUid: null, hdd: CITIES.gwangju.hdd, area: 100, fuel: 'gas', eff: FUELS.gas.eff, price: FUELS.gas.price },
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
        <label class="full">열전도율 k <span class="unit">W/(m·K)</span> <span class="def" data-def="k"></span>
          <input type="number" data-f="k" min="0.001" step="0.001" value="${l.k}"></label>
      </div>
      <div class="layer-foot">
        <details>
          <summary>축열 물성 (②탭에 사용)</summary>
          <div class="grid2">
            <label>밀도 ρ <span class="unit">kg/m³</span> <span class="def" data-def="rho"></span><input type="number" data-f="rho" min="0.1" step="10" value="${l.rho}"></label>
            <label>비열 c <span class="unit">J/kgK</span> <span class="def" data-def="cp"></span><input type="number" data-f="cp" min="1" step="10" value="${l.cp}"></label>
          </div>
        </details>
        <button type="button" class="reset" data-act="reset" title="k, ρ, c 를 ${MATERIALS[l.mat].name}의 일반값으로">↺ 기본값</button>
      </div>`;
    list.appendChild(row);
    refreshMod(row, l);
  });
}

const PROPS = ['k', 'rho', 'cp'];
const isModified = (l, f) => Math.abs(l[f] - MATERIALS[l.mat][f]) > 1e-12;

/** 재료 일반값과 다른 물성을 표시하고, 초기화 버튼 활성 여부를 갱신 */
function refreshMod(row, l) {
  let any = false;
  for (const f of PROPS) {
    const mod = isModified(l, f);
    any ||= mod;
    row.querySelector(`input[data-f="${f}"]`).classList.toggle('mod', mod);
    const d = row.querySelector(`[data-def="${f}"]`);
    d.textContent = mod ? `기본 ${MATERIALS[l.mat][f]}` : '';
  }
  row.querySelector('[data-act="reset"]').disabled = !any;
  // 축열 물성이 바뀌어 있으면 접힌 상태에서도 보이도록
  if (isModified(l, 'rho') || isModified(l, 'cp')) row.querySelector('details').open = true;
  $('#resetAll').disabled = !state.layers.some(x => PROPS.some(f => isModified(x, f)));
}

function resetProps(l) {
  const m = MATERIALS[l.mat];
  Object.assign(l, { k: m.k, rho: m.rho, cp: m.cp });
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
    } else {
      l[f] = v;
      refreshMod(row, l);
    }
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
  if (act === 'reset') resetProps(L[i]);
  renderLayers();
  update();
});

$('#resetAll').addEventListener('click', () => {
  state.layers.forEach(resetProps);
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

// 입력 id → 허용 범위
const bcIds = {
  Tout: [-Infinity, Infinity], Tin: [-Infinity, Infinity],
  hOut: [1e-6, Infinity], hIn: [1e-6, Infinity],
  epsOut: [0, 1], epsIn: [0, 1], alpha: [0, 1], solar: [0, Infinity],
};
function syncToggles() {
  $('#hbox').classList.toggle('off', !state.bc.surface);
  $('#radbox').classList.toggle('off', !state.bc.radiation);
}
function syncBcInputs() {
  for (const id in bcIds) $('#' + id).value = state.bc[id];
  $('#surface').checked = state.bc.surface;
  $('#radiation').checked = state.bc.radiation;
  syncToggles();
}
for (const [id, [lo, hi]] of Object.entries(bcIds)) {
  $('#' + id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < lo || v > hi) return;
    state.bc[id] = v;
    update();
  });
}
for (const id of ['surface', 'radiation']) {
  $('#' + id).addEventListener('change', e => {
    state.bc[id] = e.target.checked;
    syncToggles();
    update();
  });
}

/** 현재 탭 조건에서의 표면 열전달계수 요약 (입력 패널 아래 표시) */
function renderHsum(r) {
  const s = r.surf;
  const box = $('#hsum');
  if (!s || !state.bc.radiation) { box.textContent = ''; return; }
  const f = (o, side) => `h<sub>${side}</sub> = ${fmt(o.hc, 1)} + <b>${fmt(o.hr, 2)}</b> = ${fmt(o.h, 2)}`;
  box.innerHTML = `복사 h<sub>r</sub> 계산값 → ${f(s.out, 'o')}, ${f(s.in, 'i')} W/m²K`;
}

const presetSel = $('#preset');
presetSel.innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
presetSel.addEventListener('change', () => loadPreset(presetSel.value));

// 탭
function selectTab(name) {
  state.tab = name;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === name));
  document.querySelectorAll('.tabpanel').forEach(p => { p.hidden = p.id !== 'tab-' + name; });
  if (state.tab !== 'transient') stopPlay();
  // ②탭은 실외 온도 대신 외기 평균·일교차를 사용
  const tr = state.tab === 'transient';
  $('#Tout').disabled = tr;
  $('#Tout').title = tr ? '②탭에서는 위쪽의 외기 평균·일교차를 사용합니다' : '';
  update();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
  selectTab(b.dataset.goto);
  document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// ───────────────── 벽 단면 그림 ─────────────────
/** 층 두께 → 화면 폭 (얇은 층도 보이도록 최소 폭 보장). X: 위치(m) → px, Xinv: px → 위치(m) */
function wallScale(layers, wx0, wallW, minW = 14) {
  const Ltot = layers.reduce((s, l) => s + l.L, 0);
  const small = layers.map(l => (l.L / Ltot) * wallW < minW);
  const restL = layers.reduce((s, l, i) => s + (small[i] ? 0 : l.L), 0);
  const fixed = small.filter(Boolean).length * minW;
  const widths = layers.map((l, i) => (small[i] || restL === 0 ? minW : (l.L / restL) * (wallW - fixed)));
  const px0 = [wx0], xm = [0];
  layers.forEach((l, i) => { px0.push(px0[i] + widths[i]); xm.push(xm[i] + l.L); });
  const seg = (arr, v) => { let i = 0; while (i < layers.length - 1 && v > arr[i + 1] + 1e-12) i++; return i; };
  const X = x => { const i = seg(xm, x); return px0[i] + ((x - xm[i]) / layers[i].L) * widths[i]; };
  const Xinv = u => { const i = seg(px0, u); return xm[i] + ((u - px0[i]) / widths[i]) * layers[i].L; };
  const pxPerM = x => { const i = seg(xm, x); return widths[i] / layers[i].L; };
  return { X, Xinv, pxPerM, px0, xm, widths, Ltot };
}

/**
 * points: [{x, T}] 벽 내부 온도 (x=0 실외 표면 … Ltot 실내 표면)
 * opt: { Tout, Tin, range, ghost, q, labelInterfaces }
 */
function drawWall(svg, layers, points, opt) {
  const W = 760, H = 360, top = 46, bot = H - 66, axL = 50, airW = 74, right = W - 8;
  const wx0 = axL + airW, wx1 = right - airW, wallW = wx1 - wx0;
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const { X, px0, xm, widths, Ltot } = wallScale(layers, wx0, wallW);
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

// ───────────────── ⓪ 원리 설명 ─────────────────
/** 푸리에 법칙: 지금 벽에서 R 이 가장 큰 층으로 직접 계산해 보기 */
function renderPrinciples() {
  const { layers, bc } = state;
  const r = steadyState(layers, bc);
  renderHsum(r);
  const di = dominantLayerIndex(layers);
  const de = r.elems.find(e => e.kind === 'layer' && e.index === di);
  const dl = layers[di];
  const dT = Math.abs(de.dT);
  $('#fourier-ex').innerHTML = `<b>지금 벽으로 확인:</b> ${di + 1}층 ${MATERIALS[dl.mat].name} — k = ${dl.k}, L = ${fmt(dl.L, 3)} m, 양쪽 면 온도차 ΔT = ${fmt(dT, 2)}℃<br>
    → 기울기 |dT/dx| = ${fmt(dT, 2)} / ${fmt(dl.L, 3)} = ${fmt(dT / dl.L, 1)} K/m,
    q = k × 기울기 = ${dl.k} × ${fmt(dT / dl.L, 1)} = <b>${fmt(dl.k * dT / dl.L, 2)} W/m²</b>.
    다른 층으로 계산해도 같은 값이 나옵니다 (①탭 표의 k × |dT/dx|).`;
}

// ───────────────── ① 정상상태 ─────────────────
// hl: true → 강조, 문자열 → 추가 클래스 (good / bad)
const card = (k, v, unit, sub = '', hl = false) =>
  `<div class="card${hl === true ? ' hl' : hl ? ' ' + hl : ''}"><div class="k">${k}</div><div class="v">${v}<small>${unit}</small></div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;

function renderSteady() {
  const { layers, bc } = state;
  const r = steadyState(layers, bc);
  renderHsum(r);
  const dir = r.q > 0 ? '실외 → 실내 · 냉방부하' : r.q < 0 ? '실내 → 실외 · 난방부하' : '열 흐름 없음';
  const sun = r.surf && r.surf.out.solar > 0;
  $('#st-cards').innerHTML =
    card('전체 열저항 R<sub>total</sub>', fmt(r.Rtot, 3), 'm²K/W') +
    card('열관류율 U', fmt(r.U, 3), 'W/m²K') +
    card('열류 |q|', fmt(Math.abs(r.q), 2), 'W/m²', dir, true) +
    card('실내 표면온도', fmt(r.Tsi, 1), '℃', bc.surface ? `실내 공기와 ${fmt(Math.abs(r.Tsi - bc.Tin), 1)}℃ 차이` : '표면저항 미포함') +
    (sun ? card('상당외기온도 T<sub>sa</sub>', fmt(r.Tsa, 1), '℃', `외기 ${fmt(bc.Tout, 1)}℃ + αI/h<sub>o</sub> ${fmt(r.Tsa - bc.Tout, 1)}℃`) : '');


  const Ts = [bc.Tout, bc.Tin, r.Tso, r.Tsi]; // 일사가 있으면 표면이 외기보다 뜨거울 수 있음
  const range = niceDomain(Ts, 0.12);
  drawWall($('#wall-steady'), layers, r.points, { Tout: bc.Tout, Tin: bc.Tin, range, q: r.q, labelInterfaces: true });
  drawRChain($('#rchain'), r);

  const rows = r.elems.map(e => {
    const isL = e.kind === 'layer';
    const l = isL ? layers[e.index] : null;
    const name = isL ? `<span class="sw" style="background:${MATERIALS[l.mat].color}"></span>${e.index + 1}. ${MATERIALS[l.mat].name}`
      : (e.side === 'out' ? '실외 표면 (1/h<sub>o</sub>)' : '실내 표면 (1/h<sub>i</sub>)');
    return `<tr><td>${name}</td><td>${isL ? +(l.L * 1000).toFixed(1) : '–'}</td><td>${isL ? l.k : '–'}</td>
      <td>${fmt(e.R, 3)}</td><td>${fmt(e.dT, 2)}</td><td>${isL ? fmt(Math.abs(e.dT) / e.L, 1) : '–'}</td>
      <td><span class="bar" style="width:${(e.share * 60).toFixed(1)}px"></span>${fmt(e.share * 100, 1)}%</td></tr>`;
  }).join('');
  $('#st-table tbody').innerHTML = rows;
  $('#st-table tfoot').innerHTML = `<tr><td>합계</td><td>${+(layers.reduce((s, l) => s + l.L, 0) * 1000).toFixed(1)}</td><td></td>
    <td>${fmt(r.Rtot, 3)}</td><td>${fmt(bc.Tout - bc.Tin, 2)}</td><td></td><td>100%</td></tr>`;
  $('#st-note').innerHTML = sun
    ? `일사가 있으면 실외 표면 구간만 ΔT ≠ q·R 입니다. 회로는 외기 대신 상당외기온도 T<sub>sa</sub> = ${fmt(r.Tsa, 1)}℃ 에서 시작하기 때문입니다 (T<sub>sa</sub> − T<sub>so</sub> = q·R<sub>se</sub>).`
    : '';

  // 표면 열수지
  $('#surf-wrap').hidden = !r.surf;
  if (r.surf) {
    const { out: o, in: i } = r.surf;
    const tr = (name, s, solar) => `<tr><td>${name}</td><td>${fmt(s.hc, 1)}</td><td>${fmt(s.hr, 2)}</td><td>${fmt(s.h, 2)}</td>
      <td>${fmt(1 / s.h, 3)}</td><td>${fmt(s.conv, 2)}</td><td>${fmt(s.rad, 2)}</td><td>${solar}</td></tr>`;
    $('#surf-table tbody').innerHTML =
      tr(`실외 표면 <small class="hint">${fmt(r.Tso, 1)}℃</small>`, o, fmt(o.solar, 1)) +
      tr(`실내 표면 <small class="hint">${fmt(r.Tsi, 1)}℃</small>`, i, '–');
  }
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
  // 표면 h (대류 + 복사) 는 일평균 외기에서 구해 고정 (선형 해석). 일사는 제외.
  const mean = steadyState(layers, { ...bc, Tout: tr.Tmean, solar: 0 });
  renderHsum(mean);
  const hOut = mean.surf ? mean.surf.out.h : bc.hOut, hIn = mean.surf ? mean.surf.in.h : bc.hIn;
  const o = { Tin: bc.Tin, Tmean: tr.Tmean, Tamp: tr.Tamp, peakHour: tr.peakHour, hOut, hIn, surface: bc.surface };
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
  const ghost = steadyState(state.layers,
    { Tout: now.Tout, Tin: o.Tin, surface: o.surface, hOut: o.hOut, hIn: o.hIn, radiation: false, solar: 0 }).points;
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
  renderHsum(r.A);
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
  renderThermal(target, kB, r);
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

// ───────────────── ③ 2D 열화상 ─────────────────
// 열화상 카메라 색 (ironbow): 검정 → 보라 → 빨강 → 주황 → 노랑 → 흰색
const IRON = [[0, 0, 12], [38, 0, 88], [110, 0, 140], [180, 24, 120], [226, 72, 48], [248, 140, 0], [255, 205, 50], [255, 250, 210]];
const IRON_LUT = Array.from({ length: 256 }, (_, n) => {
  const u = (n / 255) * (IRON.length - 1), i = Math.min(IRON.length - 2, Math.floor(u)), f = u - i;
  return IRON[i].map((v, c) => Math.round(v + (IRON[i + 1][c] - v) * f));
});
const lutIdx = u => Math.round(Math.min(1, Math.max(0, u)) * 255);
const ironCss = u => `rgb(${IRON_LUT[lutIdx(u)].join(',')})`;
/** 정렬된 arr 에서 arr[i] ≤ v 인 가장 큰 i (0 … len−2 로 제한) */
const bsearch = (arr, v) => {
  let lo = 0, hi = Math.max(0, arr.length - 2);
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; }
  return lo;
};
const nearest = (arr, v) => { const i = bsearch(arr, v); return i + 1 < arr.length && Math.abs(arr[i + 1] - v) < Math.abs(arr[i] - v) ? i + 1 : i; };

$('#parRH').value = state.par.rh;
$('#parRH').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!(v > 0 && v <= 100)) return;
  state.par.rh = v;
  update();
});

function renderThermal(target, kB, r) {
  const { layers, bc, par } = state;
  // 2D 계산과 비교 대상(1차원 병렬)을 같은 표면 h 로 맞춘다
  const hO = r.A.surf ? r.A.surf.out.h : bc.hOut, hI = r.A.surf ? r.A.surf.in.h : bc.hIn;
  const fix = { ...bc, radiation: false, hOut: hO, hIn: hI };
  const A = steadyState(layers, fix);
  const B = steadyState(layers.map((l, i) => (i === target ? { ...l, k: kB } : l)), fix);
  const Upar = (1 - par.frac) * A.U + par.frac * B.U;
  const s = bridge2D(layers, { target, bridgeK: kB, frac: par.frac, surface: bc.surface, hOut: hO, hIn: hI });

  const Text = A.Tsa, dT = Text - bc.Tin;   // 일사가 있으면 상당외기온도로 구동
  const winter = dT < 0;
  const Tsi = Array.from(s.thSi, th => bc.Tin + dT * th);
  const ext = winter ? Math.min(...Tsi) : Math.max(...Tsi);
  const jExt = Tsi.indexOf(ext);
  const dew = dewPoint(bc.Tin, par.rh);
  const showDew = winter && bc.surface;
  const bad = showDew && ext < dew;

  const inc = (s.U / Upar - 1) * 100;
  $('#th-cards').innerHTML =
    card('2차원 계산 U', fmt(s.U, 3), 'W/m²K', `1차원 병렬 ${fmt(Upar, 3)} 보다 ${inc >= 0 ? '+' : ''}${fmt(inc, 1)}%`, true) +
    card(winter ? '실내 표면 최저온도' : '실내 표면 최고온도', fmt(ext, 1), '℃', `열교 없는 부분 ${fmt(A.Tsi, 1)}℃`) +
    (winter ? card('온도차이비율 TDR', fmt((bc.Tin - ext) / (bc.Tin - bc.Tout), 3), '', '작을수록 표면이 따뜻함') : '') +
    (showDew ? card(`이슬점 (실내 ${par.rh}%)`, fmt(dew, 1), '℃',
      bad ? `최저 표면이 ${fmt(dew - ext, 1)}℃ 낮음 → <b>결로 위험</b>` : `최저 표면이 ${fmt(ext - dew, 1)}℃ 높음 → 결로 없음`, bad ? 'bad' : 'good') : '');

  const win = Math.min(s.P2, Math.max(0.2, s.b2 * 4));
  const Ts = [bc.Tout, bc.Tin, Text];
  let lo = Math.min(...Ts), hi = Math.max(...Ts);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  drawThermo($('#thermo'), $('#thermo-img'), layers, s,
    { Tin: bc.Tin, Tout: bc.Tout, dT, lo, hi, win, target, yExt: s.yc[jExt], ext, bad, winter });
  $('#thermo-note').textContent =
    `표시 범위: 열교 중심 ±${fmt(win * 1000, 0)} mm (계산은 1 m 간격 반복) · 두께 방향은 보기 좋게 늘려 그림 · 격자 ${s.Nx} × ${s.Ny * 2}` +
    (bc.surface ? '' : ' · 표면 열전달을 끄면 표면온도가 공기온도로 고정되어 표면 차이가 보이지 않습니다');

  // 실내 표면온도 분포
  const wmm = win * 1000, bmm = s.b2 * 1000;
  const pts = [];
  for (let j = s.Ny - 1; j >= 0; j--) pts.push([-s.yc[j] * 1000, Tsi[j]]);
  for (let j = 0; j < s.Ny; j++) pts.push([s.yc[j] * 1000, Tsi[j]]);
  const inWin = pts.filter(p => Math.abs(p[0]) <= wmm);
  const step = bmm > 0
    ? [[-wmm, A.Tsi], [-bmm, A.Tsi], [-bmm, B.Tsi], [bmm, B.Tsi], [bmm, A.Tsi], [wmm, A.Tsi]]
    : [[-wmm, A.Tsi], [wmm, A.Tsi]];
  const series = [
    { points: inWin, color: css('--a'), label: '2차원 계산' },
    { points: step, color: css('--ref'), dash: '5 4', width: 1.6, label: '1차원 병렬 가정' },
  ];
  if (showDew) series.push({ points: [[-wmm, dew], [wmm, dew]], color: css('--b'), dash: '3 3', width: 1.6, label: `이슬점 ${fmt(dew, 1)}℃` });
  const yv = [...inWin.map(p => p[1]), A.Tsi, B.Tsi, bc.Tin, ...(showDew ? [dew] : [])];
  lineChart($('#chart-tsi'), {
    x: { domain: [-wmm, wmm], label: '열교 중심에서의 거리 (mm)' },
    y: { domain: niceDomain(yv), label: '실내 표면온도 (℃)' },
    series,
  });
}

function drawThermo(svg, canvas, layers, s, o) {
  const W = 760, H = 420, top = 34, bot = H - 64, ox0 = 8, wx0 = 78, wx1 = 618, ix1 = 700, cbx = 712;
  clear(svg);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const sc = wallScale(layers, wx0, wx1 - wx0);
  const Y = y => top + ((y + o.win) / (2 * o.win)) * (bot - top);
  const T = th => o.Tin + o.dT * th;
  const norm = t => (t - o.lo) / (o.hi - o.lo);
  const Nx = s.Nx, Ny = s.Ny;

  // ── 온도장 이미지 (캔버스를 SVG 벽 영역에 겹쳐 놓음)
  Object.assign(canvas.style, {
    left: `${(wx0 / W) * 100}%`, top: `${(top / H) * 100}%`,
    width: `${((wx1 - wx0) / W) * 100}%`, height: `${((bot - top) / H) * 100}%`,
  });
  const R = 2, cw = Math.round((wx1 - wx0) * R), ch = Math.round((bot - top) * R);
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  // 확장 격자: 열 = [실외 표면, 셀 중심 …, 실내 표면]
  const gx = [0, ...s.xc, s.Ltot];
  const val = (c, j) => (c === 0 ? s.thSo[j] : c === Nx + 1 ? s.thSi[j] : s.theta[j * Nx + c - 1]);
  const colI = new Int32Array(cw), colW = new Float64Array(cw);
  for (let u = 0; u < cw; u++) {
    const x = sc.Xinv(wx0 + (u + 0.5) / R), i = bsearch(gx, x);
    colI[u] = i; colW[u] = Math.min(1, Math.max(0, (x - gx[i]) / (gx[i + 1] - gx[i])));
  }
  const rowI = new Int32Array(ch), rowW = new Float64Array(ch);
  for (let v = 0; v < ch; v++) {
    const y = Math.abs(-o.win + ((v + 0.5) / ch) * 2 * o.win);   // 대칭: |y|
    const j = bsearch(s.yc, y);
    rowI[v] = j; rowW[v] = Ny < 2 ? 0 : Math.min(1, Math.max(0, (y - s.yc[j]) / (s.yc[j + 1] - s.yc[j])));
  }
  for (let v = 0; v < ch; v++) {
    const j0 = rowI[v], j1 = Math.min(Ny - 1, j0 + 1), wy = rowW[v];
    for (let u = 0; u < cw; u++) {
      const c = colI[u], wx = colW[u];
      const th = (1 - wy) * ((1 - wx) * val(c, j0) + wx * val(c + 1, j0)) + wy * ((1 - wx) * val(c, j1) + wx * val(c + 1, j1));
      const rgb = IRON_LUT[lutIdx(norm(T(th)))], p = (v * cw + u) * 4;
      img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2]; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ── 공기 영역
  el('rect', { x: ox0, y: top, width: wx0 - ox0, height: bot - top, fill: ironCss(norm(o.Tout)) }, svg);
  el('rect', { x: wx1, y: top, width: ix1 - wx1, height: bot - top, fill: ironCss(norm(o.Tin)) }, svg);
  text(svg, (ox0 + wx0) / 2, bot + 20, '실외 공기', { class: 'lname', 'text-anchor': 'middle' });
  text(svg, (ox0 + wx0) / 2, bot + 35, `${fmt(o.Tout, 1)}℃`, { class: 'lsub', 'text-anchor': 'middle' });
  text(svg, (wx1 + ix1) / 2, bot + 20, '실내 공기', { class: 'lname', 'text-anchor': 'middle' });
  text(svg, (wx1 + ix1) / 2, bot + 35, `${fmt(o.Tin, 1)}℃`, { class: 'lsub', 'text-anchor': 'middle' });

  // ── 층 경계·재료 이름
  layers.forEach((l, i) => {
    const x = sc.px0[i], w = sc.widths[i];
    if (i > 0) el('line', { x1: x, x2: x, y1: top, y2: bot, stroke: '#fff', 'stroke-opacity': 0.3 }, svg);
    el('rect', { x, y: bot + 2, width: w, height: 7, fill: MATERIALS[l.mat].color }, svg);
    const base = MATERIALS[l.mat].name, full = i === o.target ? `${base} (열교 관통)` : base;
    const label = w >= textWidth(full) + 4 ? full : w >= textWidth(base) + 4 ? base : String(i + 1);
    text(svg, x + w / 2, bot + 24, label, { class: 'lname', 'text-anchor': 'middle' });
  });

  const defs = el('defs', {}, svg);
  const clipId = `${svg.id}-clip`;
  el('rect', { x: wx0, y: top, width: wx1 - wx0, height: bot - top }, el('clipPath', { id: clipId }, defs));
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);

  // ── 열교 윤곽
  if (s.b2 > 0) el('rect', { x: sc.px0[o.target], y: Y(-s.b2), width: sc.widths[o.target], height: Y(s.b2) - Y(-s.b2), class: 'bridge-outline' }, g);

  // ── 등온선 (marching squares, 대칭으로 펼친 격자)
  const rowsY = [...[...s.yc].reverse().map(y => -y), ...s.yc];
  const rv = (c, r) => T(val(c, r < Ny ? Ny - 1 - r : r - Ny));
  const tMin = Math.min(o.Tin, o.Tin + o.dT), tMax = Math.max(o.Tin, o.Tin + o.dT);
  const levels = niceTicks(o.lo, o.hi, 9).filter(t => t > tMin + 1e-6 && t < tMax - 1e-6);
  const P = (c, r) => [sc.X(gx[c]), Y(rowsY[r])];
  let d = '';
  for (let r = 0; r < rowsY.length - 1; r++) {
    if (Math.min(Math.abs(rowsY[r]), Math.abs(rowsY[r + 1])) > o.win && rowsY[r] * rowsY[r + 1] > 0) continue;
    for (let c = 0; c < gx.length - 1; c++) {
      const cn = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      const vs = cn.map(([a, b]) => rv(a, b));
      for (const L of levels) {
        const hits = [];
        for (let e = 0; e < 4; e++) {
          const a = vs[e], b = vs[(e + 1) % 4];
          if ((a - L) * (b - L) < 0) {
            const f = (L - a) / (b - a), [x0, y0] = P(...cn[e]), [x1, y1] = P(...cn[(e + 1) % 4]);
            hits.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
          }
        }
        for (let k = 0; k + 1 < hits.length; k += 2)
          d += `M${hits[k][0].toFixed(1)},${hits[k][1].toFixed(1)}L${hits[k + 1][0].toFixed(1)},${hits[k + 1][1].toFixed(1)}`;
      }
    }
  }
  if (d) el('path', { d, class: 'iso' }, g);

  // ── 열 흐름 화살표
  if (Math.abs(o.dT) > 1e-9) {
    const nC = 9, nR = 9, samples = [];
    for (let a = 0; a < nC; a++) for (let b = 0; b < nR; b++) {
      const u = wx0 + ((a + 0.5) / nC) * (wx1 - wx0), y = -o.win + ((b + 0.5) / nR) * 2 * o.win;
      const x = sc.Xinv(u), i = nearest(s.xc, x), j = nearest(s.yc, Math.abs(y)), c = j * Nx + i;
      const qx = s.qx[c] * o.dT, qy = s.qy[c] * o.dT * Math.sign(y || 1);
      samples.push({ u, v: Y(y), qx, qy, vx: qx * sc.pxPerM(x), vy: qy * ((bot - top) / (2 * o.win)) });
    }
    const qmax = Math.max(...samples.map(p => Math.hypot(p.qx, p.qy)));
    const fg = el('g', { class: 'flow-g' }, g);
    for (const p of samples) {
      const m = Math.hypot(p.qx, p.qy), dm = Math.hypot(p.vx, p.vy);
      if (!(m > qmax * 1e-3) || !(dm > 0)) continue;
      const len = 7 + 19 * Math.sqrt(m / qmax), ux = p.vx / dm, uy = p.vy / dm;
      const x0 = p.u - (ux * len) / 2, y0 = p.v - (uy * len) / 2, x1 = p.u + (ux * len) / 2, y1 = p.v + (uy * len) / 2;
      el('line', { x1: x0, y1: y0, x2: x1 - ux * 4, y2: y1 - uy * 4, class: 'flow' }, fg);
      el('path', { d: `M${x1},${y1}L${x1 - ux * 7 - uy * 4},${y1 - uy * 7 + ux * 4}L${x1 - ux * 7 + uy * 4},${y1 - uy * 7 - ux * 4}Z`, class: 'flow-head' }, fg);
    }
  }

  // ── 실내 표면 최저(최고) 지점
  const ys = o.yExt < 1e-3 ? [0] : [-o.yExt, o.yExt];
  for (const y of ys) el('circle', { cx: wx1, cy: Y(y), r: 6, class: `marker${o.bad ? ' bad' : ''}` }, svg);
  const ly = Math.min(bot - 24, Math.max(top + 14, Y(ys[0]) - 12));
  text(svg, wx1 + 9, ly, `${o.winter ? '최저' : '최고'} ${fmt(o.ext, 1)}℃`, { class: `thlabel${o.bad ? ' bad' : ''}` });
  if (o.bad) text(svg, wx1 + 9, ly + 30, '결로 위험', { class: 'thlabel bad' });

  // ── 색 막대
  const gid = `${svg.id}-cb`;
  const grad = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 1, y2: 0 }, defs);
  for (let n = 0; n <= 16; n++) el('stop', { offset: n / 16, 'stop-color': ironCss(n / 16) }, grad);
  el('rect', { x: cbx, y: top, width: 12, height: bot - top, fill: `url(#${gid})`, rx: 2 }, svg);
  text(svg, cbx + 6, top - 8, '℃', { class: 'tick', 'text-anchor': 'middle' });
  for (const t of niceTicks(o.lo, o.hi, 6)) {
    const y = bot - norm(t) * (bot - top);
    el('line', { x1: cbx + 12, x2: cbx + 15, y1: y, y2: y, class: 'axis' }, svg);
    text(svg, cbx + 17, y + 4, `${t}`, { class: 'tick' });
  }
}

// ───────────────── ④ 기준 · 난방비 ─────────────────
const won = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '–');
const regCity = $('#regCity'), regFuel = $('#regFuel');
regCity.innerHTML = Object.entries(CITIES).map(([k, c]) => `<option value="${k}">${c.name} · ${REGIONS[c.region].name}</option>`).join('');
regFuel.innerHTML = Object.entries(FUELS).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('');

function syncRegInputs() {
  const r = state.reg;
  regCity.value = r.city; regFuel.value = r.fuel;
  $('#regUse').value = r.use; $('#regExpo').value = r.expo;
  $('#regHdd').value = r.hdd; $('#regArea').value = r.area;
  $('#regEff').value = r.eff; $('#regPrice').value = r.price;
  $('#regEffLabel').textContent = FUELS[r.fuel].effLabel;
}
regCity.addEventListener('change', () => { state.reg.city = regCity.value; state.reg.hdd = CITIES[regCity.value].hdd; syncRegInputs(); update(); });
regFuel.addEventListener('change', () => {
  const f = FUELS[regFuel.value];
  Object.assign(state.reg, { fuel: regFuel.value, eff: f.eff, price: f.price });
  syncRegInputs(); update();
});
$('#regUse').addEventListener('change', e => { state.reg.use = e.target.value; update(); });
$('#regExpo').addEventListener('change', e => { state.reg.expo = e.target.value; update(); });
$('#regLayer').addEventListener('change', e => { state.reg.layerUid = +e.target.value; update(); });
[['regHdd', 'hdd', 0], ['regArea', 'area', 1e-9], ['regEff', 'eff', 1e-9], ['regPrice', 'price', 0]].forEach(([id, key, min]) => {
  $('#' + id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < min) return;
    state.reg[key] = v;
    update();
  });
});

function regLayerIndex() {
  let i = state.layers.findIndex(l => l.uid === state.reg.layerUid);
  if (i < 0) { i = dominantLayerIndex(state.layers); state.reg.layerUid = state.layers[i].uid; }
  return i;
}

let regNeedMm = 0;
$('#regApply').addEventListener('click', () => {
  const l = state.layers[regLayerIndex()];
  if (!(regNeedMm > 0)) return;
  l.L = Math.ceil(regNeedMm - 1e-6) / 1000;
  renderLayers();
  update();
});

function renderReg() {
  const { layers, reg } = state;
  const city = CITIES[reg.city], region = REGIONS[city.region], fuel = FUELS[reg.fuel];
  const Ureq = region[reg.expo][reg.use];
  const Rs = REG_RS.in + REG_RS[reg.expo];
  const Rl = layersR(layers);
  const U = 1 / (Rs + Rl);
  const pass = U <= Ureq + 1e-12;
  const idx = regLayerIndex(), L = layers[idx], name = MATERIALS[L.mat].name;
  const Rother = Rs + Rl - L.L / L.k;
  const curMm = L.L * 1000, need = requiredThickness(layers, idx, Ureq, Rs), needMm = need * 1000;
  regNeedMm = needMm;

  $('#regLayer').innerHTML = layers.map((l, i) =>
    `<option value="${l.uid}"${i === idx ? ' selected' : ''}>${i + 1}. ${MATERIALS[l.mat].name} · ${+(l.L * 1000).toFixed(1)} mm (k ${l.k})</option>`).join('');

  const useName = reg.use === 'apt' ? '공동주택' : '공동주택 외';
  $('#reg-cards').innerHTML =
    card('법규 열관류율 U', fmt(U, 3), 'W/m²K', `R<sub>si</sub> ${REG_RS.in} · R<sub>se</sub> ${REG_RS[reg.expo]} 적용`) +
    card('기준값', fmt(Ureq, 3), 'W/m²K', `${region.name} · ${useName} · ${reg.expo === 'direct' ? '외기 직접' : '외기 간접'}`) +
    card('판정', pass ? '통과' : '미달', '', pass ? `기준보다 ${fmt((1 - U / Ureq) * 100, 0)}% 낮음` : `기준보다 ${fmt((U / Ureq - 1) * 100, 0)}% 높음`, pass ? 'good' : 'bad') +
    card(`필요한 ${name} 두께`, fmt(needMm, 0), 'mm',
      needMm > curMm + 0.5 ? `지금보다 +${fmt(needMm - curMm, 0)} mm` : `지금 ${fmt(curMm, 0)} mm 로 충분`, true);

  const huge = needMm > 1000;
  $('#reg-need').innerHTML = `${idx + 1}층 ${name} (k = ${L.k}): L = k × (1/U<sub>기준</sub> − 나머지 R) = ${L.k} × (1/${Ureq} − ${fmt(Rother, 3)}) = <b>${fmt(need, 4)} m</b>` +
    (need === 0 ? ' — 나머지 층만으로 이미 기준을 넘습니다.' : '') +
    (huge ? '<br><span class="hint">단열재가 아닌 층이라 비현실적으로 두껍습니다. 위에서 단열재 층을 골라 보세요.</span>' : '');
  const target = Math.ceil(needMm - 1e-6);
  $('#regApply').disabled = !(needMm > 0) || huge || Math.abs(target - curMm) < 0.5;
  $('#regApply').textContent = `필요 두께로 적용 (${target} mm)`;

  // 두께 → U, 난방비
  const Uof = mm => 1 / (Rother + mm / 1000 / L.k);
  const xmax = Math.ceil(Math.min(Math.max(200, curMm * 1.5, needMm * 1.3), Math.max(1000, curMm * 1.5)) / 50) * 50;
  const xs = Array.from({ length: 161 }, (_, n) => (n / 160) * xmax);
  const yUmax = Math.max(Ureq * 2.5, U * 1.4);
  lineChart($('#chart-reg-u'), {
    x: { domain: [0, xmax], label: `${idx + 1}층 ${name} 두께 (mm)` },
    y: { domain: [0, yUmax], label: 'U (W/m²K)', format: v => v.toFixed(2) },
    clip: true,
    series: [
      { points: xs.map(x => [x, Uof(x)]), color: css('--a'), label: '법규 U', marker: true, valueAt: Uof },
      { points: [[0, Ureq], [xmax, Ureq]], color: css('--ref'), dash: '5 4', width: 1.6, label: `기준 ${Ureq}` },
    ],
    vline: Math.min(curMm, xmax),
  });

  const perU = ((reg.hdd * 24) / 1000) * reg.area / reg.eff;   // U = 1 일 때 연간 투입 에너지 kWh
  const loss = annualLoss(U, reg.hdd), energy = U * perU, cost = energy * reg.price, co2 = energy * fuel.co2;
  const costOf = mm => Uof(mm) * perU * reg.price;
  const save50 = cost - costOf(curMm + 50), save100 = cost - costOf(curMm + 100);
  $('#cost-cards').innerHTML =
    card('연간 열손실', fmt(loss, 1), 'kWh/m²', `벽 전체 ${won(loss * reg.area)} kWh`) +
    card('연간 난방비', won(cost), '원', `${fuel.name} · ${fuel.effLabel} ${reg.eff}`, true) +
    card('연간 CO₂', won(co2), 'kg', `배출계수 ${fuel.co2} kg/kWh`) +
    card(`${name} +50 mm 하면`, won(save50), '원/년 절약', `+100 mm 면 ${won(save100)} 원`);

  const yCmax = Math.max((yUmax * perU * reg.price) / 10000, 1e-6);
  const costReq = (Ureq * perU * reg.price) / 10000;
  lineChart($('#chart-reg-cost'), {
    x: { domain: [0, xmax], label: `${idx + 1}층 ${name} 두께 (mm)` },
    y: { domain: [0, yCmax], label: '연간 난방비 (만원)', format: v => (yCmax < 5 ? v.toFixed(1) : String(v)) },
    clip: true,
    series: [
      { points: xs.map(x => [x, costOf(x) / 10000]), color: css('--a'), label: '연간 난방비', marker: true, valueAt: x => costOf(x) / 10000 },
      { points: [[0, costReq], [xmax, costReq]], color: css('--ref'), dash: '5 4', width: 1.6, label: '기준 U 일 때' },
    ],
    vline: Math.min(curMm, xmax),
  });

  const mats = ['eps', 'xps', 'mineralwool'];
  if (!mats.includes(L.mat)) mats.unshift(L.mat);
  const sumOther = layers.reduce((a, l) => a + l.L, 0) - L.L;
  $('#reg-table tbody').innerHTML = mats.map(m => {
    const k = m === L.mat ? L.k : MATERIALS[m].k;
    const n = requiredThickness(layers, idx, Ureq, Rs, k);
    return `<tr><td><span class="sw" style="background:${MATERIALS[m].color}"></span>${MATERIALS[m].name}${m === L.mat ? ' <small class="hint">(현재)</small>' : ''}</td>
      <td>${k}</td><td>${fmt(n * 1000, 0)}</td><td>${fmt((sumOther + n) * 1000, 0)}</td></tr>`;
  }).join('');
}
syncRegInputs();

// ───────────────── 갱신 ─────────────────
function update() {
  if (state.tab === 'principles') renderPrinciples();
  else if (state.tab === 'steady') renderSteady();
  else if (state.tab === 'transient') renderTransient();
  else if (state.tab === 'parallel') renderParallel();
  else renderReg();
}

// 다크/라이트 변경 시 색 다시 그리기
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);

syncTrInputs();
loadPreset('lecture');
