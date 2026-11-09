import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, steadyState, bridge2D, dewPoint, requiredThickness, annualLoss, layersR } from '../js/physics.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);
const mk = (mat, L, over = {}) => ({ ...MATERIALS[mat], L, ...over });
const wall = [mk('concrete', 0.2), mk('eps', 0.1), mk('gypsum', 0.0125)];
const h = { surface: true, hOut: 25, hIn: 7.7 };
const bcFix = { Tout: -5, Tin: 20, surface: true, hOut: 25, hIn: 7.7, radiation: false };

test('2D: 열교 없으면 1차원 해와 같음', () => {
  const s = bridge2D(wall, { ...h, target: 1, bridgeK: 50, frac: 0 });
  const r = steadyState(wall, bcFix);
  near(s.U, r.U, 1e-9, 'U');
  const thSi = (r.Tsi - 20) / (-5 - 20);
  for (const v of s.thSi) near(v, thSi, 1e-9, 'Tsi 균일');
});

test('2D: 열교 재료 k 가 원래와 같으면 1차원 해와 같음', () => {
  const s = bridge2D(wall, { ...h, target: 1, bridgeK: wall[1].k, frac: 0.1 });
  near(s.U, steadyState(wall, bcFix).U, 1e-9);
});

test('2D: 에너지 보존 (들어온 열 = 나간 열)', () => {
  const s = bridge2D(wall, { ...h, target: 1, bridgeK: 1.6, frac: 0.05 });
  near(s.Q, s.Qo, 1e-9 * Math.abs(s.Q));
});

test('2D: U 는 병렬 경로(상한 R) 와 등온면(하한 R) 사이', () => {
  for (const [kb, f] of [[1.6, 0.05], [50, 0.02], [0.6, 0.2]]) {
    const s = bridge2D(wall, { ...h, target: 1, bridgeK: kb, frac: f });
    const A = steadyState(wall, bcFix).U;
    const B = steadyState(wall.map((l, i) => (i === 1 ? { ...l, k: kb } : l)), bcFix).U;
    const Upar = (1 - f) * A + f * B;
    const Rlo = 1 / 25 + 1 / 7.7 + wall.reduce((sum, l, i) => sum + l.L / (i === 1 ? (1 - f) * l.k + f * kb : l.k), 0);
    assert.ok(s.U >= Upar - 1e-9, `U2D ${s.U} < 병렬 ${Upar}`);
    assert.ok(s.U <= 1 / Rlo + 1e-9, `U2D ${s.U} > 등온면 ${1 / Rlo}`);
  }
});

test('2D: 격자를 촘촘히 해도 U 가 거의 같음 (수렴)', () => {
  const o = { ...h, target: 1, bridgeK: 1.6, frac: 0.05 };
  const a = bridge2D(wall, o).U, b = bridge2D(wall, { ...o, nx: 120, ny: 80 }).U;
  near(a, b, 0.01 * b);
});

test('2D: 열교 중심의 실내 표면이 가장 차가움 (겨울)', () => {
  const s = bridge2D(wall, { ...h, target: 1, bridgeK: 1.6, frac: 0.05 });
  // θ 가 클수록 실외 쪽에 가까움 → 겨울에 더 차가움
  assert.equal(s.thSi.indexOf(Math.max(...s.thSi)), 0);
});

test('이슬점: 20℃ 50% ≈ 9.3℃, 100% 면 기온과 같음', () => {
  near(dewPoint(20, 50), 9.26, 0.05);
  near(dewPoint(15, 100), 15, 1e-9);
});

test('필요 두께: 계산한 두께를 넣으면 U 가 기준과 정확히 같음', () => {
  const Rs = 0.11 + 0.043, Ureq = 0.22;
  const L = requiredThickness(wall, 1, Ureq, Rs);
  const w2 = wall.map((l, i) => (i === 1 ? { ...l, L } : l));
  near(1 / (Rs + layersR(w2)), Ureq, 1e-12);
  assert.equal(requiredThickness(wall, 1, 10, Rs), 0);
});

test('연간 열손실 = U·HDD·24/1000', () => {
  near(annualLoss(0.2, 2500), 12, 1e-12);
});
