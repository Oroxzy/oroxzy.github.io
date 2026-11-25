// Bemessung: Stützen (Knicken) und Träger (Biegung, Querkraft, Durchbiegung) in Stahl und Holz.
// Stahl nach SIA 263 (gamma_M1 = 1.05, Knickspannungskurven a0–d), Holz nach SIA 265.
// Formeln und Knickkurven-Zuordnung wie in BeamSmith (docs/berechnung.md, ColumnFinderWindow).
// Einheiten in den Ergebnissen: kN, kNm, m, mm, cm, N/mm².

export const E_STEEL = 210000; // N/mm²
export const GAMMA_M1 = 1.05;

export const STEEL_GRADES = { S235: 235, S275: 275, S355: 355, S460: 460 };

export const CURVE_ALPHA = { a0: 0.13, a: 0.21, b: 0.34, c: 0.49, d: 0.76 };

// Eulerfälle: Knicklänge L_K = beta · L
export const EULER_CASES = [
  { id: 2, beta: 1, short: 'gelenkig – gelenkig', text: 'Fall 2: beidseitig gelenkig, β = 1' },
  { id: 1, beta: 2, short: 'eingespannt – frei', text: 'Fall 1: unten eingespannt, oben frei, β = 2' },
  { id: 3, beta: 0.7, short: 'eingespannt – gelenkig', text: 'Fall 3: unten eingespannt, oben gelenkig, β = 0.7 (Musterlösungen teils 0.71)' },
  { id: 4, beta: 0.5, short: 'eingespannt – eingespannt', text: 'Fall 4: beidseitig eingespannt, β = 0.5' },
];

export const STEEL_FAMILIES = [
  { id: 'IPE', text: 'IPE' },
  { id: 'HEA', text: 'HEA' },
  { id: 'HEB', text: 'HEB' },
  { id: 'HEM', text: 'HEM' },
  { id: 'UPE', text: 'UPE' },
  { id: 'UPN', text: 'UPN' },
  { id: 'RRW', text: 'RRW (warmgefertigt)' },
  { id: 'RRK', text: 'RRK (kaltgefertigt)' },
];

// Knickspannungskurve nach SIA 263 Tabelle 12 / EN 1993-1-1 Tabelle 6.2 (wie die C4-Tabellen).
export function bucklingCurve(profile, axis) {
  const family = profile.f;
  if (family === 'RRW') return 'a';
  if (family === 'RRK') return 'c';
  if (family === 'UPE' || family === 'UPN') return 'c';
  if (['IPE', 'HEA', 'HEB', 'HEM'].includes(family)) {
    const tf = profile.tf || 0;
    if (tf > 100) return 'd';
    const deep = profile.h / profile.b > 1.2;
    if (deep && tf <= 40) return axis === 'z' ? 'b' : 'a';
    return axis === 'z' ? 'c' : 'b';
  }
  return 'b';
}

export function curveReason(profile, axis) {
  const family = profile.f;
  if (family === 'RRW') return 'warmgefertigtes Hohlprofil';
  if (family === 'RRK') return 'kaltgefertigtes Hohlprofil';
  if (family === 'UPE' || family === 'UPN') return 'U-Profil';
  const ratio = profile.h / profile.b;
  const tf = profile.tf || 0;
  if (tf > 100) return `t<sub>f</sub> = ${tf} mm > 100 mm`;
  return `gewalztes I-Profil, h/b = ${fmt(ratio, 2)} ${ratio > 1.2 ? '&gt;' : '≤'} 1.2, t<sub>f</sub> = ${fmt(tf, 1)} mm`;
}

function fmt(value, digits) {
  return Number(value).toFixed(digits);
}

// Abminderungsfaktor chi nach SIA 263 (Phi-Formel)
export function steelChi(lambdaBar, alpha) {
  if (!(lambdaBar > 0)) return { phi: 0, chi: 1 };
  const phi = 0.5 * (1 + alpha * (lambdaBar - 0.2) + lambdaBar * lambdaBar);
  const chi = Math.min(1, 1 / (phi + Math.sqrt(Math.max(0, phi * phi - lambdaBar * lambdaBar))));
  return { phi, chi };
}

// Knickwiderstand um eine Achse. Lk in m, fy in N/mm². Profilwerte in cm/cm².
export function steelAxis(profile, fy, Lk, axis) {
  const i = axis === 'z' ? profile.iz : profile.iy; // cm
  const I = axis === 'z' ? profile.Iz : profile.Iy; // cm⁴
  const A = profile.A; // cm²
  const lambdaK = (Lk * 100) / i;
  const lambdaE = Math.PI * Math.sqrt(E_STEEL / fy);
  const lambdaBar = lambdaK / lambdaE;
  const curve = bucklingCurve(profile, axis);
  const alpha = CURVE_ALPHA[curve];
  const { phi, chi: chiExact } = steelChi(lambdaBar, alpha);
  // wie von Hand: χ auf drei Stellen (so steht es im Lösungsweg), damit das gezeigte Produkt aufgeht
  const chi = Math.round(chiExact * 1000) / 1000;
  const npl = (A * 100 * fy) / 1000; // kN
  const nRd = (chi * npl) / GAMMA_M1;
  const ncr = (Math.PI ** 2 * E_STEEL * I * 1e4) / (Lk * 1000) ** 2 / 1000; // kN
  return { axis, Lk, i, I, A, lambdaK, lambdaE, lambdaBar, curve, alpha, phi, chi, npl, nRd, ncr };
}

// C4-Tabellenwert N_K,Rd mit linearer Interpolation zwischen den Knicklängen.
export function c4Lookup(c4, name, grade, axis, Lk) {
  if (!c4) return null;
  const entry = c4.TABLE[`${name}|${grade}|${axis}`];
  if (!entry) return null;
  const grid = c4.GRIDS[entry[0]];
  const values = entry.slice(1);
  if (Lk < grid[0] - 1e-9 || Lk > grid[grid.length - 1] + 1e-9) return { outOfRange: true, max: grid[grid.length - 1] };
  for (let k = 0; k < grid.length; k++) {
    if (Math.abs(grid[k] - Lk) < 1e-9) return { nRd: values[k], exact: true, L1: grid[k], N1: values[k] };
    if (grid[k] > Lk) {
      const L0 = grid[k - 1];
      const N0 = values[k - 1];
      const L1 = grid[k];
      const N1 = values[k];
      return { nRd: N0 + ((N1 - N0) * (Lk - L0)) / (L1 - L0), exact: false, L0, N0, L1, N1 };
    }
  }
  return null;
}

// Stahlstütze: beide Achsen, massgebend ist der kleinere Widerstand.
export function steelColumn({ profile, grade, LkY, LkZ, Nd, c4 }) {
  const fy = STEEL_GRADES[grade];
  const y = steelAxis(profile, fy, LkY, 'y');
  const z = steelAxis(profile, fy, LkZ, 'z');
  // Wie BeamSmith: Liegt die C4-Tabelle tiefer als die Formel (schlanke Querschnitte, Klasse 4: lokales Beulen),
  // gilt der Tabellenwert. Zwischen zwei Tabellenlängen wird das Verhältnis Tabelle/Formel interpoliert – eine
  // gerade Linie zwischen den Tabellenwerten läge am Knick der Knickkurve sonst zu tief.
  for (const ax of [y, z]) {
    ax.c4 = c4Lookup(c4, profile.n, grade, ax.axis, ax.Lk);
    ax.nRdFormula = ax.nRd;
    ax.fromTable = false;
    if (ax.c4 && !ax.c4.outOfRange) {
      let ratio;
      if (ax.c4.exact) {
        ratio = ax.c4.N1 / ax.nRd;
      } else {
        const r0 = ax.c4.N0 / steelAxis(profile, fy, ax.c4.L0, ax.axis).nRd;
        const r1 = ax.c4.N1 / steelAxis(profile, fy, ax.c4.L1, ax.axis).nRd;
        ratio = r0 + ((r1 - r0) * (ax.Lk - ax.c4.L0)) / (ax.c4.L1 - ax.c4.L0);
      }
      ax.c4.ratio = ratio;
      if (ratio < 0.995) {
        ax.nRd = ratio * ax.nRdFormula;
        ax.fromTable = true;
      }
    }
  }
  const governing = z.nRd < y.nRd ? z : y;
  const nRd = governing.nRd;
  return { profile, grade, fy, y, z, governing, nRd, Nd, eta: Nd / nRd, ok: Nd <= nRd + 1e-9 };
}

export function familyProfiles(profiles, family) {
  return profiles.filter((p) => p.f === family).slice().sort((a, b) => a.g - b.g || a.A - b.A);
}

// Leichtestes Profil der Reihe, das den Nachweis erfüllt (null, wenn keines reicht).
export function findSteelColumn(profiles, options) {
  for (const profile of familyProfiles(profiles, options.family)) {
    const result = steelColumn({ ...options, profile });
    if (result.ok) return result;
  }
  return null;
}

// ---------- Holz ----------
// Bemessungswerte nach SIA 265 aus den Holzbautabellen HBT 2021 (für eta_w = 1), N/mm².
// fc90d: Querdruck „generell“. lambda0: Bezugsschlankheit für lambda_rel = lambda / lambda0
// (Unterricht und BeamSmith: 57 für Vollholz, 60 für Brettschichtholz).
export const TIMBER = {
  C16: { text: 'C16 (Vollholz)', glulam: false, fmd: 9.4, fc0d: 10, fvd: 1.5, fc90d: 1.5, E: 8000 },
  C24: { text: 'C24 (Vollholz)', glulam: false, fmd: 14.1, fc0d: 12.4, fvd: 1.5, fc90d: 1.8, E: 11000 },
  C30: { text: 'C30 (Vollholz)', glulam: false, fmd: 17.6, fc0d: 14.1, fvd: 1.5, fc90d: 2.0, E: 12000 },
  D30: { text: 'D30 (Laubholz)', glulam: false, fmd: 17.6, fc0d: 14.1, fvd: 2.0, fc90d: 5.3, E: 11000 },
  GL20h: { text: 'GL20h (Brettschichtholz)', glulam: true, fmd: 13.3, fc0d: 13.3, fvd: 1.8, fc90d: 1.8, E: 8400 },
  GL24c: { text: 'GL24c (Brettschichtholz)', glulam: true, fmd: 16, fc0d: 14.3, fvd: 1.8, fc90d: 1.9, E: 11000 },
  GL24h: { text: 'GL24h (Brettschichtholz)', glulam: true, fmd: 16, fc0d: 16, fvd: 1.8, fc90d: 1.9, E: 11500 },
  GL28c: { text: 'GL28c (Brettschichtholz)', glulam: true, fmd: 18.7, fc0d: 16, fvd: 1.8, fc90d: 2.0, E: 12500 },
  GL28h: { text: 'GL28h (Brettschichtholz)', glulam: true, fmd: 18.7, fc0d: 18.7, fvd: 1.8, fc90d: 2.0, E: 12600 },
  GL32c: { text: 'GL32c (Brettschichtholz)', glulam: true, fmd: 21.3, fc0d: 16.3, fvd: 1.8, fc90d: 2.1, E: 13500 },
  GL32h: { text: 'GL32h (Brettschichtholz)', glulam: true, fmd: 21.3, fc0d: 21.3, fvd: 1.8, fc90d: 2.1, E: 14200 },
};
for (const material of Object.values(TIMBER)) material.lambda0 = material.glulam ? 60 : 57;

// Zug parallel zur Faser f_t,0,d in N/mm²: f_t,0,k / γ_M wie f_m,d und f_c,0,d oben
// (EN 338:2016 Vollholz, γ_M = 1.7; EN 14080:2013 Brettschichtholz, γ_M = 1.5).
const TIMBER_FT0D = { C16: 5.0, C24: 8.5, C30: 11.2, D30: 10.6, GL20h: 10.7, GL24c: 11.3, GL24h: 12.8, GL28c: 13.0, GL28h: 14.9, GL32c: 13.0, GL32h: 17.1 };
for (const [id, ft0d] of Object.entries(TIMBER_FT0D)) TIMBER[id].ft0d = ft0d;

// Feuchteklassen nach SIA 265: Abminderung eta_w der Festigkeiten
export const TIMBER_EXPOSURE = [
  { id: 'dry', factor: 1.0, text: 'Feuchteklasse 1: vor Witterung geschützt (η_w = 1.0)' },
  { id: 'partial', factor: 0.8, text: 'Feuchteklasse 2: teilweise geschützt oder bewittert (η_w = 0.8)' },
  { id: 'wet', factor: 0.6, text: 'Feuchteklasse 3: feucht oder unter Wasser (η_w = 0.6)' },
];

// Ablesen wie im Unterricht aus der Tabelle HBT S. 52 (Schritt 0.02): lambda_rel auf zwei Stellen runden,
// ein Wert zwischen zwei Zeilen (ungerade Hundertstel) gilt mit der nächsthöheren Zeile.
export function kcTableRow(lambdaRel) {
  const rounded = Math.round(lambdaRel * 100) / 100;
  return Math.round(Math.ceil(rounded / 0.02 - 1e-9) * 2) / 100;
}

// Knickbeiwert k_c nach SIA 265 (265.30/31); table: wie aus der HBT-Tabelle abgelesen
export function timberKc(lambdaRel, betaC, table = false) {
  const used = table ? kcTableRow(lambdaRel) : lambdaRel;
  if (used <= 0.3) return { used, k: null, kc: 1 };
  const k = 0.5 * (1 + betaC * (used - 0.3) + used * used);
  const kc = Math.min(1, 1 / (k + Math.sqrt(Math.max(0, k * k - used * used))));
  return { used, k, kc };
}

// Querschnitt: Rechteck b × h (Achse y knickt über h, z über b) oder Rundholz Ø d (mm)
export function timberSection(shape, b, h, d) {
  if (shape === 'round') return { shape, d, A: (Math.PI * d * d) / 4, iy: d / 4, iz: d / 4, Iy: (Math.PI * d ** 4) / 64 };
  return { shape: 'rect', b, h, A: b * h, iy: h / Math.sqrt(12), iz: b / Math.sqrt(12), Iy: (b * h ** 3) / 12 };
}

export function timberAxis(material, section, Lk, axis, etaW, table = false) {
  const i = axis === 'z' ? section.iz : section.iy; // mm
  const lambda = (Lk * 1000) / i;
  const lambdaRel = lambda / material.lambda0;
  const betaC = material.glulam ? 0.1 : 0.2;
  const { used, k, kc: kcExact } = timberKc(lambdaRel, betaC, table);
  // wie aus der Tabelle bzw. von Hand: k_c auf drei Stellen, damit das gezeigte Produkt aufgeht
  const kc = Math.round(kcExact * 1000) / 1000;
  const fc0d = material.fc0d * etaW;
  const nRd = (kc * fc0d * section.A) / 1000;
  return { axis, Lk, A: section.A, i, lambda, lambdaRel, used, betaC, k, kc, fc0d, nRd };
}

// ---------- Zugstab (Hänger) ----------
// Stahl, SIA 263: Fliessen im Bruttoquerschnitt N_t,Rd = A · f_y / γ_M1 (A in cm², f_y in kN/cm²).
// Ein gezogener Stab knickt nicht; die Länge spielt keine Rolle.
export function steelTension({ profile, grade, Nd }) {
  const fy = STEEL_GRADES[grade];
  const nRd = (profile.A * (fy / 10)) / GAMMA_M1;
  return { profile, fy, nRd, aErf: (Nd * GAMMA_M1) / (fy / 10), Nd, eta: Nd / nRd, ok: Nd <= nRd + 1e-9 };
}

// Holz, SIA 265: N_t,Rd = f_t,0,d · η_w · A (A in mm²), Bruttoquerschnitt
export function timberTension({ material, shape = 'rect', b, h, d, Nd, etaW = 1 }) {
  const section = timberSection(shape, b, h, d);
  const ft0d = material.ft0d * etaW;
  const nRd = (ft0d * section.A) / 1000;
  return { material, section, ft0d, nRd, aErf: (Nd * 1000) / ft0d, Nd, eta: Nd / nRd, ok: Nd <= nRd + 1e-9 };
}

export function timberColumn({ material, shape = 'rect', b, h, d, LkY, LkZ, Nd, etaW = 1, table = false }) {
  const section = timberSection(shape, b, h, d);
  const y = timberAxis(material, section, LkY, 'y', etaW, table);
  const z = timberAxis(material, section, LkZ, 'z', etaW, table);
  const governing = z.nRd < y.nRd ? z : y;
  return { material, section, b, h, d, y, z, governing, nRd: governing.nRd, Nd, eta: Nd / governing.nRd, ok: Nd <= governing.nRd + 1e-9 };
}

// ---------- Träger ----------

// Biegelinie eines geraden Trägers aus der Momentenlinie: EI·w'' = −M (w nach unten positiv).
// forces: Ergebnis von internalForces, supportsX: x der beiden Lager (m), EI in kNm².
// Liefert die grösste Durchbiegung (m, nach unten positiv) und ihre Stelle.
export function deflection(forces, supportsX, EI) {
  if (!forces || !forces.ok || !(EI > 0) || supportsX.length < 2) return null;
  const xmin = forces.segments[0].a;
  const xmax = forces.segments[forces.segments.length - 1].b;
  const span = xmax - xmin;
  if (!(span > 0)) return null;
  const n = 2000;
  const h = span / n;
  const xs = [];
  const kappa = [];
  for (let k = 0; k <= n; k++) {
    const x = xmin + k * h;
    xs.push(x);
    kappa.push(-forces.valueAt(x).m / EI);
  }
  // zweimal integrieren (Trapezregel), Startwerte 0
  const slope = [0];
  const w = [0];
  for (let k = 1; k <= n; k++) {
    slope.push(slope[k - 1] + ((kappa[k - 1] + kappa[k]) / 2) * h);
    w.push(w[k - 1] + ((slope[k - 1] + slope[k]) / 2) * h);
  }
  const at = (x) => {
    const t = Math.min(n, Math.max(0, (x - xmin) / h));
    const k = Math.min(n - 1, Math.floor(t));
    return w[k] + (w[k + 1] - w[k]) * (t - k);
  };
  // Starrkörperanteil a + b·x so wählen, dass w an beiden Lagern null ist
  const [xa, xb] = supportsX;
  if (Math.abs(xb - xa) < 1e-9) return null;
  const wa = at(xa);
  const wb = at(xb);
  const slopeFix = (wb - wa) / (xb - xa);
  const left = Math.min(xa, xb);
  const right = Math.max(xa, xb);
  // Feld: nur zwischen den Lagern suchen, nach unten (best) und nach oben (bestUp); Kragarme unten getrennt
  let best = { w: 0, x: left };
  let bestUp = { w: 0, x: left };
  for (let k = 0; k <= n; k++) {
    if (xs[k] < left - 1e-9 || xs[k] > right + 1e-9) continue;
    const value = w[k] - wa - slopeFix * (xs[k] - xa);
    if (value > best.w) best = { w: value, x: xs[k] };
    if (value < bestUp.w) bestUp = { w: value, x: xs[k] };
  }
  // Kragarme: Ende des Kragarms getrennt ausweisen
  const cantilevers = [];
  if (left - xmin > 1e-6) cantilevers.push({ side: 'links', length: left - xmin, w: w[0] - wa - slopeFix * (xmin - xa), x: xmin });
  if (xmax - right > 1e-6) cantilevers.push({ side: 'rechts', length: xmax - right, w: w[n] - wa - slopeFix * (xmax - xa), x: xmax });
  // Biegelinie für die Grafik: rund 200 Punkte [x, w] (w in m, nach unten positiv)
  const points = [];
  for (let k = 0; k <= n; k += 10) points.push([xs[k], w[k] - wa - slopeFix * (xs[k] - xa)]);
  return { max: best, maxUp: bestUp, span: right - left, cantilevers, points };
}

// Stahlträger: Biegewiderstand mit W_pl (plastisch) oder W_el (elastisch), Querkraft über den Steg.
export function steelShearArea(profile) {
  if (profile.Avz) return profile.Avz; // cm², aus der Profiltabelle
  if (profile.f === 'RRW' || profile.f === 'RRK') return (profile.A * profile.h) / (profile.h + profile.b);
  if (profile.tw) return ((profile.h - 2 * (profile.tf || 0)) * profile.tw) / 100;
  return null;
}

export function steelBeam({ profile, grade, Md, Vd, plastic = true }) {
  const fy = STEEL_GRADES[grade];
  const W = plastic ? profile.Wply : profile.Wy; // cm³
  const mRd = (W * fy) / GAMMA_M1 / 1000; // kNm
  const av = steelShearArea(profile); // cm²
  const vRd = av ? (av * 100 * fy) / Math.sqrt(3) / GAMMA_M1 / 1000 : null; // kN
  const wErf = (Math.abs(Md) * GAMMA_M1 * 1000) / fy; // cm³
  return {
    profile, grade, fy, plastic, W, wErf, mRd, Md, etaM: Math.abs(Md) / mRd,
    av, vRd, Vd, etaV: vRd ? Math.abs(Vd) / vRd : null,
    ok: Math.abs(Md) <= mRd + 1e-9 && (!vRd || Math.abs(Vd) <= vRd + 1e-9),
  };
}

export function findSteelBeam(profiles, options, extraCheck) {
  for (const profile of familyProfiles(profiles, options.family)) {
    const result = steelBeam({ ...options, profile });
    if (result.ok && (!extraCheck || extraCheck(result))) return result;
  }
  return null;
}

// Holzträger b × h (mm): W = b·h²/6, tau = 1.5·V/(b·h)
export function timberBeam({ material, b, h, Md, Vd, etaW = 1 }) {
  const fmd = material.fmd * etaW;
  const fvd = material.fvd * etaW;
  const W = (b * h * h) / 6; // mm³
  const sigma = (Math.abs(Md) * 1e6) / W;
  const tau = (1.5 * Math.abs(Vd) * 1000) / (b * h);
  const wErf = (Math.abs(Md) * 1e6) / fmd; // mm³
  const hErf = Math.sqrt((6 * wErf) / b);
  return {
    material, b, h, fmd, fvd, W, wErf, hErf, sigma, tau, Md, Vd,
    mRd: (W * fmd) / 1e6, vRd: (fvd * b * h) / 1.5 / 1000,
    etaM: sigma / fmd, etaV: tau / fvd,
    ok: sigma <= fmd + 1e-9 && tau <= fvd + 1e-9,
  };
}

// Querdruck am Auflager: sigma_c,90,d = R_d / (b · l_A) ≤ f_c,90,d · eta_w (R in kN, b und l_A in mm)
export function timberBearing({ material, R, b, lA, etaW = 1 }) {
  const fc90d = material.fc90d * etaW;
  const sigma = (Math.abs(R) * 1000) / (b * lA);
  return { R, b, lA, fc90d, sigma, lAerf: (Math.abs(R) * 1000) / (b * fc90d), eta: sigma / fc90d, ok: sigma <= fc90d + 1e-9 };
}

// Grösste Spannweite eines Einfeldträgers mit Gleichlast q_d (kN/m): aus Schub und aus Biegung
export function maxSpan(mRd, vRd, qd) {
  const lV = vRd ? (2 * vRd) / qd : Infinity;
  const lM = Math.sqrt((8 * mRd) / qd);
  return { lV, lM, l: Math.min(lV, lM), governs: lV < lM ? 'V' : 'M' };
}
