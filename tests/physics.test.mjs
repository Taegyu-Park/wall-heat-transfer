import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, steadyState, periodicResponse, parallelBridge } from '../js/physics.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mk = (mat, L, over = {}) => ({ ...MATERIALS[mat], L, ...over });

// 강의 29p: Ta=40, Tb=10, k=1.0/0.02/0.1, L=0.4/0.05/0.15
const lecture = [mk('concrete', 0.4, { k: 1.0 }), mk('eps', 0.05, { k: 0.02 }), mk('wood', 0.15, { k: 0.1 })];
const lectureBc = { Tout: 40, Tin: 10, surface: false, hOut: 23, hIn: 9 };

test('정상상태: 강의 29p 예제 손계산과 일치', () => {
  const r = steadyState(lecture, lectureBc);
  near(r.Rtot, 4.4, 1e-12, 'Rtot');
  near(r.q, 30 / 4.4, 1e-12, 'q');
  near(r.points[1].T, 40 - (30 / 4.4) * 0.4, 1e-9, 'T1');   // 37.27
  near(r.points[2].T, 40 - (30 / 4.4) * 2.9, 1e-9, 'T2');   // 20.23
  near(r.points[3].T, 10, 1e-9, 'T3');
});

test('정상상태: 표면저항 포함 시 R 합과 표면온도', () => {
  const bc = { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 };
  const r = steadyState([mk('concrete', 0.2)], bc);
  const R = 1 / 23 + 0.2 / 1.6 + 1 / 9;
  near(r.Rtot, R, 1e-12);
  near(r.Tsi, 20 + (r.q) * (1 / 9), 1e-9, '실내표면');  // q<0 → Tsi<20
  assert.ok(r.Tsi < 20 && r.Tso > -5);
});

const base = { Tin: 20, Tmean: 0, Tamp: 6, peakHour: 15, hOut: 23, hIn: 9, surface: true };

test('비정상: 진폭 0 이면 정상상태와 같음', () => {
  const layers = [mk('eps', 0.1), mk('concrete', 0.2)];
  const p = periodicResponse(layers, { ...base, Tamp: 0 });
  const s = steadyState(layers, { Tout: 0, Tin: 20, surface: true, hOut: 23, hIn: 9 });
  const a = p.at(7.3);
  near(a.qIn, s.q, 1e-9, 'qIn');                          // 둘 다 + 가 실외→실내
  near(a.Tsi, s.Tsi, 1e-9, 'Tsi');
  near(a.points.find(pt => Math.abs(pt.x - 0.1) < 1e-12).T, s.points[1].T, 1e-6, '경계면');
});

test('비정상: 일평균 열류 = 정상상태 열류 (내·외단열 동일)', () => {
  const ext = periodicResponse([mk('eps', 0.1), mk('concrete', 0.2)], base);
  const int = periodicResponse([mk('concrete', 0.2), mk('eps', 0.1)], base);
  const qs = (0 - 20) / ext.Rtot;
  near(ext.metrics.qMean, qs, 1e-9);
  near(int.metrics.qMean, qs, 1e-9);
  // 시계열 평균으로도 확인
  const ser = ext.series(10).slice(0, -1);
  near(ser.reduce((s, r) => s + r.qIn, 0) / ser.length, qs, 1e-6, '시계열평균');
});

test('비정상: 축열이 거의 없으면 감쇠 없음, 무거운 벽은 감쇠·지연 큼', () => {
  const light = periodicResponse([mk('eps', 0.05, { rho: 0.01, cp: 1 })], base);
  near(light.metrics.decrement, 1, 1e-3, '경량');
  assert.ok(light.metrics.lag < 0.05 || light.metrics.lag > 23.95);

  const heavy = periodicResponse([mk('concrete', 0.3)], base);
  assert.ok(heavy.metrics.decrement < 0.5, `heavy f=${heavy.metrics.decrement}`);
  assert.ok(heavy.metrics.lag > 5 && heavy.metrics.lag < 15, `heavy lag=${heavy.metrics.lag}`);
});

test('비정상: 지표가 시계열 최대값과 일치', () => {
  const p = periodicResponse([mk('concrete', 0.2), mk('eps', 0.1)], base);
  const ser = p.series(1);
  const amp = (Math.max(...ser.map(r => r.qIn)) - Math.min(...ser.map(r => r.qIn))) / 2;
  near(amp, p.metrics.qAmp, 1e-3 * p.metrics.qAmp + 1e-9, '진폭');
  const peak = ser.reduce((a, r) => (r.qIn > a.qIn ? r : a)).tHour;
  const lagSer = (((peak - 15) % 24) + 24) % 24;
  near(lagSer, p.metrics.lag, 0.05, '지연');
});

test('비정상: 격자 수렴 (dx 5mm vs 1mm)', () => {
  const L = [mk('eps', 0.1), mk('concrete', 0.2)];
  const a = periodicResponse(L, { ...base, dxTarget: 0.005 }).metrics;
  const b = periodicResponse(L, { ...base, dxTarget: 0.001 }).metrics;
  near(a.decrement, b.decrement, 0.01 * b.decrement);
  near(a.lag, b.lag, 0.1);
});

test('병렬(열교): 면적가중 U', () => {
  const bc = { Tout: -5, Tin: 20, surface: true, hOut: 23, hIn: 9 };
  const L = [mk('eps', 0.1), mk('concrete', 0.2)];
  const r = parallelBridge(L, bc, 0.1, 1.6, 0);
  near(r.U, 0.9 * r.A.U + 0.1 * r.B.U, 1e-12);
  assert.ok(r.bridgeShare > 0.1);
  near(parallelBridge(L, bc, 0, 1.6, 0).U, r.A.U, 1e-12);
});
