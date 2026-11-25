// Prüft die Bemessung (bemessung.js): Biegelinie gegen Lehrbuchformeln, Knicken gegen SZS C4.
import { solve, internalForces } from './statik.js';
import { deflection, steelColumn, steelAxis, timberColumn, steelBeam, timberBeam, maxSpan, kcTableRow, steelTension, timberTension, STEEL_GRADES, TIMBER } from './bemessung.js';
import { PROFILES } from '../data/profiles.js';
import { GRIDS, TABLE } from '../data/c4.js';
import { steelSectionSvg, timberSectionSvg } from './section-svg.js';
import { termsBox } from './design-terms.js';

const C4 = { GRIDS, TABLE };
const profile = (name) => PROFILES.find((p) => p.n === name);
const near = (actual, expected, relative) => Math.abs(actual - expected) <= Math.abs(expected) * relative;

function beam(length, supports, loads) {
  const model = {
    axis: [{ x: 0, z: 0 }, { x: length, z: 0 }],
    supports: [{ name: 'A', type: 'fest', x: supports[0], z: null }, { name: 'B', type: 'rolle', x: supports[1], z: null }],
    loads,
    pivot: 'B',
  };
  const result = solve(model);
  return { result, forces: internalForces(result), xs: result.reactions.map((r) => r.x) };
}

function deflectionTests() {
  const checks = [];
  const EI = 1000;
  // Einfacher Balken, Gleichlast: w = 5 q L⁴ / (384 EI)
  let b = beam(6, [0, 6], [{ kind: 'q', dir: 'down', value: 10, x1: 0, x2: 6, name: '' }]);
  let w = deflection(b.forces, b.xs, EI);
  let expected = (5 * 10 * 6 ** 4) / (384 * EI);
  checks.push({ ok: near(w.max.w, expected, 0.001) && Math.abs(w.max.x - 3) < 0.01, text: `Gleichlast: w = ${(w.max.w * 1000).toFixed(2)} mm bei x = ${w.max.x.toFixed(2)} (soll ${(expected * 1000).toFixed(2)} mm bei 3.00)` });
  // Einzellast ausser Mitte: w_max = P b (L² − b²)^1.5 / (9 √3 L EI), b = kürzerer Abstand
  b = beam(5, [0, 5], [{ kind: 'F', dir: 'down', value: 20, x: 2, z: null, name: '' }]);
  w = deflection(b.forces, b.xs, EI);
  expected = (20 * 2 * (25 - 4) ** 1.5) / (9 * Math.sqrt(3) * 5 * EI);
  checks.push({ ok: near(w.max.w, expected, 0.001), text: `Einzellast ausser Mitte: w = ${(w.max.w * 1000).toFixed(2)} mm (soll ${(expected * 1000).toFixed(2)} mm)` });
  // Kragarm mit Endlast: w = P a² (L + a) / (3 EI)
  b = beam(8, [0, 6], [{ kind: 'F', dir: 'down', value: 10, x: 8, z: null, name: '' }]);
  w = deflection(b.forces, b.xs, EI);
  expected = (10 * 2 ** 2 * (6 + 2)) / (3 * EI);
  const tip = w.cantilevers[0];
  checks.push({ ok: !!tip && near(tip.w, expected, 0.001), text: `Kragarm Endlast: w = ${tip ? (tip.w * 1000).toFixed(2) : '–'} mm (soll ${(expected * 1000).toFixed(2)} mm)` });
  // Das Feld wird nur zwischen den Lagern gesucht: Bei Last nur am Kragarm biegt sich das Feld nach oben,
  // grösste Hebung bei x = l/√3 mit w = M·l²/(9√3·EI), M = P·a (Lehrbuch: Moment am Trägerende)
  const lift = (10 * 2 * 6 ** 2) / (9 * Math.sqrt(3) * EI);
  checks.push({ ok: w.max.w < 1e-9 && near(-w.maxUp.w, lift, 0.002) && Math.abs(w.maxUp.x - 6 / Math.sqrt(3)) < 0.01, text: `Feld neben dem Kragarm: Hebung ${(-w.maxUp.w * 1000).toFixed(2)} mm bei x = ${w.maxUp.x.toFixed(2)} m, keine Senkung im Feld (soll ${(lift * 1000).toFixed(2)} mm bei ${(6 / Math.sqrt(3)).toFixed(2)} m)` });
  // Gleichlast über Feld und Kragarm: Feldmaximum liegt im Feld, nicht an der Kragarmspitze
  b = beam(10, [0, 6], [{ kind: 'q', dir: 'down', value: 10, x1: 0, x2: 10, name: '' }]);
  w = deflection(b.forces, b.xs, EI);
  checks.push({ ok: w.max.x > 0 && w.max.x < 6 && w.cantilevers.length === 1 && w.cantilevers[0].x === 10, text: `Feld 6 m + Kragarm 4 m: Feldwert bei x = ${w.max.x.toFixed(2)} m (zwischen den Lagern), Kragarm getrennt bei x = 10 m` });
  return { title: 'Biegelinie', source: 'EI·w″ = −M gegen Lehrbuchformeln', checks };
}

function columnTests() {
  const checks = [];
  // Formel gegen C4-Tabelle (Werte mit gamma_M1 = 1.05)
  const cases = [
    ['HEB 200', 'S235', 'z', 4.0, 1112],
    ['HEB 200', 'S235', 'y', 4.0, null],
    ['HEA 100', 'S235', 'y', 3.0, 348],
    ['HEA 100', 'S235', 'y', 5.0, 200],
  ];
  for (const [name, grade, axis, Lk, table] of cases) {
    const p = profile(name);
    const a = steelAxis(p, STEEL_GRADES[grade], Lk, axis);
    const entry = TABLE[`${name}|${grade}|${axis}`];
    const grid = GRIDS[entry[0]];
    const tab = table ?? entry[1 + grid.findIndex((L) => Math.abs(L - Lk) < 1e-9)];
    checks.push({ ok: near(a.nRd, tab, 0.01), text: `${name} ${grade} um ${axis}, L_K = ${Lk} m: Formel ${a.nRd.toFixed(0)} kN, C4 ${tab} kN (Kurve ${a.curve})` });
  }
  // Stichprobe: gedrungene Walzprofile S235 stimmen über alle Knicklängen mit C4 überein (±1.5 %)
  let worst = 0;
  let count = 0;
  for (const p of PROFILES.filter((x) => ['HEA', 'HEB'].includes(x.f) && x.h <= 300)) {
    for (const axis of ['y', 'z']) {
      const entry = TABLE[`${p.n}|S235|${axis}`];
      if (!entry) continue;
      GRIDS[entry[0]].forEach((L, k) => {
        if (L === 0) return;
        const a = steelAxis(p, 235, L, axis);
        worst = Math.max(worst, Math.abs(a.nRd / entry[k + 1] - 1));
        count++;
      });
    }
  }
  checks.push({ ok: worst < 0.015, text: `HEA/HEB bis 300, S235: ${count} Tabellenwerte, grösste Abweichung ${(worst * 100).toFixed(2)} %` });
  // Massgebende Achse und Nachweis
  const r = steelColumn({ profile: profile('HEB 160'), grade: 'S235', LkY: 4, LkZ: 4, Nd: 600, c4: C4 });
  checks.push({ ok: r.governing.axis === 'z' && near(r.nRd, 620, 0.005) && r.ok, text: `HEB 160, S235, L_K = 4 m, N_d = 600 kN: N_K,Rd = ${r.nRd.toFixed(0)} kN um ${r.governing.axis}, η = ${(r.eta * 100).toFixed(0)} %` });
  // C4 zwischen den Tabellenlängen: kein falsches „Klasse 4“ (Verhältnis Tabelle/Formel wird interpoliert)
  for (const [name, grade, axis, Lk] of [['HEB 300', 'S235', 'z', 1.5], ['HEA 100', 'S235', 'z', 0.5], ['RRW 200x100x8', 'S355', 'z', 2.5]]) {
    const rr = steelColumn({ profile: profile(name), grade, LkY: Lk, LkZ: Lk, Nd: 1, c4: C4 });
    const ax = rr[axis];
    checks.push({ ok: !ax.fromTable && Math.abs(ax.nRd - ax.nRdFormula) < 1e-9, text: `${name} ${grade} um ${axis}, L_K = ${Lk} m (zwischen zwei Tabellenlängen): Formel ${ax.nRdFormula.toFixed(0)} kN gilt, Verhältnis Tabelle/Formel ${ax.c4.ratio.toFixed(3)}` });
  }
  // Echter Klasse-4-Querschnitt: Tabelle liegt tiefer, Tabellenwert gilt
  const c4case = steelColumn({ profile: profile('HEA 1000'), grade: 'S235', LkY: 4, LkZ: 4, Nd: 1, c4: C4 });
  checks.push({ ok: c4case.y.fromTable && near(c4case.y.nRd, c4case.y.c4.N1, 1e-6), text: `HEA 1000, S235, um y, L_K = 4 m (Klasse 4): Formel ${c4case.y.nRdFormula.toFixed(0)} kN, C4 ${c4case.y.nRd.toFixed(0)} kN gilt` });
  // Profildaten: gegen SZS C5 korrigierte Werte und innere Stimmigkeit aller Profile
  checks.push({ ok: profile('HEB 160').Iy === 2490 && profile('HEM 400').Iz === 19330 && profile('HEB 700').Iz === 14400, text: `C5-Korrekturen: HEB 160 I_y = ${profile('HEB 160').Iy}, HEM 400 I_z = ${profile('HEM 400').Iz}, HEB 700 I_z = ${profile('HEB 700').Iz} cm⁴ (soll 2490, 19330, 14400)` });
  const inconsistent = PROFILES.filter((p) => Math.abs(Math.sqrt(p.Iy / p.A) / p.iy - 1) > 0.02 || Math.abs(Math.sqrt(p.Iz / p.A) / p.iz - 1) > 0.02);
  checks.push({ ok: inconsistent.length === 0, text: `Alle ${PROFILES.length} Profile: i = √(I/A) stimmt${inconsistent.length ? ` nicht bei ${inconsistent.map((p) => p.n).join(', ')}` : ''}` });
  // k_c-Ablesung: λ_rel auf zwei Stellen, ungerade Hundertstel auf die nächste Zeile
  const rowCases = [[1.3674, 1.38], [1.184, 1.18], [1.0234, 1.02], [1.031, 1.04], [2.493, 2.5], [1.355, 1.36]];
  const rowBad = rowCases.filter(([l, e]) => Math.abs(kcTableRow(l) - e) > 1e-9);
  checks.push({ ok: rowBad.length === 0, text: `k_c-Tabellenzeile: ${rowCases.map(([l]) => `${l} → ${kcTableRow(l).toFixed(2)}`).join(', ')}` });
  // Holz: Kontrolle der kc-Formel (lambda_rel ≤ 0.3 → kc = 1)
  const t = timberColumn({ material: TIMBER.GL24h, shape: 'rect', b: 200, h: 200, LkY: 0.5, LkZ: 0.5, Nd: 100 });
  checks.push({ ok: t.y.kc === 1 && near(t.nRd, TIMBER.GL24h.fc0d * 40000 / 1000, 1e-9), text: `GL24h 200×200, L_K = 0.5 m: k_c = ${t.y.kc}, N_K,Rd = ${t.nRd.toFixed(1)} kN` });
  return { title: 'Stütze (Knicken)', source: 'SIA 263 / SZS C4, SIA 265', checks };
}

function beamDesignTests() {
  const checks = [];
  const r = steelBeam({ profile: profile('IPE 200'), grade: 'S235', Md: 40, Vd: 30, plastic: true });
  checks.push({ ok: near(r.mRd, (220.6 * 23.5) / 1.05 / 100, 1e-6) && near(r.wErf, (40 * 100 * 1.05) / 23.5, 1e-6), text: `IPE 200, S235: M_Rd = ${r.mRd.toFixed(2)} kNm, W_pl,erf(40 kNm) = ${r.wErf.toFixed(1)} cm³` });
  const t = timberBeam({ material: TIMBER.GL24h, b: 160, h: 400, Md: 50, Vd: 40 });
  checks.push({ ok: near(t.sigma, (50e6 * 6) / (160 * 400 ** 2), 1e-9) && near(t.tau, (1.5 * 40000) / (160 * 400), 1e-9), text: `GL24h 160×400: σ = ${t.sigma.toFixed(2)} N/mm², τ = ${t.tau.toFixed(3)} N/mm²` });
  return { title: 'Träger', source: 'Biegung und Schub', checks };
}

// Zugstab (Hänger): N_t,Rd = A · f_y / γ_M1 (Stahl), f_t,0,d · η_w · A (Holz)
function tensionTests() {
  const checks = [];
  const s = steelTension({ profile: profile('IPE 200'), grade: 'S235', Nd: 200 });
  checks.push({ ok: near(s.nRd, (28.5 * 23.5) / 1.05, 1e-9) && near(s.aErf, (200 * 1.05) / 23.5, 1e-9) && s.ok, text: `IPE 200, S235, N_d = 200 kN Zug: N_t,Rd = ${s.nRd.toFixed(1)} kN (soll 637.9), A_erf = ${s.aErf.toFixed(2)} cm² (soll 8.94)` });
  const t = timberTension({ material: TIMBER.C24, b: 120, h: 220, Nd: 100 });
  checks.push({ ok: near(t.nRd, (8.5 * 120 * 220) / 1000, 1e-9) && near(t.eta, 100 / 224.4, 1e-9), text: `C24 120/220, N_d = 100 kN Zug: N_t,Rd = ${t.nRd.toFixed(1)} kN (soll 224.4 mit f_t,0,d = 8.5)` });
  const w = timberTension({ material: TIMBER.GL24h, shape: 'round', d: 200, Nd: 300, etaW: 0.8 });
  checks.push({ ok: near(w.nRd, (12.8 * 0.8 * Math.PI * 200 ** 2) / 4 / 1000, 1e-9) && w.ok, text: `GL24h Ø 200, η_w = 0.8: N_t,Rd = ${w.nRd.toFixed(1)} kN (soll ${((12.8 * 0.8 * Math.PI * 200 ** 2) / 4 / 1000).toFixed(1)})` });
  const all = Object.entries(TIMBER).filter(([, m]) => !(m.ft0d > 0 && m.ft0d < m.fmd));
  checks.push({ ok: all.length === 0, text: `f_t,0,d für alle Holzklassen vorhanden und kleiner als f_m,d${all.length ? `: fehlt bei ${all.map(([id]) => id).join(', ')}` : ''}` });
  return { title: 'Zugstab (Hänger)', source: 'SIA 263, SIA 265', checks };
}

export function runDesignTests() {
  return [deflectionTests(), columnTests(), beamDesignTests(), tensionTests(), sketchTests(), ...courseTests()];
}

// Musterlösungen aus dem Unterricht (Baustatik, Bauschule): Knicken Stahl (C4/21, C4/06), Knicken Holz (HBT 2021),
// Lernaufgaben LA-3/LA-4 und Skript 2.4. Toleranz 1 %: Die Lösungen runden Zwischenwerte und lesen Tabellen ab.
function courseTests() {
  const steel = [];
  const col = (name, grade, LkY, LkZ, Nd) => steelColumn({ profile: profile(name), grade, LkY, LkZ, Nd, c4: C4 });
  let r = col('HEB 200', 'S235', 5, 5, 850);
  steel.push({ ok: near(r.nRd, 894, 0.01) && r.ok, text: `HEB 200, S235, L = 5.00 m gelenkig: N_K,Rd = ${r.nRd.toFixed(0)} kN (soll 894 kN wie C4/06; die Handlösung 877 kN hat einen Formelfehler)` });
  r = col('RRW 100x6.3', 'S355', 0.71 * 3.2, 0.71 * 3.2, 600);
  steel.push({ ok: near(r.nRd, 630, 0.01) && r.ok, text: `RRW 100·100·6.3, S355, β = 0.71, L = 3.20 m: N_K,Rd = ${r.nRd.toFixed(0)} kN (soll 630 kN)` });
  r = col('RRW 150x100x8', 'S355', 3.5, 3.5, 640);
  steel.push({ ok: near(r.nRd, 689, 0.01) && r.governing.axis === 'z' && r.ok, text: `RRW 150·100·8, S355, beidseitig eingespannt L = 7.00 m: N_K,Rd = ${r.nRd.toFixed(0)} kN um ${r.governing.axis} (soll 689 kN)` });
  r = col('HEB 240', 'S235', 0.71 * 4.3, 0.5 * 4.3, 2000);
  steel.push({ ok: near(r.y.nRd, 2275, 0.01) && near(r.z.nRd, 2160, 0.01), text: `HEB 240, S235, L_K,y = 0.71·4.30, L_K,z = 0.5·4.30: N_Ky,Rd = ${r.y.nRd.toFixed(0)} (soll 2275), N_Kz,Rd = ${r.z.nRd.toFixed(0)} kN (soll 2160)` });
  r = col('HEA 260', 'S460', 9.5, 9.5, 520);
  steel.push({ ok: near(r.nRd, 646, 0.01) && r.ok, text: `HEA 260, S460, L = 9.50 m: N_K,Rd = ${r.nRd.toFixed(0)} kN (soll 646 kN, LA-4)` });
  r = col('HEA 240', 'S235', 6, 6, 784);
  steel.push({ ok: near(r.nRd, 866, 0.01) && near(r.eta, 0.91, 0.02), text: `HEA 240, S235, L_K = 6.00 m: N_K,Rd = ${r.nRd.toFixed(0)} kN, η = ${r.eta.toFixed(2)} (soll 866 kN, 0.91)` });

  const timber = [];
  const tcol = (material, shape, b, h, d, Lk, Nd, etaW = 1) => timberColumn({ material: TIMBER[material], shape, b, h, d, LkY: Lk, LkZ: Lk, Nd, etaW, table: true });
  let t = tcol('C24', 'rect', 120, 220, null, 2.7, 135);
  timber.push({ ok: near(t.nRd, 144, 0.01) && Math.abs(t.z.used - 1.38) < 1e-9, text: `C24 120/220, L = 2.70 m: λ_rel → ${t.z.used.toFixed(2)}, k_c = ${t.z.kc.toFixed(3)}, N_K,Rd = ${t.nRd.toFixed(1)} kN (soll 1.38, 0.44, 144 kN)` });
  t = tcol('C24', 'round', null, null, 160, 2.7, 135);
  timber.push({ ok: near(t.nRd, 139, 0.01) && near(t.eta, 0.97, 0.01), text: `C24 Ø160, L = 2.70 m: k_c = ${t.y.kc.toFixed(3)}, N_K,Rd = ${t.nRd.toFixed(1)} kN, η = ${t.eta.toFixed(2)} (soll 0.558, 139 kN, 0.97)` });
  t = tcol('GL24h', 'rect', 100, 240, null, 2.7, 135);
  const t220 = tcol('GL24h', 'rect', 100, 220, null, 2.7, 135);
  timber.push({ ok: near(t.z.kc, 0.379, 0.005) && t.ok && !t220.ok, text: `GL24h b = 100, L = 2.70 m: k_c = ${t.z.kc.toFixed(3)}; 100/220 ${t220.ok ? 'reicht' : 'reicht nicht'}, 100/240 ${t.ok ? 'reicht' : 'reicht nicht'} (soll 0.379, h_erf 223 → 100/240)` });
  t = tcol('GL24h', 'rect', 120, 140, null, 2.7, 135);
  timber.push({ ok: near(t.z.kc, 0.526, 0.005) && t.ok, text: `GL24h 120/140, L = 2.70 m: k_c = ${t.z.kc.toFixed(3)}, N_K,Rd = ${t.nRd.toFixed(1)} kN (soll 0.526, h_erf 134 → 120/140)` });
  t = tcol('C24', 'round', null, null, 220, 3.5, 280);
  timber.push({ ok: near(t.nRd, 283, 0.01), text: `C24 Ø220, L = 3.50 m: k_c = ${t.y.kc.toFixed(3)}, N_K,Rd = ${t.nRd.toFixed(1)} kN (soll 0.601, 283 kN)` });
  t = tcol('C24', 'round', null, null, 240, 3.5, 280, 0.8);
  timber.push({ ok: near(t.nRd, 296, 0.025) && Math.abs(t.y.used - 1.02) < 1e-9, text: `C24 Ø240, bewittert η_w = 0.8: λ_rel → ${t.y.used.toFixed(2)}, N_K,Rd = ${t.nRd.toFixed(1)} kN, η = ${t.eta.toFixed(2)} (soll 296 kN, 0.95; die Lösung liest mit λ_rel = 1.03 statt 1.023 → 1.02 ab, daher rund 2 % weniger)` });
  t = tcol('GL28h', 'rect', 220, 880, null, 9.5, 520);
  timber.push({ ok: near(t.nRd, 557, 0.01), text: `GL28h 220/880, L_K = 9.50 m: λ_rel → ${t.z.used.toFixed(2)}, k_c = ${t.z.kc.toFixed(3)}, N_K,Rd = ${t.nRd.toFixed(1)} kN (soll 2.50, 0.154, 557 kN)` });
  t = tcol('GL24h', 'rect', 280, 280, null, 5, 642, 0.8);
  timber.push({ ok: near(t.eta, 0.87, 0.01) && near(t.z.kc, 0.735, 0.005), text: `GL24h 280/280, η_w = 0.8, L_K = 5.00 m: k_c = ${t.z.kc.toFixed(3)}, η = ${t.eta.toFixed(2)} (soll 0.735, 0.87)` });

  const beams = [];
  // T1: Einfeldträger 4.80 m, q_d = 1.35·5 + 1.5·25 = 44.25 kN/m → HEB 200
  const b1 = beam(4.8, [0, 4.8], [{ kind: 'q', dir: 'down', value: 1.35 * 5 + 1.5 * 25, x1: 0, x2: 4.8, name: '' }]);
  const md1 = b1.forces.mMax.m;
  const pick1 = PROFILES.filter((p) => p.f === 'HEB').sort((a, c) => a.g - c.g).find((p) => steelBeam({ profile: p, grade: 'S235', Md: md1, Vd: 106.2, plastic: true }).ok);
  const r1 = steelBeam({ profile: pick1, grade: 'S235', Md: md1, Vd: 106.2, plastic: true });
  beams.push({ ok: near(md1, 127.6, 0.005) && near(r1.wErf, 570.1, 0.005) && pick1.n === 'HEB 200', text: `HEB, S235, l = 4.80 m: M_d = ${md1.toFixed(1)} kNm, W_pl,erf = ${r1.wErf.toFixed(1)} cm³ → ${pick1.n} (soll 127.6, 570.1 → HEB 200)` });
  // T2: Kragarm 2 m + Feld 6 m + Kragarm 3 m, q_d = 27 kN/m, F_d = 90 kN in Feldmitte
  const b2 = beam(11, [2, 8], [{ kind: 'q', dir: 'down', value: 27, x1: 0, x2: 11, name: '' }, { kind: 'F', dir: 'down', value: 90, x: 5, z: null, name: '' }]);
  const vd2 = Math.max(Math.abs(b2.forces.vMax.v), Math.abs(b2.forces.vMin.v));
  const md2 = Math.max(Math.abs(b2.forces.mMax.m), Math.abs(b2.forces.mMin.m));
  const hea200 = steelBeam({ profile: profile('HEA 200'), grade: 'S355', Md: md2, Vd: vd2 });
  const hea220 = steelBeam({ profile: profile('HEA 220'), grade: 'S355', Md: md2, Vd: vd2 });
  beams.push({ ok: near(b2.result.reactions[0].Rz, 168.75, 1e-6) && near(vd2, 137.25, 1e-6) && near(md2, 168.75, 1e-6) && !hea200.ok && hea220.ok, text: `Kragträger: A_d = ${b2.result.reactions[0].Rz.toFixed(2)}, V_d = ${vd2.toFixed(2)}, M_d = ${md2.toFixed(2)} → HEA 200 ${hea200.ok ? 'reicht' : 'reicht nicht'}, HEA 220 ${hea220.ok ? 'reicht' : 'reicht nicht'} (soll 168.75, 137.25, 168.75 → HEA 220 S355)` });
  const hM = Math.sqrt((6 * md2 * 1e6) / (16 * 200));
  const hV = (1.5 * vd2 * 1000) / (1.8 * 200);
  const h2 = Math.ceil(Math.max(hM, hV) / 40) * 40;
  beams.push({ ok: near(hM, 563, 0.002) && near(hV, 572, 0.002) && h2 === 600, text: `GL24h b = 200: h_M = ${hM.toFixed(1)}, h_V = ${hV.toFixed(1)} mm → 200/${h2} (soll 563, 572 → 200/600)` });
  // T6 und T7: Widerstände aus der Profiltabelle (C5)
  const hea400 = steelBeam({ profile: profile('HEA 400'), grade: 'S355', Md: 713, Vd: 420 });
  beams.push({ ok: near(hea400.vRd, 1119, 0.005) && near(hea400.mRd, 866, 0.005), text: `HEA 400, S355: V_Rd = ${hea400.vRd.toFixed(0)}, M_Rd = ${hea400.mRd.toFixed(0)} (soll 1119, 866)` });
  const heb400 = steelBeam({ profile: profile('HEB 400'), grade: 'S235', Md: 0, Vd: 0 });
  const span = maxSpan(heb400.mRd, heb400.vRd, 1.35 * 1.55 + 1.5 * 40);
  beams.push({ ok: near(heb400.vRd, 904, 0.005) && near(heb400.mRd, 723.3, 0.003) && near(span.l, 9.653, 0.003) && near(span.lV, 29.11, 0.005), text: `HEB 400, S235, q_d = 62.09 kN/m: V_Rd = ${heb400.vRd.toFixed(0)}, M_Rd = ${heb400.mRd.toFixed(1)}, l_V = ${span.lV.toFixed(2)}, l_M = ${span.lM.toFixed(3)} m (soll 904, 723.3, 29.11, 9.653)` });
  const gl = timberBeam({ material: TIMBER.GL28c, b: 180, h: 920, Md: 449.3, Vd: 177.1 });
  beams.push({ ok: near(gl.vRd, 199, 0.005) && near(gl.etaV, 0.89, 0.01), text: `GL28c 180/920: V_Rd = ${gl.vRd.toFixed(1)} kN, η_V = ${gl.etaV.toFixed(2)} (soll 199, 0.89; M_Rd mit HBT 2021 f_m,d = 18.7 statt 18.5)` });
  // T4: GL24h, M_d = 40 kNm, b = 120 → h_M = 353.6 → 360
  const hM4 = Math.sqrt((6 * 40e6) / (16 * 120));
  beams.push({ ok: near(hM4, 353.6, 0.001), text: `GL24h b = 120, M_d = 40 kNm: h_M = ${hM4.toFixed(1)} mm → 360 (soll 353.6 → 120/360)` });

  return [
    { title: 'Musterlösungen Stahlstützen', source: 'Lösungen Knicken Stahl C4/21_C4/06 2023, LA-4 SS24', checks: steel },
    { title: 'Musterlösungen Holzstützen', source: 'Lösungen Knicken Holz HBT 2021, LA-4 SS24 (k_c wie aus der Tabelle)', checks: timber },
    { title: 'Musterlösungen Träger', source: 'Skript 2.4 (HTy-25), LA-3 SS24', checks: beams },
  ];
}

// Querschnittsskizzen und Begriffe: jedes Profil zeichnet ohne NaN, die Formelzeichen werden erkannt
function sketchTests() {
  const checks = [];
  const bad = [];
  for (const p of PROFILES) {
    for (const options of [{}, { highlight: 'shear' }, { buckling: 'z' }, { buckling: 'y' }]) {
      const svg = steelSectionSvg(p, options);
      if (/NaN|undefined|Infinity/.test(svg) || !svg.startsWith('<svg')) bad.push(`${p.n} ${JSON.stringify(options)}`);
    }
  }
  checks.push({ ok: bad.length === 0, text: `Skizzen aller ${PROFILES.length} Stahlprofile (normal, A_v, Knicken y/z)${bad.length ? `: Fehler bei ${bad.slice(0, 5).join(', ')}` : ' ohne NaN'}` });
  const wood = [timberSectionSvg({ shape: 'rect', b: 160, h: 400 }), timberSectionSvg({ shape: 'rect', b: 240, h: 120 }, { buckling: 'z' }), timberSectionSvg({ shape: 'round', d: 220 }, { buckling: 'y' })];
  checks.push({ ok: wood.every((s) => s.startsWith('<svg') && !/NaN|undefined/.test(s)), text: 'Holzskizzen Rechteck (hoch, flach) und Rundholz ohne NaN' });
  // KaTeX-Annotation nachgebildet (so legt KaTeX den TeX-Quelltext ab)
  const annotated = (source) => `<annotation encoding="application/x-tex">${source.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</annotation>`;
  const seen = new Set();
  const first = termsBox(annotated(String.raw`W_{pl,y,erf} = \frac{M_d \cdot \gamma_{M1}}{f_y}`) + annotated(String.raw`M_{Rd} = 10 \le 12`), seen);
  const names = [...first.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  const again = termsBox(annotated(String.raw`M_{Rd} = W_{pl,y} \cdot f_y`), seen);
  checks.push({ ok: names.join(' ') === 'Wpl,y erf Md γM1 fy MRd' && again === '', text: `Begriffe in der Reihenfolge des Auftretens: ${names.join(', ')}; zweites Mal nicht wiederholt: ${again === '' ? 'ja' : 'nein'}` });
  const timber = termsBox(annotated(String.raw`\lambda_y = \frac{L_{K}}{i_y} = 43.3,\qquad \lambda_{rel,y} = 0.72`) + annotated(String.raw`k_{c,y} = 0.85`), new Set());
  const tnames = [...timber.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  checks.push({ ok: tnames.join(' ') === 'λ LK iy, iz λrel kc', text: `Holz: ${tnames.join(', ')} (soll λ, LK, iy/iz, λrel, kc)` });
  const pull = termsBox(annotated(String.raw`L = z_{A} - z_{\text{Achse}} = 0.90`) + annotated(String.raw`A_{erf} = \frac{N_d \cdot \gamma_{M1}}{f_y}`) + annotated(String.raw`N_{t,Rd} = \frac{A \cdot f_y}{\gamma_{M1}}`), new Set());
  const pnames = [...pull.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  checks.push({ ok: pnames.join(' ') === 'erf Nd γM1 fy Nt,Rd A', text: `Zug: ${pnames.join(', ')} (soll erf, Nd, γM1, fy, Nt,Rd, A; Lager A in z_A ist keine Fläche)` });
  return { title: 'Skizzen und Begriffe', source: 'section-svg.js, design-terms.js', checks };
}
