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

// 표면 열전달계수 기본값: 실외 R=0.043 → h≈23, 실내 R=0.11 → h≈9 (W/m²K)
export const PRESETS = {
  lecture: {
    name: '강의 예제 (29p)',
    bc: { Tout: 40, Tin: 10, surface: false, hOut: 23, hIn: 9 },
    layers: [
      { mat: 'concrete', L: 0.40, k: 1.0 },
      { mat: 'eps',      L: 0.05, k: 0.02 },
      { mat: 'wood',     L: 0.15, k: 0.1 },
    ],
  },
  external: {
    name: 'RC 외단열',
    bc: { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 },
    layers: [ { mat: 'eps', L: 0.10 }, { mat: 'concrete', L: 0.20 } ],
  },
  internal: {
    name: 'RC 내단열',
    bc: { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 },
    layers: [ { mat: 'concrete', L: 0.20 }, { mat: 'eps', L: 0.10 } ],
  },
  noins: {
    name: '무단열 콘크리트',
    bc: { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 },
    layers: [ { mat: 'concrete', L: 0.20 } ],
  },
  timber: {
    name: '목조 경량 벽',
    bc: { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 },
    layers: [ { mat: 'wood', L: 0.018 }, { mat: 'mineralwool', L: 0.14 }, { mat: 'gypsum', L: 0.0125 } ],
  },
};

const BIG_H = 1e7; // 표면저항 무시 시 사실상 무한대 h

/** 정상상태 직렬 열저항 해석 (강의 18~29p) */
export function steadyState(layers, bc) {
  const { Tout, Tin, hOut, hIn, surface } = bc;
  const elems = [];
  if (surface) elems.push({ kind: 'surface', side: 'out', R: 1 / hOut });
  layers.forEach((l, i) => elems.push({ kind: 'layer', index: i, R: l.L / l.k, L: l.L, k: l.k }));
  if (surface) elems.push({ kind: 'surface', side: 'in', R: 1 / hIn });

  const Rtot = elems.reduce((s, e) => s + e.R, 0);
  const q = (Tout - Tin) / Rtot;
  let T = Tout;
  for (const e of elems) {
    e.Tstart = T;
    e.dT = q * e.R;
    T -= e.dT;
    e.Tend = T;
    e.share = e.R / Rtot;
  }
  const lay = elems.filter(e => e.kind === 'layer');
  const Tso = lay[0].Tstart;
  const Tsi = lay[lay.length - 1].Tend;

  // 벽 내부 온도 분포: 각 층 경계의 (x, T)
  const points = [{ x: 0, T: Tso }];
  let x = 0;
  for (const e of lay) { x += e.L; points.push({ x, T: e.Tend }); }

  return { elems, Rtot, U: 1 / Rtot, q, Tso, Tsi, points };
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
    q: U * (bc.Tout - bc.Tin),
  };
}
