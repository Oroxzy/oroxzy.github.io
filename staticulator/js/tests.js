// Prüft den Rechenkern gegen die Sollwerte aus den Musterlösungen (examples.js).
import { EXAMPLES } from './examples.js';
import { solve, internalForces } from './statik.js';
import { runDesignTests } from './tests-bemessung.js';
import { cutForces, shearAreas, deflectionParts, lineAt, tableDeflection } from './cursor-derive.js';
import { deflection } from './bemessung.js';

const TOLERANCE = 0.02; // kN bzw. kNm, Musterlösungen runden auf 2 Stellen

function close(actual, expected, tolerance = TOLERANCE) {
  return Math.abs(actual - expected) <= tolerance;
}

export function runTests() {
  const results = [];
  for (const example of EXAMPLES) {
    const checks = [];
    const result = solve(example.model);
    if (!result.ok) {
      checks.push({ ok: false, text: `Fehler: ${result.error}` });
      results.push({ example, checks });
      continue;
    }
    const expect = example.expect;
    if (!expect) {
      checks.push({ ok: true, text: `ohne Sollwerte – ${result.reactions.map((r) => `${r.name}: Rx ${r.Rx.toFixed(2)}, Rz ${r.Rz.toFixed(2)}`).join(' | ')}` });
    } else {
      for (const r of result.reactions) {
        const e = expect[r.name];
        if (!e) continue;
        if (e.x !== undefined) checks.push({ ok: close(r.Rx, e.x), text: `${r.name}_x = ${r.Rx.toFixed(2)} (soll ${e.x})` });
        if (e.z !== undefined) checks.push({ ok: close(r.Rz, e.z), text: `${r.name}_z = ${r.Rz.toFixed(2)} (soll ${e.z})` });
      }
      checks.push({ ok: Math.abs(result.steps.check.residual) < 1e-6, text: `Kontrolle ΣM (DP: ${result.steps.check.pivot}) = ${result.steps.check.residual.toExponential(2)}` });
      const forces = internalForces(result);
      if (expect.moments || expect.mMax !== undefined || expect.mMin !== undefined) {
        if (!forces.ok) {
          checks.push({ ok: false, text: `Schnittgrössen fehlen: ${forces.reason}` });
        } else {
          for (const [x, m] of expect.moments || []) {
            const value = forces.valueAt(x).m;
            checks.push({ ok: close(value, m, 0.05), text: `M(${x}) = ${value.toFixed(2)} (soll ${m})` });
          }
          if (expect.mMax !== undefined) checks.push({ ok: close(forces.mMax.m, expect.mMax, 0.1), text: `Mmax = ${forces.mMax.m.toFixed(2)} bei x = ${forces.mMax.x.toFixed(3)} (soll ${expect.mMax})` });
          if (expect.mMin !== undefined) checks.push({ ok: close(forces.mMin.m, expect.mMin, 0.1), text: `Mmin = ${forces.mMin.m.toFixed(2)} bei x = ${forces.mMin.x.toFixed(3)} (soll ${expect.mMin})` });
        }
      }
      if (forces.ok) checks.push(deriveCheck(result, forces), deflectionSumCheck(example.model, result, forces));
    }
    results.push({ example, checks });
  }
  return results;
}

// Herleitung am Cursor: V als Summe der Kräfte links vom Schnitt, M als Summe der Querkraftflächen (plus
// Einzelmomente) und als Momentensumme links müssen an jeder Stelle mit den Schnittgrössen übereinstimmen
// Biegelinie am Cursor: Die Anteile der einzelnen Lasten (jede mit eigenen Lagerkräften) ergeben zusammen
// die Biegelinie (Überlagerung)
function deflectionSumCheck(model, result, forces) {
  const EI = 50000;
  const supportsX = result.reactions.map((r) => r.x);
  const total = deflection(forces, supportsX, EI);
  if (!total) return { ok: true, text: 'Biegelinie: nicht gerechnet (kein gerader Träger zwischen zwei Lagern)' };
  const parts = deflectionParts(model, { result, forces }, EI);
  let worst = 0;
  for (const [x, w] of total.points) worst = Math.max(worst, Math.abs(parts.reduce((s, p) => s + lineAt(p.points, x), 0) - w));
  return { ok: worst < 1e-9, text: `Biegelinie am Cursor: Summe der Anteile von ${parts.length} ${parts.length === 1 ? 'Last' : 'Lasten'} = Biegelinie, grösste Abweichung ${(worst * 1000).toExponential(1)} mm` };
}

// Tabellenformeln für den Einfeldträger gegen die numerische Biegelinie
export function tableDeflectionChecks() {
  const checks = [];
  const cases = [
    { title: 'Einzellast 40 kN bei a = 2.50 m', load: { kind: 'F', dir: 'down', value: 40, x: 2.5, z: null, name: '' } },
    { title: 'Gleichlast 10 kN/m über die ganze Länge', load: { kind: 'q', dir: 'down', value: 10, x1: 0, x2: 6, name: '' } },
  ];
  for (const c of cases) {
    const model = { axis: [{ x: 0, z: 0 }, { x: 6, z: 0 }], supports: [{ name: 'A', type: 'fest', x: 0 }, { name: 'B', type: 'rolle', x: 6 }], loads: [c.load], pivot: 'B' };
    const result = solve(model);
    const forces = internalForces(result);
    const EI = 20000;
    const [part] = deflectionParts(model, { result, forces }, EI);
    let worst = 0;
    for (const x of [0.7, 1.5, 2.5, 3, 4.2, 5.5]) {
      const formula = tableDeflection(part, x, forces, [0, 6], EI, 2);
      worst = Math.max(worst, Math.abs(formula.value - lineAt(part.points, x)) / Math.abs(formula.value));
    }
    checks.push({ ok: worst < 0.002, text: `Tabellenformel ${c.title}, L = 6.00 m: grösste Abweichung zur numerischen Biegelinie ${(worst * 100).toFixed(3)} %` });
  }
  return checks;
}

// Trapez- und Dreieckslasten: Stichproben mit Sollwerten aus einer unabhängigen numerischen Integration
// (Prüfrunde), darunter fallend, nach oben, „von > bis“, Kragarm, zwei Nullstellen und V-Extremum im Abschnitt
export function trapezChecks() {
  const beam = (L) => [{ x: 0, z: 0 }, { x: L, z: 0 }];
  const sup = (a, b) => [{ name: 'A', type: 'fest', x: a }, { name: 'B', type: 'rolle', x: b }];
  const Q = (dir, value, value2, x1, x2) => ({ kind: 'q', dir, value, ...(value2 === undefined ? {} : { value2 }), x1, x2, name: '' });
  const F = (dir, value, x) => ({ kind: 'F', dir, value, x, z: null, name: '' });
  const cases = [
    { title: 'Dreieck fallend 30 → 0, L = 6', m: { axis: beam(6), supports: sup(0, 6), loads: [Q('down', 30, 0, 0, 6)] }, A: 60, B: 30, mMax: [69.282, 2.5359] },
    { title: 'Trapez 10 → 25, L = 5', m: { axis: beam(5), supports: sup(0, 5), loads: [Q('down', 10, 25, 0, 5)] }, A: 37.5, B: 50, mMax: [54.964, 2.6759] },
    { title: 'Trapez nach oben 10 → 30 auf 1–5', m: { axis: beam(6), supports: sup(0, 6), loads: [Q('up', 10, 30, 1, 5)] }, A: -35.556, B: -44.444, mMin: [-80.755, 3.2687] },
    { title: '„von“ > „bis“: von 5, bis 1, 10 → 30', m: { axis: beam(6), supports: sup(0, 6), loads: [Q('down', 10, 30, 5, 1)] }, A: 44.444, B: 35.556, mMax: [80.755, 2.7313] },
    { title: 'Dreieck von 6 bis 2 plus Kragarm 16 → 0', m: { axis: beam(9), supports: sup(0, 6), loads: [Q('down', 0, 24, 6, 2), Q('down', 16, 0, 6, 9)] }, A: 17.333, B: 54.667, mMax: [41.365, 2.8028], mMin: [-24, 6] },
    { title: 'Dreieck nach unten plus Gleichlast nach oben', m: { axis: beam(6), supports: sup(0, 6), loads: [Q('down', 0, 30, 0, 6), Q('up', 10, undefined, 0, 6)] }, A: 0, B: 30, mMax: [26.667, 4], vMax: [10, 2] },
    { title: 'zwei Nullstellen von V in einem Abschnitt', m: { axis: beam(6), supports: sup(0, 6), loads: [Q('down', 40, 0, 0, 6), Q('up', 0, 46, 0, 6), F('down', 1, 6)] }, zeros: [1.046, 4.5353], mMax: [16.416], mMin: [-34.328], vMin: [-21.81, 2.79] },
    { title: 'Kragarm mit Gegenlasten: V-Extremum mitten im Abschnitt', m: { axis: beam(11), supports: sup(5, 11), loads: [Q('up', 30, 0, 0, 5), Q('down', 0, 30, 0, 5)] }, vMax: [37.5, 2.5] },
  ];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  return cases.map((c) => {
    const result = solve({ ...c.m, pivot: 'B' });
    const forces = internalForces(result);
    const bad = [];
    const got = [];
    const reaction = (name) => result.reactions.find((r) => r.name === name).Rz;
    if (c.A !== undefined) { got.push(`A ${reaction('A').toFixed(3)}`); if (!near(reaction('A'), c.A, 0.002)) bad.push('A'); }
    if (c.B !== undefined) { got.push(`B ${reaction('B').toFixed(3)}`); if (!near(reaction('B'), c.B, 0.002)) bad.push('B'); }
    for (const [key, value] of [['mMax', 'm'], ['mMin', 'm'], ['vMax', 'v'], ['vMin', 'v']]) {
      if (!c[key]) continue;
      const [want, at] = c[key];
      const have = forces[key];
      got.push(`${key} ${have[value].toFixed(3)} bei ${have.x.toFixed(4)}`);
      if (!near(have[value], want, key.startsWith('v') ? 0.006 : 0.002) || (at !== undefined && !near(have.x, at, 0.006))) bad.push(key);
    }
    if (c.zeros) {
      const xs = forces.zeroCrossings.filter((z) => z.inSegment).map((z) => z.x);
      got.push(`V = 0 bei ${xs.map((x) => x.toFixed(4)).join(', ')}`);
      if (xs.length !== c.zeros.length || c.zeros.some((x, i) => !near(xs[i], x, 0.0005))) bad.push('Nullstellen');
    }
    return { ok: result.ok && forces.ok && !bad.length, text: `Trapezlast – ${c.title}: ${got.join(', ')}${bad.length ? ` (falsch: ${bad.join(', ')})` : ''}` };
  });
}

function deriveCheck(result, forces) {
  let worst = 0;
  const n = 60;
  for (let k = 0; k <= n; k++) {
    const x = forces.xmin + ((forces.xmax - forces.xmin) * k) / n;
    const at = forces.valueAt(x);
    // am Trägeranfang gilt der Wert rechts der Stelle (wie in valueAt und am Cursor)
    const { items, couples } = cutForces(result, forces, x, k === 0);
    const coupleSum = couples.reduce((s, c) => s + c.c, 0);
    const v = items.reduce((s, i) => s + i.fz, 0);
    const mAreas = shearAreas(forces, x).reduce((s, p) => s + p.area, 0) + coupleSum;
    const mSum = items.reduce((s, i) => s + i.fz * (x - i.x), 0) + coupleSum;
    worst = Math.max(worst, Math.abs(v - at.v), Math.abs(mAreas - at.m), Math.abs(mSum - at.m));
  }
  // an jeder Last- und Lagerstelle: links der Stelle ohne, rechts mit den Kräften und Einzelmomenten dort
  for (const e of forces.events) {
    for (const [inclusive, vWant, mWant] of [[false, e.vLeft, e.mLeft], [true, e.vRight, e.mRight]]) {
      if (!inclusive && e.x <= forces.xmin + 1e-9) continue;
      if (inclusive && e.x >= forces.xmax - 1e-9) continue;
      const { items, couples } = cutForces(result, forces, e.x, inclusive);
      const coupleSum = couples.reduce((s, c) => s + c.c, 0);
      const v = items.reduce((s, i) => s + i.fz, 0);
      const mAreas = shearAreas(forces, e.x).reduce((s, p) => s + p.area, 0) + coupleSum;
      worst = Math.max(worst, Math.abs(v - vWant), Math.abs(mAreas - mWant));
    }
  }
  return { ok: worst < 1e-6, text: `Herleitung am Cursor: V aus den Kräften links, M aus den Querkraftflächen und als Momentensumme an ${n + 1} Stellen und links/rechts jeder Last- und Lagerstelle, grösste Abweichung ${worst.toExponential(1)}` };
}

export function renderTests(target) {
  const results = runTests();
  for (const group of runDesignTests()) results.push({ example: { title: `Bemessung: ${group.title}`, source: group.source }, checks: group.checks });
  results.push({ example: { title: 'Herleitung am Cursor: Tabellenformeln der Biegelinie', source: 'Einfeldträger, Bautabellen' }, checks: tableDeflectionChecks() });
  results.push({ example: { title: 'Trapez- und Dreieckslasten (Stichproben)', source: 'Sollwerte aus unabhängiger numerischer Integration' }, checks: trapezChecks() });
  let passed = 0;
  let failed = 0;
  const rows = [];
  for (const { example, checks } of results) {
    for (const c of checks) (c.ok ? passed++ : failed++);
    rows.push(`<section><h2>${example.title}</h2><p class="src">${example.source}</p><ul>${checks
      .map((c) => `<li class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'} ${c.text}</li>`)
      .join('')}</ul></section>`);
  }
  target.innerHTML = `<p id="summary" class="${failed ? 'bad' : 'ok'}">${failed ? 'FEHLER' : 'OK'}: ${passed} bestanden, ${failed} fehlgeschlagen</p>${rows.join('')}`;
}
