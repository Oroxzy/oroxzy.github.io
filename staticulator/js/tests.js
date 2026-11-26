// Prüft den Rechenkern gegen die Sollwerte aus den Musterlösungen (examples.js).
import { EXAMPLES } from './examples.js';
import { solve, internalForces } from './statik.js';
import { runDesignTests } from './tests-bemessung.js';
import { cutForces, shearAreas } from './cursor-derive.js';

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
      if (forces.ok) checks.push(deriveCheck(result, forces));
    }
    results.push({ example, checks });
  }
  return results;
}

// Herleitung am Cursor: V als Summe der Kräfte links vom Schnitt, M als Summe der Querkraftflächen (plus
// Einzelmomente) und als Momentensumme links müssen an jeder Stelle mit den Schnittgrössen übereinstimmen
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
  return { ok: worst < 1e-6, text: `Herleitung am Cursor: V aus den Kräften links, M aus den Querkraftflächen und als Momentensumme an ${n + 1} Stellen, grösste Abweichung ${worst.toExponential(1)}` };
}

export function renderTests(target) {
  const results = runTests();
  for (const group of runDesignTests()) results.push({ example: { title: `Bemessung: ${group.title}`, source: group.source }, checks: group.checks });
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
