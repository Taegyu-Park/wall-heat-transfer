// 다층 벽체 열전달 계산 모듈 (UI 의존성 없음 → Node 테스트 가능)
// 좌표계: x = 0 은 실외 표면, x = Ltot 은 실내 표면. 층 배열은 실외 → 실내 순서.
// 열류 q 부호: + 는 실외 → 실내 방향 (열 유입), - 는 실내 → 실외 (열 손실).

export const MATERIALS = {
  concrete:    { name: '콘크리트',        k: 1.6,   rho: 2300, cp: 880,  color: '#a3a7ad' },
  eps:         { name: 'EPS 단열재',      k: 0.035, rho: 20,   cp: 1450, color: '#f1dc8c' },
  xps:         { name: 'XPS 단열재',      k: 0.029, rho: 35,   cp: 1450, color: '#f2b8c6' },
  mineralwool: { name: '미네랄울',        k: 0.040, rho: 60,   cp: 840,  color: '#e2b96a' },
  brick:       { name: '벽돌',            k: 0.6,   rho: 1700, cp: 840,  color: '#c8735a' },
  wood:        { name: '목재',            k: 0.13,  rho: 500,  cp: 1600, color: '#b98b5e' },
  gypsum:      { name: '석고보드',        k: 0.25,  rho: 900,  cp: 1000, color: '#dcd6c8' },
  mortar:      { name: '시멘트 모르타르', k: 0.93,  rho: 2000, cp: 840,  color: '#b9b2a6' },
  steel:       { name: '강재',            k: 50,    rho: 7850, cp: 450,  color: '#6b7a8f' },
};

// 표면 경계 조건 기본값 (ISO 6946 근거)
//  대류 h_c: 실외 20 (풍속 ~4 m/s), 실내 2.5 (수평 열류) W/m²K
//  복사 h_r = εσ(Ts²+Tr²)(Ts+Tr) ≈ 4~5 W/m²K (ε=0.9) → 합 h_o≈24 (R≈0.04), h_i≈7.7 (R≈0.13)
export const SURFACE_DEFAULTS = { hOut: 20, hIn: 2.5, radiation: true, epsOut: 0.9, epsIn: 0.9, solar: 0, alpha: 0.6 };
const S0 = SURFACE_DEFAULTS;

export const PRESETS = {
  lecture: {
    name: '강의 예제 (29p)',
    bc: { Tout: 40, Tin: 10, surface: false, ...S0 },
    layers: [
      { mat: 'concrete', L: 0.40, k: 1.0 },
      { mat: 'eps',      L: 0.05, k: 0.02 },
      { mat: 'wood',     L: 0.15, k: 0.1 },
    ],
  },
  external: {
    name: 'RC 외단열',
    bc: { Tout: -5, Tin: 20, surface: true, ...S0 },
    layers: [ { mat: 'eps', L: 0.10 }, { mat: 'concrete', L: 0.20 } ],
  },
  internal: {
    name: 'RC 내단열',
    bc: { Tout: -5, Tin: 20, surface: true, ...S0 },
    layers: [ { mat: 'concrete', L: 0.20 }, { mat: 'eps', L: 0.10 } ],
  },
  noins: {
    name: '무단열 콘크리트',
    bc: { Tout: -5, Tin: 20, surface: true, ...S0 },
    layers: [ { mat: 'concrete', L: 0.20 } ],
  },
  summerSun: {
    name: '여름 일사 받는 외벽',
    bc: { Tout: 32, Tin: 26, surface: true, ...S0, solar: 500, alpha: 0.7 },
    layers: [ { mat: 'brick', L: 0.09 }, { mat: 'xps', L: 0.08 }, { mat: 'concrete', L: 0.18 } ],
  },
  timber: {
    name: '목조 경량 벽',
    bc: { Tout: -5, Tin: 20, surface: true, ...S0 },
    layers: [ { mat: 'wood', L: 0.018 }, { mat: 'mineralwool', L: 0.14 }, { mat: 'gypsum', L: 0.0125 } ],
  },
};

const BIG_H = 1e7; // 표면저항 무시 시 사실상 무한대 h
export const SIGMA = 5.670374419e-8; // 슈테판-볼츠만 상수 W/(m²K⁴)
const K0 = 273.15;

/**
 * 복사 열전달계수. q_rad = εσ(T1⁴ − T2⁴) = h_r·(T1 − T2) 가 되도록
 * h_r = εσ(T1² + T2²)(T1 + T2)  (T 는 절대온도). T1≈T2 이면 4εσT³ 과 같다.
 */
export function radiationCoeff(eps, T1, T2) {
  const a = T1 + K0, b = T2 + K0;
  return eps * SIGMA * (a * a + b * b) * (a + b);
}

/** h 가 정해졌을 때의 직렬 회로 해. S = 실외 표면 일사 흡수량 (W/m²) */
function solveChain(layers, Tout, Tin, surface, hO, hI, S) {
  const elems = [];
  if (surface) elems.push({ kind: 'surface', side: 'out', R: 1 / hO });
  layers.forEach((l, i) => elems.push({ kind: 'layer', index: i, R: l.L / l.k, L: l.L, k: l.k }));
  if (surface) elems.push({ kind: 'surface', side: 'in', R: 1 / hI });

  const Rtot = elems.reduce((s, e) => s + e.R, 0);
  // 상당외기온도 (sol-air): 일사 흡수를 '외기가 그만큼 더 뜨거운 것'으로 바꿔 쓴다
  const Tsa = surface ? Tout + S / hO : Tout;
  const q = (Tsa - Tin) / Rtot;
  let T = Tsa;
  for (const e of elems) {
    e.Tstart = T;
    e.dT = q * e.R;
    T -= e.dT;
    e.Tend = T;
    e.share = e.R / Rtot;
  }
  // 실외 표면 구간은 실제 외기온도에서 시작 (일사가 있으면 ΔT ≠ q·R)
  if (surface) { elems[0].Tstart = Tout; elems[0].dT = Tout - elems[0].Tend; }

  const lay = elems.filter(e => e.kind === 'layer');
  const Tso = lay[0].Tstart;
  const Tsi = lay[lay.length - 1].Tend;
  const points = [{ x: 0, T: Tso }];
  let x = 0;
  for (const e of lay) { x += e.L; points.push({ x, T: e.Tend }); }
  return { elems, Rtot, U: 1 / Rtot, q, Tso, Tsi, Tsa, points };
}

/**
 * 정상상태 직렬 열저항 해석 (강의 18~29p) + 표면의 대류·복사·일사.
 * bc: { Tout, Tin, surface, hOut, hIn (대류 h_c), radiation, epsOut, epsIn, solar (W/m²), alpha }
 * 복사는 주위 면 온도 = 같은 쪽 공기온도로 가정. h_r 이 표면온도에 따라 달라지므로 반복 계산 →
 * 결과는 비선형 εσ(Ts⁴ − Tr⁴) 를 정확히 만족한다.
 */
export function steadyState(layers, bc) {
  const { Tout, Tin, surface } = bc;
  const rad = !!(surface && bc.radiation);
  const epsO = bc.epsOut ?? S0.epsOut, epsI = bc.epsIn ?? S0.epsIn;
  const S = surface ? (bc.alpha ?? 0) * (bc.solar ?? 0) : 0;
  const hcO = surface ? bc.hOut : BIG_H, hcI = surface ? bc.hIn : BIG_H;

  let hrO = rad ? radiationCoeff(epsO, Tout, Tout) : 0;
  let hrI = rad ? radiationCoeff(epsI, Tin, Tin) : 0;
  let r;
  for (let it = 0; it < 100; it++) {
    r = solveChain(layers, Tout, Tin, surface, hcO + hrO, hcI + hrI, S);
    if (!rad) break;
    const nO = radiationCoeff(epsO, r.Tso, Tout), nI = radiationCoeff(epsI, r.Tsi, Tin);
    const diff = Math.abs(nO - hrO) + Math.abs(nI - hrI);
    hrO = nO; hrI = nI;
    if (diff < 1e-13) break;
  }

  // 표면 열수지 (+ 는 실외 쪽에서는 '벽으로 들어감', 실내 쪽에서는 '실내로 나감')
  r.surf = surface ? {
    out: { hc: hcO, hr: hrO, h: hcO + hrO, conv: hcO * (Tout - r.Tso), rad: hrO * (Tout - r.Tso), solar: S },
    in:  { hc: hcI, hr: hrI, h: hcI + hrI, conv: hcI * (r.Tsi - Tin), rad: hrI * (r.Tsi - Tin) },
  } : null;
  return r;
}

/** 층을 유한체적 격자로 분할 */
export function buildMesh(layers, dxTarget = 0.005) {
  const cells = [];
  const bounds = [0];
  let x = 0;
  layers.forEach((l, li) => {
    const n = Math.max(3, Math.ceil(l.L / dxTarget));
    const dx = l.L / n;
    for (let j = 0; j < n; j++) {
      cells.push({ x: x + (j + 0.5) * dx, dx, k: l.k, C: l.rho * l.cp * dx, layer: li });
    }
    x += l.L;
    bounds.push(x);
  });
  return { cells, bounds, Ltot: x };
}

// ── 복소수 보조 함수 ──
const cdiv = (ar, ai, br, bi) => {
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
};

/**
 * 주파수 영역 삼중대각 해: iωC_i Θ_i = Σ G (Θ_j − Θ_i)
 * omega = 0 이면 정상상태 해와 같다. Fo, Fi: 실외·실내 공기 온도 복소진폭 [re, im]
 */
function solveHarmonic(cells, G, G0, GN, omega, Fo, Fi) {
  const N = cells.length;
  const cpr = new Float64Array(N), cpi = new Float64Array(N);
  const dpr = new Float64Array(N), dpi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const gl = i === 0 ? G0 : G[i - 1];
    const gr = i === N - 1 ? GN : G[i];
    let br = gl + gr, bi = omega * cells[i].C;
    let dr = 0, di = 0;
    if (i === 0) { dr += G0 * Fo[0]; di += G0 * Fo[1]; }
    if (i === N - 1) { dr += GN * Fi[0]; di += GN * Fi[1]; }
    if (i > 0) {
      // m = b − a·c'_{i−1}, a = −G[i−1]
      br += G[i - 1] * cpr[i - 1];
      bi += G[i - 1] * cpi[i - 1];
      dr += G[i - 1] * dpr[i - 1];
      di += G[i - 1] * dpi[i - 1];
    }
    const c = i === N - 1 ? 0 : -G[i];
    [cpr[i], cpi[i]] = cdiv(c, 0, br, bi);
    [dpr[i], dpi[i]] = cdiv(dr, di, br, bi);
  }
  const re = new Float64Array(N), im = new Float64Array(N);
  re[N - 1] = dpr[N - 1]; im[N - 1] = dpi[N - 1];
  for (let i = N - 2; i >= 0; i--) {
    re[i] = dpr[i] - (cpr[i] * re[i + 1] - cpi[i] * im[i + 1]);
    im[i] = dpi[i] - (cpr[i] * im[i + 1] + cpi[i] * re[i + 1]);
  }
  return { re, im };
}

/**
 * 비정상(주기 정상상태) 해석.
 * 외기온도 Tout(t) = Tmean + Tamp·cos(2π(t − peakHour)/24), 실내 공기온도 Tin 일정.
 * 선형 시스템이므로 평균 성분(ω=0)과 하루 주기 성분(ω=2π/24h)을 각각 풀어 합친다 →
 * 예열(spin-up) 없이 '며칠이 지나 반복되는 상태'를 정확히 얻는다.
 */
export function periodicResponse(layers, o) {
  const { cells, bounds, Ltot } = buildMesh(layers, o.dxTarget ?? 0.005);
  const N = cells.length;
  const hO = o.surface ? o.hOut : BIG_H;
  const hI = o.surface ? o.hIn : BIG_H;
  const G = new Float64Array(Math.max(N - 1, 0));
  for (let i = 0; i < N - 1; i++) {
    G[i] = 1 / (cells[i].dx / (2 * cells[i].k) + cells[i + 1].dx / (2 * cells[i + 1].k));
  }
  const G0 = 1 / (1 / hO + cells[0].dx / (2 * cells[0].k));
  const GN = 1 / (1 / hI + cells[N - 1].dx / (2 * cells[N - 1].k));

  const omega = (2 * Math.PI) / 86400;
  const ph = -omega * o.peakHour * 3600;
  const mean = solveHarmonic(cells, G, G0, GN, 0, [o.Tmean, 0], [o.Tin, 0]);
  const osc = solveHarmonic(cells, G, G0, GN, omega,
    [o.Tamp * Math.cos(ph), o.Tamp * Math.sin(ph)], [0, 0]);

  const Rtot = (o.surface ? 1 / o.hOut + 1 / o.hIn : 0) + layers.reduce((s, l) => s + l.L / l.k, 0);
  const ToutAt = t => o.Tmean + o.Tamp * Math.cos(omega * (t - o.peakHour) * 3600);

  // 층 경계 셀 인덱스 (경계면 온도 보간용)
  const ifaces = [];
  for (let i = 0; i < N - 1; i++) if (cells[i].layer !== cells[i + 1].layer) ifaces.push(i);

  function at(tHour) {
    const w = omega * tHour * 3600, c = Math.cos(w), s = Math.sin(w);
    const T = new Float64Array(N);
    for (let i = 0; i < N; i++) T[i] = mean.re[i] + osc.re[i] * c - osc.im[i] * s;
    const Tout = ToutAt(tHour);
    const qWallIn = G0 * (Tout - T[0]);        // 실외 공기 → 벽
    const qIn = GN * (T[N - 1] - o.Tin);       // 벽 → 실내 공기 (+ 이면 실내로 열 유입)
    const Tso = Tout - qWallIn / hO;
    const Tsi = o.Tin + qIn / hI;

    const points = [{ x: 0, T: Tso }];
    let f = 0;
    for (let i = 0; i < N; i++) {
      points.push({ x: cells[i].x, T: T[i] });
      if (f < ifaces.length && ifaces[f] === i) {
        const a = (2 * cells[i].k) / cells[i].dx, b = (2 * cells[i + 1].k) / cells[i + 1].dx;
        points.push({ x: bounds[cells[i].layer + 1], T: (T[i] * a + T[i + 1] * b) / (a + b) });
        f++;
      }
    }
    points.push({ x: Ltot, T: Tsi });
    return { tHour, Tout, Tso, Tsi, qIn, qQuasi: (Tout - o.Tin) / Rtot, points };
  }

  function series(stepMin = 10) {
    const out = [];
    for (let m = 0; m <= 24 * 60; m += stepMin) out.push(at(m / 60));
    return out;
  }

  // 지표 (ISO 13786 의 감쇠계수·시간지연과 같은 개념)
  const qOscR = GN * osc.re[N - 1], qOscI = GN * osc.im[N - 1];
  const qAmp = Math.hypot(qOscR, qOscI);
  const quasiAmp = o.Tamp / Rtot;
  const decrement = quasiAmp > 0 ? qAmp / quasiAmp : NaN;
  let lag = (ph - Math.atan2(qOscI, qOscR)) / omega / 3600;
  lag = ((lag % 24) + 24) % 24;
  const qMean = GN * (mean.re[N - 1] - o.Tin);
  const TsiAmp = qAmp / hI;
  const heatCapacity = layers.reduce((s, l) => s + l.rho * l.cp * l.L, 0); // J/(m²K)

  return {
    cells, bounds, Ltot, Rtot, at, series,
    metrics: { decrement, lag, qMean, qAmp, quasiAmp, TsiAmp, heatCapacity },
  };
}

/** R 이 가장 큰 층 (열교가 관통한다고 가정할 층) */
export function dominantLayerIndex(layers) {
  let best = 0;
  layers.forEach((l, i) => { if (l.L / l.k > layers[best].L / layers[best].k) best = i; });
  return best;
}

/**
 * 병렬 구성 (강의 25p): 면적비 frac 만큼 target 층이 bridgeK 재료로 대체된 경로가 나란히 있다.
 * U_avg = (1−f)·U_A + f·U_B
 */
export function parallelBridge(layers, bc, frac, bridgeK, target) {
  const A = steadyState(layers, bc);
  const B = steadyState(layers.map((l, i) => (i === target ? { ...l, k: bridgeK } : l)), bc);
  const U = (1 - frac) * A.U + frac * B.U;
  return {
    A, B, U,
    bridgeShare: (frac * B.U) / U,
    increase: U / A.U - 1,
    q: (1 - frac) * A.q + frac * B.q,
  };
}
