// Bemessungskarte: Träger (Biegung, Querkraft, Durchbiegung) und Stütze (Knicken), in Stahl und Holz.
// Die Profiltabellen werden erst beim ersten Gebrauch nachgeladen (data/profiles.js, data/c4.js).
import {
  STEEL_GRADES, STEEL_FAMILIES, EULER_CASES, CURVE_ALPHA, GAMMA_M1, E_STEEL, TIMBER, TIMBER_EXPOSURE,
  steelColumn, familyProfiles, curveReason, timberColumn, steelBeam, timberBeam, deflection,
  timberBearing, maxSpan,
} from './bemessung.js';
import { tex, step as baseStep, why } from './solution.js';
import { renderDeflection } from './diagrams.js';
import { steelSectionSvg, timberSectionSvg } from './section-svg.js';
import { termsBox } from './design-terms.js';
import { fixed, escapeHtml, parseNumber, plain } from './format.js';

const $ = (id) => document.getElementById(id);

let data = null; // { profiles, c4 }
let loading = null;
let ctx = null; // { getDesign, getLast, getDecimals, getExplain, onChange }
let columnSignature = ''; // welche Lager im System Stützen sind (Formular passt sich an)
let explainOn = false; // Erklärmodus des Lösungswegs: „Warum?“-Boxen auch in der Bemessung
let beamLine = null; // Biegelinie des gewählten Trägers für die Grafik unter der M-Fläche

function ensureData() {
  if (data) return true;
  if (!loading) {
    loading = Promise.all([import('../data/profiles.js'), import('../data/c4.js')])
      .then(([profiles, c4]) => {
        data = { profiles: profiles.PROFILES, c4: { GRIDS: c4.GRIDS, TABLE: c4.TABLE } };
        renderDesignForm();
        updateDesign();
      })
      .catch(() => {
        loading = null;
        setResult('<div class="sol-error">Die Profiltabellen konnten nicht geladen werden.</div>');
      });
  }
  return false;
}

// ---------- Zustand ----------

export function defaultDesign() {
  return {
    tab: 'beam',
    beam: {
      material: 'steel', source: 'system', M: null, V: null, gamma: 1,
      family: 'IPE', grade: 'S235', plastic: true, profile: '',
      timber: 'GL24h', exposure: 'dry', b: 160, h: null, step: 'auto', lA: null,
      limit: 400, sls: false, qSpan: null,
    },
    column: {
      material: 'steel', source: 'system', support: 'auto', N: null, gamma: 1, gk: null, qk: null, area: null,
      L: 3, euler: 2, beta: null, zOwn: false, Lz: null, eulerZ: 2, betaZ: null,
      family: 'HEB', grade: 'S235', profile: '',
      timber: 'GL24h', exposure: 'dry', shape: 'rect', b: null, h: null, d: null, step: 'auto', kcTable: true,
    },
  };
}

const num = (value, min, max, fallback) => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback);
const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
const text = (value, max = 40) => (typeof value === 'string' ? value.slice(0, max) : '');

export function sanitizeDesign(raw) {
  const d = defaultDesign();
  if (!raw || typeof raw !== 'object') return d;
  const grades = Object.keys(STEEL_GRADES);
  const families = STEEL_FAMILIES.map((f) => f.id);
  const timbers = Object.keys(TIMBER);
  const exposures = TIMBER_EXPOSURE.map((e) => e.id);
  const eulers = EULER_CASES.map((e) => e.id);
  const steps = ['auto', 10, 20, 40];
  d.tab = pick(raw.tab, ['beam', 'column'], 'beam');
  const b = raw.beam && typeof raw.beam === 'object' ? raw.beam : {};
  Object.assign(d.beam, {
    material: pick(b.material, ['steel', 'timber'], 'steel'),
    source: pick(b.source, ['system', 'manual'], 'system'),
    M: num(b.M, -1e6, 1e6, null),
    V: num(b.V, -1e6, 1e6, null),
    gamma: num(b.gamma, 0.1, 10, 1),
    family: pick(b.family, families, 'IPE'),
    grade: pick(b.grade, grades, 'S235'),
    plastic: b.plastic !== false,
    profile: text(b.profile),
    timber: pick(b.timber, timbers, 'GL24h'),
    exposure: pick(b.exposure, exposures, 'dry'),
    b: num(b.b, 20, 2000, 160),
    h: num(b.h, 20, 4000, null),
    step: pick(b.step, steps, 'auto'),
    // früherer Standard 120 mm: jetzt wird die nötige Auflagerlänge gerechnet
    lA: b.lA === 120 ? null : num(b.lA, 10, 2000, null),
    limit: pick(b.limit, [0, 200, 250, 300, 400, 500], 400),
    sls: b.sls === true,
    qSpan: num(b.qSpan, 0.001, 1e5, null),
  });
  const c = raw.column && typeof raw.column === 'object' ? raw.column : {};
  Object.assign(d.column, {
    material: pick(c.material, ['steel', 'timber'], 'steel'),
    // „N von Hand“ ohne eingetragenes N (früherer Standard) wird zu „aus dem System“
    source: c.source === 'direct' && typeof c.N !== 'number' ? 'system' : pick(c.source, ['system', 'direct', 'area'], 'system'),
    support: pick(c.support, ['auto', 'A', 'B'], 'auto'),
    N: num(c.N, 0, 1e6, null),
    gamma: num(c.gamma, 0.1, 10, 1),
    gk: num(c.gk, 0, 1e4, null),
    qk: num(c.qk, 0, 1e4, null),
    area: num(c.area, 0, 1e6, null),
    L: num(c.L, 0.01, 200, 3),
    euler: pick(c.euler, eulers, 2),
    beta: num(c.beta, 0.1, 10, null),
    zOwn: c.zOwn === true,
    Lz: num(c.Lz, 0.01, 200, null),
    eulerZ: pick(c.eulerZ, eulers, 2),
    betaZ: num(c.betaZ, 0.1, 10, null),
    family: pick(c.family, families, 'HEB'),
    grade: pick(c.grade, grades, 'S235'),
    profile: text(c.profile),
    timber: pick(c.timber, timbers, 'GL24h'),
    exposure: pick(c.exposure, exposures, 'dry'),
    shape: pick(c.shape, ['rect', 'round'], 'rect'),
    b: num(c.b, 20, 2000, null),
    h: num(c.h, 20, 4000, null),
    d: num(c.d, 20, 2000, null),
    step: pick(c.step, steps, 'auto'),
    kcTable: c.kcTable !== false,
  });
  return d;
}

// ---------- Zahlen ----------

const f = (value, digits) => fixed(value, digits);
const kn = (value) => f(value, Math.abs(value) >= 100 ? 1 : 2);
// Einheit in TeX; Hochzahlen ausserhalb von \text (cm^3 → \text{cm}^{3})
const unit = (u) => `\\,\\text{${u.replace(/\^(\d)/g, '}^{$1}\\text{')}}`;
const ok = (good) => (good ? '\\ {\\color{#15803d}\\checkmark}' : '\\ {\\color{#b91c1c}\\times}');

function bar(eta) {
  if (!Number.isFinite(eta)) return '<span class="d-bar bad"><span style="width:100%"></span></span><strong class="d-eta bad">– %</strong>';
  const pct = Math.max(0, eta * 100);
  const cls = eta > 1 + 1e-9 ? 'bad' : eta > 0.9 ? 'tight' : 'good';
  return `<span class="d-bar ${cls}" title="Ausnutzung ${f(pct, 0)} %"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span></span><strong class="d-eta ${cls}">${f(pct, 0)} %</strong>`;
}

// ---------- Formular ----------

function inputField(path, labelText, value, opts = {}) {
  return `<label class="d-field${opts.wide ? ' wide' : ''}"><span>${labelText}</span><span class="d-in"><input type="text" inputmode="decimal" autocomplete="off" data-d="${path}" value="${escapeHtml(plain(value))}"${opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : ''}>${opts.unit ? `<em>${opts.unit}</em>` : ''}</span></label>`;
}

function selectField(path, labelText, options, value) {
  const list = options.map(([v, t]) => `<option value="${escapeHtml(String(v))}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  return `<label class="d-field"><span>${labelText}</span><select data-d="${path}">${list}</select></label>`;
}

function checkField(path, labelText, checked, title = '') {
  return `<label class="d-check"${title ? ` title="${escapeHtml(title)}"` : ''}><input type="checkbox" data-d="${path}"${checked ? ' checked' : ''}><span>${labelText}</span></label>`;
}

function segmented(path, options, value) {
  return `<div class="d-seg" role="radiogroup">${options.map(([v, t]) => `<button type="button" role="radio" aria-checked="${v === value}" data-set="${path}" data-value="${v}" class="${v === value ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}

const gradeOptions = () => Object.keys(STEEL_GRADES).map((g) => [g, `${g} (f_y = ${STEEL_GRADES[g]} N/mm²)`]);
const timberOptions = () => Object.entries(TIMBER).map(([id, t]) => [id, t.text]);
const exposureOptions = () => TIMBER_EXPOSURE.map((e) => [e.id, e.text]);

function profileOptions(family) {
  const list = data ? familyProfiles(data.profiles, family) : [];
  return [['', 'automatisch: leichtestes, das reicht'], ...list.map((p) => [p.n, `${p.n} (${f(p.g, 1)} kg/m)`])];
}

// Eulerfälle als kleine Bilder: Lagerung, Knickfigur (gestrichelt), beta
function eulerIcon(id) {
  const x = 26;
  const top = 16;
  const bottom = 74;
  const shapes = {
    1: `M${x},${bottom} C${x},${bottom - 30} ${x + 6},${top + 14} ${x + 16},${top}`,
    2: `M${x},${bottom} Q${x + 22},${(top + bottom) / 2} ${x},${top}`,
    3: `M${x},${bottom} C${x},${bottom - 26} ${x + 20},${top + 22} ${x},${top}`,
    4: `M${x},${bottom} C${x},${bottom - 18} ${x + 13},${bottom - 18} ${x + 13},${(top + bottom) / 2} C${x + 13},${top + 18} ${x},${top + 18} ${x},${top}`,
  };
  const fixedFoot = (y, up) => {
    const sign = up ? -1 : 1;
    let s = `<line x1="${x - 11}" y1="${y}" x2="${x + 11}" y2="${y}" stroke-width="2"/>`;
    for (let k = -10; k <= 8; k += 4.5) s += `<line x1="${x + k}" y1="${y}" x2="${x + k + 4}" y2="${y + 5 * sign}" stroke-width="1"/>`;
    return s;
  };
  const pinFoot = (y) => `<path d="M${x},${y} L${x - 6},${y + 8} L${x + 6},${y + 8} Z" fill="none" stroke-width="1.4"/><line x1="${x - 9}" y1="${y + 8}" x2="${x + 9}" y2="${y + 8}" stroke-width="1.4"/>`;
  const pinHead = (y) => `<path d="M${x},${y} L${x - 6},${y - 8} L${x + 6},${y - 8} Z" fill="none" stroke-width="1.4"/><line x1="${x - 9}" y1="${y - 8}" x2="${x + 9}" y2="${y - 8}" stroke-width="1.4"/><line x1="${x - 9}" y1="${y - 11}" x2="${x + 9}" y2="${y - 11}" stroke-width="1" stroke-dasharray="2 2"/>`;
  const load = (y, dx = 0) => `<line x1="${x + dx}" y1="${y - 13}" x2="${x + dx}" y2="${y - 3}" stroke-width="1.4"/><path d="M${x + dx},${y - 1} L${x + dx - 3},${y - 6} L${x + dx + 3},${y - 6} Z" stroke="none" class="fill"/>`;
  let supports = '';
  if (id === 1) supports = fixedFoot(bottom) + load(top, 16);
  if (id === 2) supports = pinFoot(bottom) + pinHead(top);
  if (id === 3) supports = fixedFoot(bottom) + pinHead(top);
  if (id === 4) supports = fixedFoot(bottom) + fixedFoot(top, true);
  const topLoad = id === 1 ? '' : '';
  return `<svg viewBox="0 0 60 88" width="54" height="80" aria-hidden="true"><line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke-width="2.4" class="col"/>`
    + `<path d="${shapes[id]}" fill="none" stroke-width="1.6" stroke-dasharray="4 3" class="buckle"/>${supports}${topLoad}</svg>`;
}

function eulerPicker(path, value) {
  return `<div class="d-euler" role="radiogroup" aria-label="Eulerfall">${EULER_CASES.map((c) => `<button type="button" role="radio" aria-checked="${c.id === value}" class="${c.id === value ? 'on' : ''}" data-set="${path}" data-value="${c.id}" title="${escapeHtml(c.text)}">${eulerIcon(c.id)}<span>Fall ${c.id}<br><b>β = ${c.beta}</b></span></button>`).join('')}</div>`;
}

const stepOptions = [['auto', 'automatisch (Träger aus BSH 40 mm, sonst 20 mm)'], [10, '10 mm'], [20, '20 mm'], [40, '40 mm']];

// Rundungsschritt: Trägerhöhe aus Brettschichtholz in Lamellen zu 40 mm, sonst 20 mm
function timberStep(choice, material, beam = true) {
  if (choice !== 'auto') return choice;
  return beam && material.glulam ? 40 : 20;
}

function beamForm(d) {
  const b = d.beam;
  const rows = [];
  rows.push(`<div class="d-row"><span class="d-label">Werkstoff</span>${segmented('beam.material', [['steel', 'Stahl'], ['timber', 'Holz']], b.material)}</div>`);
  rows.push(`<div class="d-row">${selectField('beam.source', 'Schnittgrössen', [['system', 'aus dem System oben (M_max, V_max)'], ['manual', 'von Hand eingeben']], b.source)}`
    + (b.source === 'manual'
      ? inputField('beam.M', 'M<sub>d</sub>', b.M, { unit: 'kNm' }) + inputField('beam.V', 'V<sub>d</sub>', b.V, { unit: 'kN' })
      : `${inputField('beam.gamma', 'Lastbeiwert γ<sub>F</sub>', b.gamma, { placeholder: '1.0' })}<span class="d-hint">1.0 = Lasten oben sind Bemessungswerte (q<sub>d</sub>, F<sub>d</sub>)</span>`)
    + '</div>');
  if (b.material === 'steel') {
    rows.push(`<div class="d-row">${selectField('beam.family', 'Profilreihe', STEEL_FAMILIES.map((x) => [x.id, x.text]), b.family)}${selectField('beam.grade', 'Stahlsorte', gradeOptions(), b.grade)}${selectField('beam.plastic', 'Widerstand', [['true', 'plastisch (W_pl)'], ['false', 'elastisch (W_el)']], String(b.plastic))}</div>`);
    rows.push(`<div class="d-row">${selectField('beam.profile', 'Profil', profileOptions(b.family), b.profile)}${limitSelect(b)}${checkField('beam.sls', 'Profil auch nach Durchbiegung wählen', b.sls)}</div>`);
  } else {
    rows.push(`<div class="d-row">${selectField('beam.timber', 'Holzklasse', timberOptions(), b.timber)}${selectField('beam.exposure', 'Feuchte', exposureOptions(), b.exposure)}</div>`);
    rows.push(`<div class="d-row">${inputField('beam.b', 'Breite b', b.b, { unit: 'mm' })}${inputField('beam.h', 'Höhe h', b.h, { unit: 'mm', placeholder: 'automatisch' })}${selectField('beam.step', 'Höhe aufrunden', stepOptions, b.step)}${inputField('beam.lA', 'Auflagerlänge l<sub>A</sub>', b.lA, { unit: 'mm', placeholder: 'berechnen' })}</div>`);
    rows.push(`<div class="d-row">${limitSelect(b)}${checkField('beam.sls', 'Höhe auch nach Durchbiegung wählen', b.sls)}</div>`);
  }
  rows.push(`<div class="d-row">${inputField('beam.qSpan', 'Grösste Spannweite für q<sub>d</sub> =', b.qSpan, { unit: 'kN/m', placeholder: 'optional' })}<span class="d-hint">Einfeldträger mit Gleichlast: l aus V<sub>Rd</sub> und M<sub>Rd</sub> des gewählten Querschnitts</span></div>`);
  return rows.join('');
}

function limitSelect(b) {
  return selectField('beam.limit', 'Durchbiegung', [
    [400, 'w ≤ l/400 (Haupttragelemente)'], [300, 'w ≤ l/300 (Sekundärträger, Sparren)'], [500, 'w ≤ l/500 (rissgefährdete Bauteile)'],
    [250, 'w ≤ l/250'], [200, 'w ≤ l/200'], [0, 'nicht prüfen'],
  ], b.limit);
}

function columnForm(d) {
  const c = d.column;
  const rows = [];
  rows.push(`<div class="d-row"><span class="d-label">Werkstoff</span>${segmented('column.material', [['steel', 'Stahl'], ['timber', 'Holz']], c.material)}</div>`);
  const columns = systemColumns(ctx.getLast());
  const fromSystem = c.source === 'system';
  const systemL = fromSystem && columns.length ? pickColumn(c, columns).L : c.L;
  const sources = [['system', 'aus der Skizze (Lager unter der Achse)'], ['direct', 'N und L von Hand'], ['area', 'N aus Flächenlasten, L von Hand']];
  let sourceFields = '';
  if (fromSystem) {
    sourceFields = (columns.length > 1 ? selectField('column.support', 'Stütze', [['auto', 'die stärker gedrückte'], ['A', 'unter Lager A'], ['B', 'unter Lager B']], c.support) : '')
      + inputField('column.gamma', 'Lastbeiwert γ<sub>F</sub>', c.gamma, { placeholder: '1.0' })
      + '<span id="designColumnInfo" class="d-take"></span>';
  } else if (c.source === 'area') {
    sourceFields = inputField('column.gk', 'g<sub>k</sub>', c.gk, { unit: 'kN/m²' }) + inputField('column.qk', 'q<sub>k</sub>', c.qk, { unit: 'kN/m²' }) + inputField('column.area', 'Einzugsfläche', c.area, { unit: 'm²' });
  } else {
    sourceFields = `${inputField('column.N', 'N', c.N, { unit: 'kN', placeholder: 'Druck' })}${inputField('column.gamma', 'Lastbeiwert γ<sub>F</sub>', c.gamma, { placeholder: '1.0' })}<span id="designReactions" class="d-take"></span>`;
  }
  rows.push(`<div class="d-row">${selectField('column.source', 'Stütze', sources, c.source)}${sourceFields}</div>`);
  rows.push(`<div class="d-row">${fromSystem ? '' : inputField('column.L', 'Stützenlänge L', c.L, { unit: 'm' })}${eulerPicker('column.euler', c.euler)}${inputField('column.beta', 'eigenes β', c.beta, { placeholder: 'optional' })}</div>`);
  rows.push(`<div class="d-row">${checkField('column.zOwn', 'um die schwache Achse z anders gehalten', c.zOwn, 'z. B. Riegel oder Wand in halber Höhe: eigene Länge und Lagerung für das Knicken um z')}`
    + (c.zOwn
      ? inputField('column.Lz', 'Länge L<sub>z</sub>', c.Lz, { unit: 'm', placeholder: plain(systemL) })
        + selectField('column.eulerZ', 'Fall z', EULER_CASES.map((e) => [e.id, `Fall ${e.id} (β = ${e.beta})`]), c.eulerZ)
        + inputField('column.betaZ', 'eigenes β<sub>z</sub>', c.betaZ, { placeholder: 'optional' })
      : '')
    + '</div>');
  if (c.material === 'steel') {
    rows.push(`<div class="d-row">${selectField('column.family', 'Profilreihe', STEEL_FAMILIES.map((x) => [x.id, x.text]), c.family)}${selectField('column.grade', 'Stahlsorte', gradeOptions(), c.grade)}${selectField('column.profile', 'Profil', profileOptions(c.family), c.profile)}</div>`);
  } else {
    rows.push(`<div class="d-row">${selectField('column.timber', 'Holzklasse', timberOptions(), c.timber)}${selectField('column.exposure', 'Feuchte', exposureOptions(), c.exposure)}${checkField('column.kcTable', 'k<sub>c</sub> wie aus der HBT-Tabelle', c.kcTable, 'Wie im Unterricht: λ_rel auf die nächsthöhere Tabellenzeile (Schritt 0.02) aufrunden, dann k_c ablesen')}</div>`);
    const dims = c.shape === 'round'
      ? inputField('column.d', 'Durchmesser d', c.d, { unit: 'mm', placeholder: 'automatisch' })
      : inputField('column.b', 'Breite b', c.b, { unit: 'mm', placeholder: 'automatisch' }) + inputField('column.h', 'Höhe h', c.h, { unit: 'mm', placeholder: 'automatisch' });
    rows.push(`<div class="d-row"><span class="d-label">Querschnitt</span>${segmented('column.shape', [['rect', 'Rechteck'], ['round', 'Rundholz']], c.shape)}${dims}${selectField('column.step', 'aufrunden', stepOptions, c.step)}<span class="d-hint">leer = kleinster passender Querschnitt${c.shape === 'round' ? '' : ' (beide leer: quadratisch)'}</span></div>`);
  }
  return rows.join('');
}

export function renderDesignForm() {
  if (!ctx) return;
  const d = ctx.getDesign();
  document.querySelectorAll('#designTabs [data-tab]').forEach((button) => {
    const on = button.dataset.tab === d.tab;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', String(on));
  });
  const form = $('designForm');
  columnSignature = systemColumns(ctx.getLast()).map((x) => `${x.name}${x.below ? 'u' : 'o'}`).join(',');
  const focused = document.activeElement && form.contains(document.activeElement) ? document.activeElement.getAttribute('data-d') || document.activeElement.getAttribute('data-set') : null;
  form.innerHTML = d.tab === 'beam' ? beamForm(d) : columnForm(d);
  if (focused) {
    const again = form.querySelector(`[data-d="${focused}"], [data-set="${focused}"].on`);
    if (again) again.focus();
  }
}

// ---------- Erklärmodus: „Warum?“-Boxen im Lösungsweg der Bemessung ----------
// Nach dem Unterricht (Baustatik, SIA 263/265, SZS C4/C5, HBT 2021) und BeamSmith. Der Schritt-Titel wählt
// die Erklärung; exp enthält die Werte der aktuellen Aufgabe.

let exp = null;
let termsSeen = new Set(); // im Erklärmodus schon erklärte Formelzeichen (pro Lösungsweg)

function step(number, title, hint, body) {
  return baseStep(number, title, hint, body + (explainOn ? termsBox(body, termsSeen) : '') + explanation(title));
}

function explanation(title) {
  if (!explainOn || !exp) return '';
  const t = String(title).replace(/<[^>]+>/g, '');
  const x = exp;
  const pct = (eta) => `${f(eta * 100, 0)} %`;
  if (t.startsWith('Stütze unter Lager') && x.input && x.input.column) {
    const col = x.input.column;
    return why('Warum ist die Auflagerkraft die Normalkraft?', [
      `Die Stütze steht unter Lager ${escapeHtml(col.name)}. Was der Träger dort abgibt (${col.name}<sub>z</sub> = ${kn(col.Rz)} kN), läuft durch die Stütze in den Boden. Ohne Last entlang der Stütze ist die Normalkraft über die ganze Höhe gleich.`,
      `Die Länge ist der Höhenunterschied zwischen Trägerachse und Stützenfuss: ${f(col.L, 2)} m. Zieht man das Lager in der Skizze tiefer, wird die Stütze länger und knickt leichter.`,
      'Das Eigengewicht der Stütze ist wie im Unterricht nicht eingerechnet.',
    ]);
  }
  if (t === 'Bemessungslast' && x.c && x.c.source === 'area') {
    return why('Woher kommt N<sub>d</sub>?', [
      'Jede Stütze trägt die Lasten ihrer Einzugsfläche: in jeder Richtung bis zur halben Distanz zur nächsten Stütze oder Wand.',
      'Ständige Lasten mit γ<sub>G</sub> = 1.35, Nutzlasten mit γ<sub>Q</sub> = 1.5 (SIA 260).',
    ]);
  }
  if (t === 'Knicklänge' && x.k) {
    return why('Was ist die Knicklänge?', [
      'L<sub>K</sub> ist die Länge, auf der die Stütze wie ein beidseitig gelenkiger Stab ausknickt (eine halbe Sinuswelle). Je fester die Enden gehalten sind, desto kürzer: Fahnenstange (eingespannt – frei) 2·L, gelenkig – gelenkig 1·L, eingespannt – gelenkig 0.7·L, beidseitig eingespannt 0.5·L.',
      `Hier Fall ${x.c.euler}: L<sub>K</sub> = ${f(x.k.LkY, 2)} m. Im Zweifel nimmt man Fall 2 (β = 1).`,
      '<i>Typische Fehler:</i> L statt L<sub>K</sub> einsetzen; übersehen, dass die Stütze um y und z verschieden gehalten sein kann (z. B. ein Riegel in halber Höhe nur in einer Richtung).',
    ]);
  }
  if (x.kind === 'steelColumn' && x.chosen) {
    const r = x.chosen;
    const p = r.profile;
    if (t.startsWith('Querschnittswerte')) {
      return why('Warum der Trägheitsradius i?', [
        'Ob ein Stab knickt, hängt davon ab, wie weit sein Material von der Achse entfernt liegt: i = √(I/A). Ein H-Profil hat um die starke Achse y ein grosses i, um die schwache Achse z ein kleines – um z knickt es zuerst.',
        `${escapeHtml(p.n)}: i<sub>y</sub> = ${f(p.iy, 2)} cm, i<sub>z</sub> = ${f(p.iz, 2)} cm. A, I und i stehen in den Profiltabellen (SZS C5).`,
      ]);
    }
    if (t === 'Schlankheit') {
      return why('Was sagt die Schlankheit?', [
        `λ<sub>K</sub> = L<sub>K</sub> / i, beide in cm. λ<sub>E</sub> = π·√(E/f<sub>y</sub>) ist die Schlankheit, bei der die Euler-Knickspannung gerade f<sub>y</sub> erreicht: ${f(r.y.lambdaE, 1)} für ${x.grade}.`,
        `λ̄<sub>K</sub> = λ<sub>K</sub>/λ<sub>E</sub>: unter 0.2 knickt nichts (χ = 1), um 1 sind Knicken und Fliessen gleich wichtig, darüber dominiert das Knicken. Hier λ̄<sub>K,z</sub> = ${f(r.z.lambdaBar, 2)}.`,
        '<i>Typischer Fehler:</i> L<sub>K</sub> in m und i in cm gemischt – λ wird 100-mal zu klein. Grenzen: λ<sub>K</sub> ≤ 200 für Haupttragelemente, 250 für Verbände.',
      ]);
    }
    if (t.startsWith('Knickspannungskurve')) {
      return why('Warum diese Knickspannungskurve?', [
        'Echte Stützen sind nie ganz gerade und haben Eigenspannungen aus dem Walzen oder Schweissen. Die Kurven a bis d fassen das zusammen; ein grösseres α<sub>K</sub> bedeutet mehr Abminderung.',
        'Zuordnung nach SIA 263: hohe Walzprofile (h/b &gt; 1.2, z. B. IPE, HEA/HEB ab 400) um y → a, um z → b. Gedrungene H-Profile (HEA/HEB/HEM 100–360) um y → b, um z → c. Warmgefertigte Hohlprofile (RRW, ROR) → a. Kaltgefertigte Hohlprofile (RRK), U-, L- und T-Profile, Vollquerschnitte → c.',
        'χ<sub>K</sub> ist der Anteil der plastischen Normalkraft, der wegen des Knickens noch übrig bleibt. Man kann ihn auch aus den Tabellen C4/06 über λ̄<sub>K</sub> ablesen.',
      ]);
    }
    if (t.startsWith('Knickwiderstand')) {
      return why('Wie liest man das Ergebnis?', [
        `Massgebend ist die Achse mit dem kleineren N<sub>K,Rd</sub>, hier ${r.governing.axis}. ${escapeHtml(p.n)} ist zu ${pct(r.eta)} ausgenutzt.`,
        'Für die Vorbemessung liest man N<sub>K,Rd</sub> direkt aus den Bemessungstafeln SZS C4 ab (über L<sub>K</sub>, γ<sub>M1</sub> = 1.05 ist schon drin). Die Formel ist der Nachweis dazu; die Werte stimmen bis auf Rundung überein.',
        'Reicht es nicht: grösseres Profil, oder die Stütze um z zusätzlich halten (kürzere L<sub>K,z</sub>). Eine höhere Stahlsorte bringt bei schlanken Stützen wenig, weil E gleich bleibt.',
      ]);
    }
  }
  if (x.kind === 'timberColumn' && x.r) {
    const r = x.r;
    if (t.startsWith('Querschnittswerte')) {
      return why('Warum i = 0.289 · b?', [
        'Für ein Rechteck ist i = √(I/A) = h/√12 = 0.289·h um y und 0.289·b um z. Massgebend ist meist die kleinere Seite b.',
        'Rundholz: i = d/4, in allen Richtungen gleich.',
      ]);
    }
    if (t === 'Schlankheit') {
      return why('Was ist λ<sub>rel</sub>?', [
        `λ = L<sub>K</sub> / i, beide in mm. Grenze λ ≤ 150 (Windverbände 200), daraus b<sub>min</sub> = L<sub>K</sub> / (0.289 · 150) = ${f((x.k.LkZ * 1000) / (0.289 * 150), 0)} mm.`,
        'λ<sub>rel</sub> = λ/π · √(f<sub>c,0,k</sub>/E<sub>0,05</sub>) vergleicht mit der Euler-Knickspannung. Im Unterricht vereinfacht: λ/57 für Vollholz, λ/60 für Brettschichtholz.',
      ]);
    }
    if (t.startsWith('Knickbeiwert')) {
      return why('Wie liest man k<sub>c</sub> ab?', [
        'Tabelle HBT S. 52: Zeilen λ<sub>rel</sub> in Schritten von 0.02, Spalten Vollholz und Brettschichtholz. λ<sub>rel</sub> auf zwei Stellen runden; liegt der Wert dann zwischen zwei Zeilen (ungerade Hundertstel), nimmt man die nächsthöhere.',
        'Brettschichtholz ist gerader und gleichmässiger als Vollholz: β<sub>c</sub> = 0.1 statt 0.2, darum ein etwas höheres k<sub>c</sub>.',
      ]);
    }
    if (t.startsWith('Knickwiderstand')) {
      return why('Was steckt im Nachweis?', [
        `σ<sub>c,0,d</sub> = N<sub>d</sub>/A ≤ k<sub>c</sub>·f<sub>c,0,d</sub>·η<sub>w</sub>, umgestellt N<sub>K,Rd</sub> = k<sub>c</sub>·f<sub>c,0,d</sub>·η<sub>w</sub>·A. Ausnutzung hier ${pct(r.eta)}.`,
        'η<sub>w</sub>: Feuchteklasse 1 (vor Witterung geschützt) 1.0, Feuchteklasse 2 (teilweise geschützt oder bewittert) 0.8, Feuchteklasse 3 (feucht, unter Wasser) 0.6.',
        'Gesuchte Höhe bei gegebener Breite: h<sub>erf</sub> = N<sub>d</sub> / (k<sub>c</sub>·f<sub>c,0,d</sub>·η<sub>w</sub>·b). k<sub>c</sub> hängt nur von b ab, solange um z geknickt wird.',
        '<i>Typische Fehler:</i> i um die falsche Achse (h statt b), η<sub>w</sub> vergessen, k<sub>c</sub> nicht auf die nächste Zeile aufgerundet.',
      ]);
    }
  }
  if (x.kind === 'steelBeam' || x.kind === 'timberBeam') {
    if (t === 'Bemessungsschnittgrössen') {
      return why('Welche Schnittgrössen sind massgebend?', [
        'Für die Biegung zählt der grösste Betrag von M – das Feldmoment oder bei Kragarmen das Stützmoment über dem Lager. Für den Schub der grösste Betrag von V, meist direkt am Auflager.',
        'Lasten für die Tragsicherheit: q<sub>d</sub> = 1.35·g<sub>k</sub> + 1.5·q<sub>k</sub>. Sind im System schon Bemessungswerte eingegeben, bleibt γ<sub>F</sub> = 1.',
      ]);
    }
    if (t === 'Durchbiegung') {
      return why('Warum mit Gebrauchslasten?', [
        'Die Durchbiegung ist ein Nachweis der Gebrauchstauglichkeit: charakteristische Lasten ohne γ. Grenzwerte: l/400 für Haupttragelemente (Pfetten, Balkendecken), l/300 für Sekundärträger (Sparren), l/500 bei rissgefährdeten Bauteilen, Kragarm 2·c/400.',
        'Einfeldträger mit Gleichlast: w = 5·q·l⁴/(384·E·I), Einzellast in der Mitte: w = F·l³/(48·E·I). Die App rechnet die Biegelinie aus der Momentenlinie, darum auch mit Kragarmen.',
        'Bei langen Trägern ist oft die Durchbiegung massgebend: I<sub>erf</sub> = 5·q·l⁴/(384·E·w<sub>zul</sub>).',
      ]);
    }
    if (t === 'Grösste Spannweite') {
      return why('Wie rechnet man die Spannweite zurück?', [
        'Einfeldträger: V<sub>d</sub> = q<sub>d</sub>·l/2 und M<sub>d</sub> = q<sub>d</sub>·l²/8. Setzt man V<sub>d</sub> = V<sub>Rd</sub> und M<sub>d</sub> = M<sub>Rd</sub> und löst nach l auf, ist der kleinere Wert massgebend.',
      ]);
    }
  }
  if (x.kind === 'steelBeam') {
    if (t === 'Erforderliches Widerstandsmoment' && x.plastic === false) {
      return why('Warum hier W<sub>el</sub>?', [
        'Aus M<sub>d</sub> ≤ M<sub>Rd</sub> = W·f<sub>y</sub>/γ<sub>M1</sub> folgt W<sub>erf</sub> = M<sub>d</sub>·γ<sub>M1</sub>/f<sub>y</sub>. Einheiten: M<sub>d</sub> in kNcm (kNm × 100), f<sub>y</sub> in kN/cm², dann W in cm³.',
        'Elastisch heisst: Nur die äusserste Faser darf die Fliessgrenze erreichen. Das ist vorsichtiger als W<sub>pl</sub> und gilt für Querschnittsklasse 3 oder wenn die Aufgabe elastisch verlangt. Im Unterricht rechnet man gewalzte I- und H-Profile meist plastisch.',
      ]);
    }
    if (t === 'Erforderliches Widerstandsmoment') {
      return why('Warum W<sub>pl</sub>?', [
        'Aus M<sub>d</sub> ≤ M<sub>Rd</sub> = W·f<sub>y</sub>/γ<sub>M1</sub> folgt W<sub>erf</sub> = M<sub>d</sub>·γ<sub>M1</sub>/f<sub>y</sub>. Einheiten: M<sub>d</sub> in kNcm (kNm × 100), f<sub>y</sub> in kN/cm², dann W in cm³.',
        'Gewalzte I- und H-Profile sind meist in Querschnittsklasse 1 oder 2: Der ganze Querschnitt darf fliessen, darum W<sub>pl</sub> (bei I-Profilen rund 14 % mehr als W<sub>el</sub>).',
      ]);
    }
    if (t.startsWith('Gewählt')) {
      return why('Wie wählt man das Profil?', [
        'In der Profiltabelle (SZS C5) das erste Profil der Reihe suchen, dessen W<sub>pl,y</sub> ≥ W<sub>erf</sub> ist – es ist auch das leichteste. C5 gibt M<sub>Rd</sub> und V<sub>Rd</sub> direkt an.',
        'Die Tabelle „Nachbarprofile“ in der Bemessungskarte zeigt die Profile daneben; ein Klick nimmt ein anderes.',
      ]);
    }
    if (t === 'Querkraft') {
      return why('Warum nur die Stegfläche?', [
        'Die Schubspannungen fliessen fast ganz durch den Steg. Bei I- und H-Profilen ist A<sub>v</sub> = A − 2·b·t<sub>f</sub> + (t<sub>w</sub> + 2r)·t<sub>f</sub>, etwas mehr als h·t<sub>w</sub>. Die Schubfliessgrenze ist τ<sub>y</sub> = f<sub>y</sub>/√3.',
        'Bei normalen Trägern ist der Schub selten massgebend – eher bei kurzen, hoch belasteten Trägern oder Einzellasten nahe am Lager.',
      ]);
    }
  }
  if (x.kind === 'timberBeam') {
    if (t === 'Festigkeiten') {
      return why('Woher kommen die Festigkeiten?', [
        'Bemessungswerte aus den Holzbautabellen HBT 2021 (SIA 265), schon durch γ<sub>M</sub> geteilt. Bei Feuchte mit η<sub>w</sub> abmindern: 0.8 teilweise geschützt oder bewittert, 0.6 feucht.',
        'k<sub>h</sub> (Höheneffekt) setzt man im Normalfall nicht an, η<sub>t</sub> = 1.0.',
      ]);
    }
    if (t === 'Erforderliche Höhe') {
      return why('Wie kommt man auf h?', [
        'Biegung: W = b·h²/6 ≥ M<sub>d</sub>/f<sub>m,d</sub>, also h<sub>M</sub> = √(6·M<sub>d</sub>/(f<sub>m,d</sub>·b)). Schub: τ = 1.5·V<sub>d</sub>/(b·h) ≤ f<sub>v,d</sub>, also h<sub>V</sub> = 1.5·V<sub>d</sub>/(f<sub>v,d</sub>·b).',
        'Die Breite nimmt man an (z. B. 120, 160, 200 mm) und rundet die Höhe auf: Brettschichtholz auf 40 mm (Lamellen), Vollholz auf 20 mm.',
      ]);
    }
    if (t === 'Schub') {
      return why('Warum der Faktor 1.5?', [
        'Im Rechteck ist die Schubspannung parabelförmig verteilt: in der Mitte 1.5-mal so gross wie V/A. V<sub>d</sub> nimmt man am Auflager.',
      ]);
    }
    if (t.startsWith('Querdruck')) {
      return why('Warum Querdruck?', [
        'Quer zur Faser ist Holz weich: Am Auflager drückt die Auflagerkraft auf die Fläche b·l<sub>A</sub>. Im Unterricht heisst es: „unbedingt erforderlich“.',
        'Daraus die nötige Auflagerlänge l<sub>A</sub> = A<sub>d</sub>/(b·f<sub>c,90,d</sub>) – oder bei gegebener Auflagerlänge die Mindestbreite b<sub>min</sub> = A<sub>d</sub>/(l<sub>A</sub>·f<sub>c,90,d</sub>).',
      ]);
    }
  }
  return '';
}

// ---------- Ergebnisse ----------

function setResult(html) {
  const element = $('designResult');
  // Ohne Ergebnis (nur ein Hinweis) wird die ganze Karte beim Drucken weggelassen
  $('designCard').classList.toggle('is-empty', /^<p class="d-empty"/.test(html));
  if (element.__html === html) return;
  element.__html = html;
  element.innerHTML = html;
}

function failText(fails) {
  return fails.length ? `<br><b class="d-warn">Nicht erfüllt: ${fails.join(', ')}</b>` : '';
}

// Kopf des Ergebnisses. opts.govern: massgebender Nachweis (neben der Ausnutzung),
// opts.warn: erfüllt, aber nur teilweise geprüft (gelb statt grün).
function head(title, eta, good, detail, opts = {}) {
  const state = !good ? 'bad' : opts.warn ? 'warn' : 'good';
  const verdict = !good ? '✕ Nachweis nicht erfüllt' : opts.warn ? `⚠ ${opts.warn}` : '✓ Nachweis erfüllt';
  const govern = opts.govern ? `<span class="d-gov">${opts.govern}</span>` : '';
  return `<div class="d-head ${state}"><div class="d-head-title">${title}</div><div class="d-head-eta">${bar(eta)}${govern}<span class="d-verdict">${verdict}</span></div>${detail ? `<div class="d-head-detail">${detail}</div>` : ''}</div>`;
}

// Horizontalkraft am Stützenfuss (aus dem System): oben wirkt das Moment Rx · L. Knicken mit Biegung
// (Interaktion) rechnet die App nicht; sie zeigt das Moment und vergleicht es mit dem reinen Biegewiderstand.
function columnBending(input, mRd, how) {
  const col = input && input.column;
  if (!col || !(Math.abs(col.Rx) > 1e-6)) return null;
  const M = Math.abs(col.Rx) * col.L;
  const enough = M <= mRd + 1e-9;
  const name = escapeHtml(col.name);
  return {
    M,
    mRd,
    enough,
    text: `${name}<sub>x</sub> = ${kn(Math.abs(col.Rx))} kN wirkt quer zur Stütze: oben M = ${name}<sub>x</sub> · L = ${kn(M)} kNm. Knicken mit Biegung ist hier nicht nachgewiesen. `
      + `Zum Vergleich reine Biegung: M<sub>Rd</sub> = ${kn(mRd)} kNm (${how}) – ${enough ? 'reicht für die Biegung allein' : '<b>reicht schon für die Biegung allein nicht</b>'}.`,
  };
}

// Massgebender Nachweis: der mit der grössten Ausnutzung
function governing(list) {
  const valid = list.filter(([, eta]) => Number.isFinite(eta));
  if (!valid.length) return '';
  const [name] = valid.reduce((a, b) => (b[1] > a[1] ? b : a));
  return `${name} massgebend`;
}

// Massgebende Durchbiegung (grösstes Verhältnis w / w_zul, Feld oder Kragarm)
function governingDeflection(sls) {
  if (!sls || !sls.checks.length) return null;
  return sls.checks.reduce((a, c) => (c.w / c.allowed > a.w / a.allowed ? c : a));
}

function deflectionText(check) {
  if (!check) return '';
  return `w = ${f(check.w * 1000, 1)} mm${check.cantilever ? ` (${check.what})` : ''}${check.up ? ' nach oben' : ''}`;
}

function eq(source) {
  return `<div class="sol-eq">${tex(source)}</div>`;
}

function res(source) {
  return `<div class="sol-res">${tex(source)}</div>`;
}

function note(html) {
  return `<p class="sol-note">${html}</p>`;
}

// Querschnittsskizze neben den Formeln (auf schmalen Bildschirmen darunter)
function withSketch(svg, caption, body) {
  return `<div class="d-sec-wrap"><div class="d-sec-main">${body}</div><figure class="d-sec">${svg}<figcaption>${caption}</figcaption></figure></div>`;
}

function bucklingCaption(axis) {
  return `<b class="d-sec-red">Rot</b>: Knicken um ${axis} – die Stütze weicht in Pfeilrichtung aus (${axis === 'z' ? 'über die schwache Richtung' : 'über die starke Richtung'}). Masse in mm.`;
}

// Schnittgrössen für den Träger: aus dem System (mit Lastbeiwert) oder von Hand
function beamActions(b, last) {
  if (b.source === 'manual') {
    if (!Number.isFinite(b.M)) return { error: 'Bitte das Bemessungsmoment M<sub>d</sub> eingeben.' };
    return { Md: Math.abs(b.M), Vd: Math.abs(b.V || 0), manual: true };
  }
  const forces = last && last.forces;
  if (!last || !last.result || !last.result.ok) return { error: 'Das System oben ist noch nicht lösbar. Schnittgrössen von Hand eingeben oder das System vervollständigen.' };
  if (!forces || !forces.ok) {
    // Den echten Grund nennen: Lager oder Last ausserhalb des Trägers ist ein Eingabefehler, kein abgestufter Träger
    const reason = forces && forces.reason ? escapeHtml(forces.reason) : '';
    if (reason && /^Ausserhalb/.test(forces.reason)) return { error: `<b class="d-warn">${reason}</b> Danach rechnet die Bemessung mit den Schnittgrössen des Systems.` };
    return { error: `${reason ? `${reason} ` : ''}Für die Bemessung M<sub>d</sub> und V<sub>d</sub> von Hand eingeben (Schnittgrössen: „von Hand eingeben“).` };
  }
  const mPos = forces.mMax;
  const mNeg = forces.mMin;
  const mGov = Math.abs(mNeg.m) > Math.abs(mPos.m) ? mNeg : mPos;
  const vGov = Math.abs(forces.vMin.v) > Math.abs(forces.vMax.v) ? forces.vMin : forces.vMax;
  const gamma = b.gamma || 1;
  const supportsX = last.result.reactions.map((r) => r.x);
  // Querdruck nur, wo das Lager nach oben drückt (abhebende Kräfte drücken nicht auf das Holz)
  const reactions = last.result.reactions.filter((r) => r.Rz > 1e-9).map((r) => ({ name: r.name, Rk: r.Rz, Rd: gamma * r.Rz }));
  return { Md: gamma * Math.abs(mGov.m), Vd: gamma * Math.abs(vGov.v), M: mGov.m, xM: mGov.x, V: vGov.v, xV: vGov.x, gamma, forces, supportsX, reactions };
}

// Biegelinie für die Grafik merken (auch wenn die Durchbiegung nicht nachgewiesen wird)
function setBeamLine(actions, EI, sls, name) {
  if (!actions.forces) { beamLine = null; return; }
  const line = deflection(actions.forces, actions.supportsX, EI);
  beamLine = line ? { line, EI, name, checks: sls ? sls.checks : [], gamma: actions.gamma } : null;
}

// Durchbiegung mit den Lasten des Systems (ohne Lastbeiwert), EI in kNm²
function serviceability(actions, EI, limit) {
  if (!actions.forces || !limit) return null;
  const line = deflection(actions.forces, actions.supportsX, EI);
  if (!line) return null;
  const span = line.span;
  const checks = [];
  // Feld zwischen den Lagern: die grössere Durchbiegung nach unten oder nach oben (z. B. bei langen Kragarmen)
  if (span > 1e-6) {
    const up = -line.maxUp.w > line.max.w;
    const field = up ? line.maxUp : line.max;
    checks.push({ what: 'Feld', length: span, w: Math.abs(field.w), x: field.x, up, allowed: span / limit });
  }
  for (const c of line.cantilevers) {
    checks.push({ what: `Kragarm ${c.side}`, length: c.length, w: Math.abs(c.w), x: c.x, up: c.w < 0, allowed: (2 * c.length) / limit, cantilever: true });
  }
  const good = checks.every((c) => c.w <= c.allowed + 1e-12);
  const worst = checks.reduce((m, c) => Math.max(m, c.w / c.allowed), 0);
  return { checks, good, eta: worst };
}

function deflectionStep(number, sls, EItext, limit, material, gamma) {
  if (!limit) return '';
  if (!sls) return step(number, 'Durchbiegung', 'Gebrauchstauglichkeit', note('Nur mit Schnittgrössen aus dem System oben: Die Biegelinie wird aus der Momentenlinie gerechnet.'));
  let body = eq(EItext);
  for (const c of sls.checks) {
    body += eq(`w_{\\text{${c.what}}} = ${f(c.w * 1000, 1)}${unit('mm')}${c.up ? '\\ \\text{nach oben}' : ''}\\ (x = ${f(c.x, 2)}\\,\\text{m}) \\ \\le\\ w_{zul} = \\frac{${c.cantilever ? `2 \\cdot ${f(c.length * 1000, 0)}` : f(c.length * 1000, 0)}}{${limit}} = ${f(c.allowed * 1000, 1)}${unit('mm')}${ok(c.w <= c.allowed + 1e-12)}`);
  }
  const loads = Math.abs((gamma || 1) - 1) > 1e-9
    ? 'mit den Lasten des Systems ohne Lastbeiwert (charakteristisch)'
    : 'mit den Lasten des Systems. Sind es Bemessungswerte, liegt w auf der sicheren Seite (Gebrauchslasten sind rund 1.4-mal kleiner)';
  body += note(`Biegelinie aus EI·w″ = −M ${loads}${material === 'timber' ? ', ohne Kriechen' : ''}. Einfeldträger zum Vergleich: w = 5·q·l⁴ / (384·E·I). Kragarm: w ≤ 2·c / ${limit} (c = Kraglänge).`);
  return step(number, 'Durchbiegung', 'Gebrauchstauglichkeit', body);
}

// Umkehraufgabe: grösste Spannweite eines Einfeldträgers mit Gleichlast q_d
function spanStep(number, qd, mRd, vRd) {
  if (!(qd > 0)) return '';
  const s = maxSpan(mRd, vRd, qd);
  let body = '';
  if (vRd) body += eq(`l_V = \\frac{2 \\cdot V_{Rd}}{q_d} = \\frac{2 \\cdot ${f(vRd, 1)}}{${f(qd, 2)}} = ${f(s.lV, 2)}${unit('m')}`);
  body += eq(`l_M = \\sqrt{\\frac{8 \\cdot M_{Rd}}{q_d}} = \\sqrt{\\frac{8 \\cdot ${f(mRd, 1)}}{${f(qd, 2)}}} = ${f(s.lM, 2)}${unit('m')}`);
  body += res(`l_{\\max} = ${f(s.l, 2)}${unit('m')}\\quad (\\text{${s.governs === 'V' ? 'Schub' : 'Biegung'} massgebend})`);
  body += note('Aus V<sub>d</sub> = q<sub>d</sub>·l/2 ≤ V<sub>Rd</sub> und M<sub>d</sub> = q<sub>d</sub>·l²/8 ≤ M<sub>Rd</sub>. Die Durchbiegung ist dabei nicht berücksichtigt.');
  return step(number, 'Grösste Spannweite', `Einfeldträger, q<sub>d</sub> = ${f(qd, 2)} kN/m`, body);
}

function actionsStep(actions, decimals) {
  if (actions.manual) {
    return step(1, 'Bemessungsschnittgrössen', 'von Hand', eq(`M_d = ${f(actions.Md, decimals)}${unit('kNm')},\\qquad V_d = ${f(actions.Vd, decimals)}${unit('kN')}`));
  }
  const g = actions.gamma;
  const factor = Math.abs(g - 1) > 1e-9 ? `${f(g, 2)} \\cdot ` : '';
  const chain = (symbol, value, design) => (factor
    ? `${factor}|${symbol}|_{\\max} = ${factor}${f(Math.abs(value), decimals)} = ${f(design, decimals)}`
    : `|${symbol}|_{\\max} = ${f(design, decimals)}`);
  return step(1, 'Bemessungsschnittgrössen', 'aus dem System oben',
    eq(`M_d = ${chain('M', actions.M, actions.Md)}${unit('kNm')}\\quad (x = ${f(actions.xM, 2)}\\,\\text{m})`)
    + eq(`V_d = ${chain('V', actions.V, actions.Vd)}${unit('kN')}\\quad (x = ${f(actions.xV, 2)}\\,\\text{m})`)
    + (factor ? '' : note('Lastbeiwert γ<sub>F</sub> = 1: Die Lasten im System sind schon Bemessungswerte. Für charakteristische Lasten γ<sub>F</sub> eintragen (z. B. 1.5).')));
}

function steelBeamResult(d, last, decimals) {
  const b = d.beam;
  exp = { kind: 'steelBeam', plastic: b.plastic };
  const actions = beamActions(b, last);
  if (actions.error) return `<p class="d-empty">${actions.error}</p>`;
  const options = { grade: b.grade, Md: actions.Md, Vd: actions.Vd, plastic: b.plastic, family: b.family };
  const list = familyProfiles(data.profiles, b.family);
  const evaluate = (profile) => {
    const r = steelBeam({ ...options, profile });
    r.sls = serviceability(actions, 2.1 * profile.Iy, b.limit);
    r.all = r.ok && (!r.sls || r.sls.good);
    return r;
  };
  const results = list.map(evaluate);
  let chosen = b.profile ? results.find((r) => r.profile.n === b.profile) : null;
  const auto = !chosen;
  if (!chosen) chosen = results.find((r) => (b.sls ? r.all : r.ok)) || null;
  const fy = STEEL_GRADES[b.grade];
  const W = b.plastic ? 'W_{pl,y}' : 'W_{el,y}';
  const wErf = (actions.Md * GAMMA_M1 * 1000) / fy;
  let html = '';
  if (!chosen) {
    // Reicht ein Profil für Biegung und Schub, aber keines für die Durchbiegung, hilft eine höhere Stahlsorte nicht (gleiches E)
    const onlySls = b.sls && results.some((r) => r.ok);
    const detail = onlySls
      ? `Biegung und Schub gingen, aber kein ${escapeHtml(b.family)} hält die Durchbiegung (l/${b.limit}) ein. Eine höhere Stahlsorte hilft nicht (gleicher E-Modul): andere Profilreihe wählen oder die Grenze prüfen.`
      : `Erforderlich ${tex(`${W} \\ge ${f(wErf, 1)}${unit('cm^3')}`)} – andere Profilreihe oder höhere Stahlsorte wählen.`;
    return { top: head(`Kein ${escapeHtml(b.family)} reicht`, 2, false, detail), steps: actionsStep(actions, decimals) };
  }
  const p = chosen.profile;
  const eta = Math.max(chosen.etaM, chosen.etaV || 0, chosen.sls ? chosen.sls.eta : 0);
  setBeamLine(actions, 2.1 * p.Iy, chosen.sls, `${p.n} · ${b.grade}`);
  const fails = [];
  if (chosen.etaM > 1 + 1e-9) fails.push('Biegung');
  if (chosen.etaV > 1 + 1e-9) fails.push('Querkraft');
  if (chosen.sls && !chosen.sls.good) {
    const better = results.slice(results.indexOf(chosen) + 1).find((x) => x.all);
    fails.push(`Durchbiegung${better ? ` – mit Durchbiegung reicht ${escapeHtml(better.profile.n)}` : ''}`);
  }
  const wGov = governingDeflection(chosen.sls);
  const top = head(`${escapeHtml(p.n)} · ${b.grade}${auto ? ' <span class="d-auto">automatisch gewählt</span>' : ''}`, eta, chosen.all,
    `M<sub>Rd</sub> = ${f(chosen.mRd, 1)} kNm · V<sub>Rd</sub> = ${chosen.vRd ? f(chosen.vRd, 0) : '–'} kN${wGov ? ` · ${deflectionText(wGov)}` : ''}${failText(fails)}`,
    { govern: governing([['Biegung', chosen.etaM], ['Querkraft', chosen.etaV], ['Durchbiegung', chosen.sls ? chosen.sls.eta : null]]) });
  let n = 1;
  html += actionsStep(actions, decimals);
  n++;
  html += step(n++, 'Erforderliches Widerstandsmoment', '',
    eq(`${W.replace('}', ',erf}')} = \\frac{M_d \\cdot \\gamma_{M1}}{f_y} = \\frac{${f(actions.Md * 100, 1)}\\,\\text{kNcm} \\cdot ${GAMMA_M1}}{${f(fy / 10, 1)}\\,\\text{kN/cm}^2} = ${f(wErf, 1)}${unit('cm^3')}`)
    + note(`f<sub>y</sub> = ${fy} N/mm² = ${f(fy / 10, 1)} kN/cm², γ<sub>M1</sub> = ${GAMMA_M1} (SIA 263). ${b.plastic ? 'Plastischer Widerstand W<sub>pl</sub> (Querschnittsklasse 1 oder 2).' : 'Elastischer Widerstand W<sub>el</sub>.'}`));
  html += step(n++, `Gewählt: ${escapeHtml(p.n)}`, auto ? (b.sls ? 'leichtestes Profil, das auch die Durchbiegung einhält' : 'leichtestes Profil, das reicht') : 'von Hand gewählt',
    withSketch(steelSectionSvg(p), `${escapeHtml(p.n)} · Biegung um y (die starke Achse). Masse in mm.`,
      eq(`${W} = ${f(chosen.W, 1)}${unit('cm^3')} ${chosen.W >= wErf - 1e-9 ? '\\ge' : '<'} ${f(wErf, 1)}${unit('cm^3')}${ok(chosen.W >= wErf - 1e-9)}`)
      + eq(`M_{Rd} = \\frac{${W} \\cdot f_y}{\\gamma_{M1}} = \\frac{${f(chosen.W, 1)} \\cdot ${f(fy / 10, 1)}}{${GAMMA_M1}} = ${f(chosen.mRd * 100, 0)}\\,\\text{kNcm} = ${f(chosen.mRd, 1)}${unit('kNm')}`)
      + `<div class="d-check-line">${tex(`M_d = ${f(actions.Md, decimals)} \\le M_{Rd} = ${f(chosen.mRd, 1)}${unit('kNm')}${ok(chosen.etaM <= 1 + 1e-9)}`)} ${bar(chosen.etaM)}</div>`
      + note(`Profilwerte ${escapeHtml(p.n)}: h = ${f(p.h, 0)} mm, b = ${f(p.b, 0)} mm, I<sub>y</sub> = ${f(p.Iy, 0)} cm⁴, W<sub>el,y</sub> = ${f(p.Wy, 1)} cm³, W<sub>pl,y</sub> = ${f(p.Wply, 1)} cm³, ${f(p.g, 1)} kg/m.`)));
  if (chosen.vRd) {
    const avErf = (actions.Vd * GAMMA_M1 * Math.sqrt(3) * 10) / fy;
    const shearCaption = ['IPE', 'HEA', 'HEB', 'HEM', 'UPE', 'UPN'].includes(p.f)
      ? '<b class="d-sec-hl-text">Gelb</b>: Schubfläche A<sub>v</sub> – vor allem der Steg trägt die Querkraft.'
      : '<b class="d-sec-hl-text">Gelb</b>: Schubfläche A<sub>v</sub> – die beiden senkrechten Wände tragen die Querkraft.';
    html += step(n++, 'Querkraft', '', withSketch(steelSectionSvg(p, { highlight: 'shear' }), shearCaption,
      eq(`A_{v,erf} = \\frac{V_d \\cdot \\gamma_{M1} \\cdot \\sqrt{3}}{f_y} = \\frac{${f(actions.Vd, decimals)} \\cdot ${GAMMA_M1} \\cdot \\sqrt{3}}{${f(fy / 10, 1)}} = ${f(avErf, 2)}${unit('cm^2')}\\ ${chosen.av >= avErf - 1e-9 ? '\\le' : '>'}\\ A_v = ${f(chosen.av, 2)}${unit('cm^2')}`)
      + eq(`V_{Rd} = \\frac{A_v \\cdot f_y}{\\sqrt{3} \\cdot \\gamma_{M1}} = \\frac{${f(chosen.av, 2)} \\cdot ${f(fy / 10, 1)}}{\\sqrt{3} \\cdot ${GAMMA_M1}} = ${f(chosen.vRd, 1)}${unit('kN')}`)
      + `<div class="d-check-line">${tex(`V_d = ${f(actions.Vd, decimals)} \\le V_{Rd} = ${f(chosen.vRd, 1)}${unit('kN')}${ok(chosen.etaV <= 1 + 1e-9)}`)} ${bar(chosen.etaV)}</div>`
      + note(`${['IPE', 'HEA', 'HEB', 'HEM'].includes(p.f) ? 'A<sub>v</sub> = A − 2·b·t<sub>f</sub> + (t<sub>w</sub> + 2r)·t<sub>f</sub> aus der Profiltabelle.' : p.Avz ? 'A<sub>v</sub> aus der Profiltabelle.' : 'A<sub>v</sub> ≈ Stegfläche, beim Hohlprofil A · h / (h + b).'} Querdruck und Kippen werden hier nicht untersucht (Druckgurt gehalten angenommen).`)));
  }
  if (b.limit) html += deflectionStep(n++, chosen.sls, `E \\cdot I_y = ${f(E_STEEL / 10, 0)}\\,\\text{kN/cm}^2 \\cdot ${f(p.Iy, 0)}\\,\\text{cm}^4 = ${f(2.1 * p.Iy, 0)}${unit('kNm^2')}`, b.limit, 'steel', actions.gamma);
  if (b.qSpan > 0) html += spanStep(n++, b.qSpan, chosen.mRd, chosen.vRd);
  return { top: top + candidateTable(results, chosen, 'beam'), steps: html };
}

function candidateTable(results, chosen, kind) {
  const index = results.indexOf(chosen);
  const from = Math.max(0, index - 2);
  const rows = results.slice(from, index + 4);
  const head = kind === 'beam'
    ? '<tr><th>Profil</th><th class="num">kg/m</th><th class="num">W [cm³]</th><th class="num">M<sub>Rd</sub> [kNm]</th><th class="num">η<sub>M</sub></th><th class="num">η<sub>V</sub></th><th class="num" title="massgebende Durchbiegung, K = am Kragarm">w [mm]</th><th class="c"></th></tr>'
    : '<tr><th>Profil</th><th class="num">kg/m</th><th class="num">A [cm²]</th><th class="num">N<sub>K,Rd,y</sub></th><th class="num">N<sub>K,Rd,z</sub></th><th class="num">η</th><th class="c"></th></tr>';
  const body = rows.map((r) => {
    const p = r.profile;
    const good = kind === 'beam' ? r.all : r.ok;
    const cells = kind === 'beam'
      ? `<td class="num">${f(p.g, 1)}</td><td class="num">${f(r.W, 1)}</td><td class="num">${f(r.mRd, 1)}</td><td class="num">${f(r.etaM * 100, 0)} %</td><td class="num">${r.etaV !== null ? `${f(r.etaV * 100, 0)} %` : '–'}</td><td class="num">${governingDeflection(r.sls) ? `${f(governingDeflection(r.sls).w * 1000, 1)}${governingDeflection(r.sls).cantilever ? ' K' : ''}` : '–'}</td>`
      : `<td class="num">${f(p.g, 1)}</td><td class="num">${f(p.A, 1)}</td><td class="num">${f(r.y.nRd, 0)}</td><td class="num">${f(r.z.nRd, 0)}</td><td class="num">${f(r.eta * 100, 0)} %</td>`;
    return `<tr data-profile="${escapeHtml(p.n)}" class="${r === chosen ? 'chosen' : ''}"><td>${escapeHtml(p.n)}</td>${cells}<td class="c ${good ? 'yes' : 'no'}">${good ? '✓' : '✕'}</td></tr>`;
  }).join('');
  return `<details class="sol-details d-candidates" open><summary>Nachbarprofile (Zeile anklicken = dieses Profil nehmen)</summary><table class="sol-table d-table"><thead>${head}</thead><tbody>${body}</tbody></table></details>`;
}

function roundUp(value, stepMm) {
  return Math.ceil(value / stepMm - 1e-9) * stepMm;
}

function timberBeamResult(d, last, decimals) {
  const b = d.beam;
  exp = { kind: 'timberBeam' };
  const actions = beamActions(b, last);
  if (actions.error) return `<p class="d-empty">${actions.error}</p>`;
  const material = TIMBER[b.timber];
  const etaW = TIMBER_EXPOSURE.find((e) => e.id === b.exposure).factor;
  if (!(b.b > 0)) return '<p class="d-empty">Bitte die Breite b eingeben.</p>';
  const stepMm = timberStep(b.step, material);
  const EIof = (h) => (material.E * 1000 * (b.b * h ** 3) / 12) * 1e-12; // kNm²
  const fmd = material.fmd * etaW;
  const fvd = material.fvd * etaW;
  // erforderliche Höhe aus Biegung und aus Schub, dann aufrunden
  const hM = Math.sqrt((6 * actions.Md * 1e6) / (fmd * b.b));
  const hV = (1.5 * actions.Vd * 1000) / (fvd * b.b);
  let h = b.h;
  const auto = !(h > 0);
  let bySls = false;
  if (auto) {
    h = roundUp(Math.max(hM, hV, stepMm), stepMm);
    if (b.sls && b.limit) {
      for (let guard = 0; guard < 400; guard++) {
        const sls = serviceability(actions, EIof(h), b.limit);
        if (!sls || sls.good) break;
        h += stepMm;
        bySls = true;
      }
    }
  }
  const r = timberBeam({ material, b: b.b, h, Md: actions.Md, Vd: actions.Vd, etaW });
  r.sls = b.limit ? serviceability(actions, EIof(h), b.limit) : null;
  setBeamLine(actions, EIof(h), r.sls, `${material.text.split(' ')[0]} ${f(b.b, 0)}/${f(h, 0)}`);
  // Querdruck: ohne Eingabe wird die nötige Auflagerlänge gerechnet (wie im Unterricht), mit Eingabe geprüft
  const lAGiven = b.lA > 0;
  const bearings = (actions.reactions || []).filter((x) => x.Rd > 1e-9).map((x) => ({ ...x, ...timberBearing({ material, R: x.Rd, b: b.b, lA: lAGiven ? b.lA : 1, etaW }) }));
  const bearingsOk = !lAGiven || bearings.every((x) => x.ok);
  const lAerfMax = bearings.length ? Math.max(...bearings.map((x) => x.lAerf)) : 0;
  const good = r.ok && (!r.sls || r.sls.good) && bearingsOk;
  const bearingEta = lAGiven && bearings.length ? Math.max(...bearings.map((x) => x.eta)) : null;
  const eta = Math.max(r.etaM, r.etaV, r.sls ? r.sls.eta : 0, bearingEta || 0);
  const fails = [];
  if (r.etaM > 1 + 1e-9) fails.push('Biegung');
  if (r.etaV > 1 + 1e-9) fails.push('Schub');
  if (!bearingsOk) fails.push(`Querdruck (l<sub>A</sub> ≥ ${f(lAerfMax, 0)} mm nötig)`);
  if (r.sls && !r.sls.good) fails.push('Durchbiegung');
  const slender = h / b.b;
  const cautions = [];
  if (bearings.length && !lAGiven) cautions.push(`Auflagerlänge l<sub>A</sub> ≥ ${f(lAerfMax, 0)} mm (Querdruck)`);
  if (slender > 6) cautions.push(`sehr schlank (h/b = ${f(slender, 1)}): Breite erhöhen – Kippen ist hier nicht untersucht`);
  const wGov = governingDeflection(r.sls);
  const top = head(`${material.text.split(' ')[0]} · b/h = ${f(b.b, 0)}/${f(h, 0)} mm${auto ? ' <span class="d-auto">Höhe automatisch</span>' : ''}`, eta, good,
    `M<sub>Rd</sub> = ${f(r.mRd, 1)} kNm · V<sub>Rd</sub> = ${f(r.vRd, 1)} kN${wGov ? ` · ${deflectionText(wGov)}` : ''}${cautions.length ? `<br><span class="d-caution">${cautions.join(' · ')}</span>` : ''}${failText(fails)}`,
    { govern: governing([['Biegung', r.etaM], ['Schub', r.etaV], ['Durchbiegung', r.sls ? r.sls.eta : null], ['Querdruck', bearingEta]]) });
  let html = '';
  let n = 1;
  html += actionsStep(actions, decimals);
  n++;
  const withEta = etaW < 1 ? ` \\cdot \\eta_w = ${f(material.fmd, 1)} \\cdot ${etaW}` : '';
  const withEtaV = etaW < 1 ? ` \\cdot \\eta_w = ${f(material.fvd, 1)} \\cdot ${etaW}` : '';
  html += step(n++, 'Festigkeiten', `${escapeHtml(material.text)}, HBT 2021`,
    eq(`f_{m,d}${withEta} = ${f(fmd, 2)}${unit('N/mm^2')},\\qquad f_{v,d}${withEtaV} = ${f(fvd, 2)}${unit('N/mm^2')}`)
    + note(`Bemessungswerte nach SIA 265${etaW < 1 ? `, abgemindert mit η<sub>w</sub> = ${etaW} (${escapeHtml(TIMBER_EXPOSURE.find((e) => e.id === b.exposure).text.split(':')[0])})` : ''}; η<sub>t</sub> = 1.0, k<sub>h</sub> nicht angesetzt.`));
  html += step(n++, 'Erforderliche Höhe', `b = ${f(b.b, 0)} mm angenommen`,
    eq(`h_M = \\sqrt{\\frac{6 \\cdot M_d}{f_{m,d} \\cdot b}} = \\sqrt{\\frac{6 \\cdot ${f(actions.Md, decimals)} \\cdot 10^6}{${f(fmd, 2)} \\cdot ${f(b.b, 0)}}} = ${f(hM, 1)}${unit('mm')}`)
    + eq(`h_V = \\frac{1.5 \\cdot V_d}{f_{v,d} \\cdot b} = \\frac{1.5 \\cdot ${f(actions.Vd, decimals)} \\cdot 10^3}{${f(fvd, 2)} \\cdot ${f(b.b, 0)}} = ${f(hV, 1)}${unit('mm')}`)
    + (auto
      ? res(`\\text{gewählt: } b/h = ${f(b.b, 0)}/${f(h, 0)}${unit('mm')}`) + note(`Aufgerundet auf ${stepMm} mm${material.glulam ? ' (Brettschichtholz: Lamellen zu 40 mm)' : ''}${bySls ? '; wegen der Durchbiegung erhöht' : ''}. ${hV > hM ? 'Hier ist der Schub massgebend.' : 'Hier ist die Biegung massgebend.'}`)
      : note(`Gewählt von Hand: h = ${f(h, 0)} mm.`)));
  html += step(n++, 'Biegung', '', withSketch(timberSectionSvg({ shape: 'rect', b: b.b, h }), `b/h = ${f(b.b, 0)}/${f(h, 0)} mm · Biegung um y: die Höhe h zählt im Quadrat.`,
    eq(`W_y = \\frac{b \\cdot h^2}{6} = \\frac{${f(b.b, 0)} \\cdot ${f(h, 0)}^2}{6} = ${f(r.W / 1e6, 3)} \\cdot 10^6${unit('mm^3')},\\qquad M_{Rd} = W_y \\cdot f_{m,d} = ${f(r.mRd, 1)}${unit('kNm')}`)
    + `<div class="d-check-line">${tex(`\\sigma_{m,d} = \\frac{M_d}{W_y} = \\frac{${f(actions.Md, decimals)} \\cdot 10^6}{${f(r.W / 1e6, 3)} \\cdot 10^6} = ${f(r.sigma, 2)} \\le f_{m,d} = ${f(r.fmd, 2)}${unit('N/mm^2')}${ok(r.etaM <= 1 + 1e-9)}`)} ${bar(r.etaM)}</div>`));
  html += step(n++, 'Schub', 'am Auflager',
    eq(`V_{Rd} = \\frac{b \\cdot h \\cdot f_{v,d}}{1.5} = \\frac{${f(b.b, 0)} \\cdot ${f(h, 0)} \\cdot ${f(fvd, 2)}}{1.5} = ${f(r.vRd, 1)}${unit('kN')}`)
    + `<div class="d-check-line">${tex(`\\tau_d = \\frac{1.5 \\cdot V_d}{b \\cdot h} = \\frac{1.5 \\cdot ${f(actions.Vd, decimals)} \\cdot 10^3}{${f(b.b, 0)} \\cdot ${f(h, 0)}} = ${f(r.tau, 2)} \\le f_{v,d} = ${f(r.fvd, 2)}${unit('N/mm^2')}${ok(r.etaV <= 1 + 1e-9)}`)} ${bar(r.etaV)}</div>`);
  if (bearings.length) {
    const fc90d = bearings[0].fc90d;
    let body;
    if (lAGiven) {
      body = bearings.map((x) => `<div class="d-check-line">${tex(`\\sigma_{c,90,d,${x.name}} = \\frac{${x.name}_d}{b \\cdot l_A} = \\frac{${f(x.Rd, decimals)} \\cdot 10^3}{${f(b.b, 0)} \\cdot ${f(b.lA, 0)}} = ${f(x.sigma, 2)} \\le f_{c,90,d} = ${f(fc90d, 2)}${unit('N/mm^2')}${ok(x.ok)}`)} ${bar(x.eta)}</div>`).join('');
      body += note(`Erforderlich wären l<sub>A</sub> ≥ ${f(lAerfMax, 0)} mm. f<sub>c,90,d</sub> „generell“ aus HBT${etaW < 1 ? ` · η<sub>w</sub> = ${etaW}` : ''}.`);
    } else {
      body = bearings.map((x) => eq(`l_{A,${x.name}} \\ge \\frac{${x.name}_d}{b \\cdot f_{c,90,d}} = \\frac{${f(x.Rd, decimals)} \\cdot 10^3}{${f(b.b, 0)} \\cdot ${f(fc90d, 2)}} = ${f(x.lAerf, 0)}${unit('mm')}`)).join('');
      body += note(`Aus σ<sub>c,90,d</sub> = A<sub>d</sub> / (b · l<sub>A</sub>) ≤ f<sub>c,90,d</sub>: So lang muss das Auflager mindestens sein. f<sub>c,90,d</sub> „generell“ aus HBT${etaW < 1 ? ` · η<sub>w</sub> = ${etaW}` : ''}. Mit einer eingegebenen Auflagerlänge wird stattdessen die Pressung nachgewiesen.`);
    }
    html += step(n++, 'Querdruck am Auflager', lAGiven ? `l<sub>A</sub> = ${f(b.lA, 0)} mm` : 'nötige Auflagerlänge', body);
  }
  if (b.limit) html += deflectionStep(n++, r.sls, `E_{0,mean} \\cdot I_y = ${f(material.E, 0)}\\,\\text{N/mm}^2 \\cdot \\frac{${f(b.b, 0)} \\cdot ${f(h, 0)}^3}{12} = ${f(EIof(h), 0)}${unit('kNm^2')}`, b.limit, 'timber', actions.gamma);
  if (b.qSpan > 0) html += spanStep(n++, b.qSpan, r.mRd, r.vRd);
  return { top, steps: html };
}

// ---------- Stütze ----------

// Stützen im System: Lager, die nicht auf der Trägerachse liegen. Unter der Achse ist es ein
// Stützenfuss (Druck bei Auflagerkraft nach oben), über der Achse ein Hänger (Zug).
export function systemColumns(last) {
  if (!last || !last.result || !last.result.ok) return [];
  return last.result.reactions
    .filter((r) => Number.isFinite(r.axisZ) && Number.isFinite(r.z) && Math.abs(r.axisZ - r.z) > 1e-6)
    .map((r) => {
      const below = r.z < r.axisZ;
      return { name: r.name, L: Math.abs(r.axisZ - r.z), below, top: r.axisZ, foot: r.z, Rz: r.Rz, Rx: r.Rx, compression: below ? r.Rz : -r.Rz };
    });
}

// Bezeichnung der Stütze im Lösungsweg
function columnLabel(col) {
  return col.below ? `Stütze unter Lager ${escapeHtml(col.name)}` : `Druckstab über Lager ${escapeHtml(col.name)}`;
}

// Gewählte Stütze: von Hand A oder B, sonst die stärker gedrückte
function pickColumn(c, columns) {
  if (!columns.length) return null;
  const named = c.support !== 'auto' ? columns.find((x) => x.name === c.support) : null;
  if (named) return named;
  return columns.reduce((best, x) => (x.compression > best.compression ? x : best), columns[0]);
}

function columnLengths(c, L) {
  const caseBeta = (id) => EULER_CASES.find((e) => e.id === id).beta;
  const beta = c.beta > 0 ? c.beta : caseBeta(c.euler);
  const LkY = beta * L;
  let LkZ = LkY;
  let betaZ = beta;
  let Lz = L;
  if (c.zOwn) {
    betaZ = c.betaZ > 0 ? c.betaZ : caseBeta(c.eulerZ);
    Lz = c.Lz > 0 ? c.Lz : L;
    LkZ = betaZ * Lz;
  }
  return { L, beta, betaZ, Lz, LkY, LkZ };
}

function lengthStep(c, k, number) {
  let body = eq(`L_{K${c.zOwn ? ',y' : ''}} = \\beta \\cdot L = ${k.beta} \\cdot ${f(k.L, 2)} = ${f(k.LkY, 2)}${unit('m')}`);
  if (c.zOwn) body += eq(`L_{K,z} = \\beta_z \\cdot L_z = ${k.betaZ} \\cdot ${f(k.Lz, 2)} = ${f(k.LkZ, 2)}${unit('m')}`);
  const euler = EULER_CASES.find((e) => e.id === c.euler);
  body += note(`${escapeHtml(euler.text)}${c.beta > 0 ? `; β = ${c.beta} frei gewählt` : ''}.${c.zOwn ? ' Um z eigene Länge und Lagerung.' : ' Gleiche Knicklänge um beide Achsen, massgebend ist dann die schwache Achse.'}`);
  return step(number, 'Knicklänge', 'Eulerfall', body);
}

// Länge und Bemessungslast der Stütze: aus dem System (Lager unter der Achse), von Hand oder aus Flächenlasten.
// Liefert { L, Nd, step: { title, hint, body } | null } oder { error }.
function columnInput(c, last, decimals) {
  const gamma = c.gamma || 1;
  const factor = Math.abs(gamma - 1) > 1e-9;
  if (c.source === 'system') {
    if (!last || !last.result || !last.result.ok) return { error: 'Das System oben ist noch nicht lösbar. System vervollständigen oder „N und L von Hand“ wählen.' };
    const columns = systemColumns(last);
    const col = pickColumn(c, columns);
    if (!col) {
      return { error: 'Im System oben liegen beide Lager auf der Trägerachse – es gibt keine Stütze. Ein Lager in der Skizze nach unten ziehen (Stützenfuss): Dann kommen Länge und Normalkraft von dort. Oder „N und L von Hand“ wählen.' };
    }
    if (col.compression <= 1e-9) {
      return { error: col.below
        ? `Die Stütze unter Lager ${escapeHtml(col.name)} zieht am Träger (${escapeHtml(col.name)}<sub>z</sub> = ${kn(Math.abs(col.Rz))} kN nach unten): Sie ist auf Zug beansprucht und knickt nicht.`
        : `Lager ${escapeHtml(col.name)} liegt über der Achse (Hänger) und trägt auf Zug – ein Zugglied knickt nicht.` };
    }
    const Nd = gamma * col.compression;
    const name = col.name;
    // Stütze unter der Achse: Druck bei Auflagerkraft nach oben. Stab über der Achse: Druck, wenn das Lager nach unten drückt.
    let body = eq(col.below
      ? `L = z_{\\text{Achse}} - z_{${name}} = ${f(col.top, 2)} - (${f(col.foot, 2)}) = ${f(col.L, 2)}${unit('m')}`
      : `L = z_{${name}} - z_{\\text{Achse}} = ${f(col.foot, 2)} - (${f(col.top, 2)}) = ${f(col.L, 2)}${unit('m')}`);
    const force = col.below ? `${name}_z` : `-${name}_z`;
    body += eq(factor
      ? `N_d = \\gamma_F \\cdot ${col.below ? force : `(${force})`} = ${f(gamma, 2)} \\cdot ${f(col.compression, decimals)} = ${kn(Nd)}${unit('kN')}`
      : `N_d = ${force} = ${f(Nd, decimals)}${unit('kN')}`);
    let text = col.below
      ? `Länge und Normalkraft kommen aus der Skizze: Lager ${escapeHtml(name)} ist der Stützenfuss, die Auflagerkraft ${name}<sub>z</sub> ist die Normalkraft der Stütze.`
      : `Länge und Normalkraft kommen aus der Skizze: Lager ${escapeHtml(name)} liegt über der Achse und drückt nach unten, der Stab dazwischen ist gedrückt.`;
    if (Math.abs(col.Rx) > 1e-6) {
      text += ` <b class="d-warn">${name}<sub>x</sub> = ${kn(Math.abs(col.Rx))} kN</b> wirkt quer zur Stütze und erzeugt oben ein Biegemoment von ${kn(Math.abs(col.Rx) * col.L)} kNm – Knicken mit Biegung ist hier nicht nachgewiesen.`;
    }
    if (!factor) text += ' Lastbeiwert γ<sub>F</sub> = 1: Die Lasten im System sind Bemessungswerte.';
    return { L: col.L, Nd, column: col, step: { title: columnLabel(col), hint: 'aus dem System oben', body: body + note(text) } };
  }
  if (!(c.L > 0)) return { error: 'Bitte die Stützenlänge L eingeben.' };
  if (c.source === 'area') {
    const hasLoad = Number.isFinite(c.gk) || Number.isFinite(c.qk);
    if (!(c.area > 0) || !hasLoad) return { error: 'Bitte g<sub>k</sub>, q<sub>k</sub> (kN/m²) und die Einzugsfläche (m²) eingeben.' };
    const g = c.gk || 0;
    const q = c.qk || 0;
    const qd = 1.35 * g + 1.5 * q;
    const Nd = qd * c.area;
    return {
      L: c.L,
      Nd,
      step: {
        title: 'Bemessungslast',
        hint: 'aus Flächenlasten',
        body: eq(`N_d = (1.35 \\cdot g_k + 1.5 \\cdot q_k) \\cdot A_E = (1.35 \\cdot ${f(g, 2)} + 1.5 \\cdot ${f(q, 2)}) \\cdot ${f(c.area, 2)} = ${f(qd, 3)} \\cdot ${f(c.area, 2)} = ${kn(Nd)}${unit('kN')}`)
          + note('A<sub>E</sub> = Einzugsfläche der Stütze. Das Eigengewicht der Stütze ist nicht eingerechnet.'),
      },
    };
  }
  if (!(c.N > 0)) return { error: 'Bitte die Normalkraft N (Druck, kN) eingeben – oder eine Auflagerkraft aus dem System übernehmen.' };
  const Nd = gamma * c.N;
  return {
    L: c.L,
    Nd,
    step: factor ? { title: 'Bemessungslast', hint: '', body: eq(`N_d = \\gamma_F \\cdot N = ${f(gamma, 2)} \\cdot ${kn(c.N)} = ${kn(Nd)}${unit('kN')}`) } : null,
  };
}

// Kopf des Lösungswegs: Herkunft von L und N, dann die Knicklänge
function columnIntro(c, input, k) {
  let html = '';
  let n = 1;
  if (input.step) html += step(n++, input.step.title, input.step.hint, input.step.body);
  html += lengthStep(c, k, n++);
  return { html, next: n };
}

function steelColumnResult(d, last, decimals) {
  const c = d.column;
  const input = columnInput(c, last, decimals);
  if (input.error) return `<p class="d-empty">${input.error}</p>`;
  const Nd = input.Nd;
  const k = columnLengths(c, input.L);
  exp = { kind: 'steelColumn', c, input, k, grade: c.grade };
  const intro = columnIntro(c, input, k);
  const list = familyProfiles(data.profiles, c.family);
  const results = list.map((profile) => steelColumn({ profile, grade: c.grade, LkY: k.LkY, LkZ: k.LkZ, Nd, c4: data.c4 }));
  // Biegung aus einer Horizontalkraft am Fuss (nur zum Vergleich, ohne Interaktion)
  const bendingOf = (profile) => columnBending(input, (profile.Wply * (STEEL_GRADES[c.grade] / 10)) / GAMMA_M1 / 100, `${escapeHtml(profile.n)}, W<sub>pl,y</sub> · f<sub>y</sub> / γ<sub>M1</sub>`);
  let chosen = c.profile ? results.find((r) => r.profile.n === c.profile) : null;
  const auto = !chosen;
  // automatisch: leichtestes Profil, das knickt sicher hält und auch die Biegung allein aufnimmt
  if (!chosen) chosen = results.find((r) => r.ok && (!bendingOf(r.profile) || bendingOf(r.profile).enough)) || null;
  if (!chosen) {
    return { top: head(`Kein ${escapeHtml(c.family)} reicht`, 2, false, `N<sub>d</sub> = ${kn(Nd)} kN – andere Profilreihe, höhere Stahlsorte oder kürzere Knicklänge wählen.`), steps: intro.html };
  }
  const p = chosen.profile;
  exp.chosen = chosen;
  const fy = chosen.fy;
  const gov = chosen.governing;
  const bending = bendingOf(p);
  const bendEta = bending ? bending.M / bending.mRd : 0;
  const top = head(`${escapeHtml(p.n)} · ${c.grade}${auto ? ' <span class="d-auto">automatisch gewählt</span>' : ''}`, Math.max(chosen.eta, bendEta), chosen.ok && (!bending || bending.enough),
    `N<sub>K,Rd</sub> = ${f(chosen.nRd, 0)} kN (Knicken um ${gov.axis}) · N<sub>d</sub> = ${kn(Nd)} kN${input.column ? ` · ${columnLabel(input.column)}, L = ${f(input.L, 2)} m` : ''}${bending ? `<br><span class="d-caution">${bending.text}</span>` : ''}`,
    { warn: bending ? 'Nur Knicken geprüft' : '', govern: bendEta > chosen.eta ? `Biegung aus ${escapeHtml(input.column.name)}<sub>x</sub> massgebend` : `Knicken um ${gov.axis} massgebend` });
  let html = intro.html;
  let n = intro.next;
  const sameSteelAxes = Math.abs(chosen.y.nRd - chosen.z.nRd) < 1e-9;
  html += step(n++, `Querschnittswerte ${escapeHtml(p.n)}`, 'Profiltabelle', withSketch(steelSectionSvg(p, { buckling: sameSteelAxes ? null : gov.axis }), sameSteelAxes ? `${escapeHtml(p.n)} · beide Achsen gleich. Masse in mm.` : bucklingCaption(gov.axis),
    eq(`A = ${f(p.A, 2)}${unit('cm^2')},\\qquad i_y = ${f(p.iy, 2)}${unit('cm')},\\qquad i_z = ${f(p.iz, 2)}${unit('cm')}`)
    + note(`h = ${f(p.h, 0)} mm, b = ${f(p.b, 0)} mm${p.tf ? `, t<sub>f</sub> = ${f(p.tf, 1)} mm` : ''}${p.t ? `, t = ${f(p.t, 1)} mm` : ''}, ${f(p.g, 1)} kg/m. Der kleinere Trägheitsradius i gehört zur Achse, um die die Stütze am ehesten knickt.`)));
  const ax = [chosen.y, chosen.z];
  const slender = ax.filter((a) => a.lambdaK > 200);
  html += step(n++, 'Schlankheit', '',
    ax.map((a) => eq(`\\lambda_{K,${a.axis}} = \\frac{L_{K${c.zOwn ? `,${a.axis}` : ''}}}{i_${a.axis}} = \\frac{${f(a.Lk * 100, 0)}}{${f(a.i, 2)}} = ${f(a.lambdaK, 1)}`)).join('')
    + eq(`\\lambda_E = \\pi \\sqrt{\\frac{E}{f_y}} = \\pi \\sqrt{\\frac{${E_STEEL}}{${fy}}} = ${f(chosen.y.lambdaE, 1)}`)
    + ax.map((a) => eq(`\\bar{\\lambda}_{K,${a.axis}} = \\frac{\\lambda_{K,${a.axis}}}{\\lambda_E} = \\frac{${f(a.lambdaK, 1)}}{${f(a.lambdaE, 1)}} = ${f(a.lambdaBar, 3)}`)).join('')
    + (slender.length ? note(`<b class="d-warn">λ<sub>K</sub> = ${f(slender[0].lambdaK, 0)} &gt; 200:</b> zu schlank für ein Haupttragelement (Grenzen: 200 Haupttragelemente, 250 Verbände).`) : ''));
  html += step(n++, 'Knickspannungskurve und Abminderung', 'SIA 263',
    ax.map((a) => note(`Achse ${a.axis}: Kurve <b>${a.curve}</b> (α<sub>K</sub> = ${CURVE_ALPHA[a.curve]}) – ${curveReason(p, a.axis)}`)
      + eq(`\\Phi_{K,${a.axis}} = 0.5 \\left[1 + \\alpha_K (\\bar{\\lambda}_K - 0.2) + \\bar{\\lambda}_K^2\\right] = 0.5 \\left[1 + ${a.alpha} \\cdot (${f(a.lambdaBar, 3)} - 0.2) + ${f(a.lambdaBar, 3)}^2\\right] = ${f(a.phi, 3)}`)
      + eq(`\\chi_{K,${a.axis}} = \\frac{1}{\\Phi_K + \\sqrt{\\Phi_K^2 - \\bar{\\lambda}_K^2}} = \\frac{1}{${f(a.phi, 3)} + \\sqrt{${f(a.phi, 3)}^2 - ${f(a.lambdaBar, 3)}^2}} = ${f(a.chi, 3)}`)).join('')
    + note('χ<sub>K</sub> kann auch aus den Tabellen C4/06 abgelesen werden (Schritt 0.01 in λ̄<sub>K</sub>) – gleiche Werte.'));
  let body = ax.map((a) => eq(`N_{K,Rd,${a.axis}} = \\frac{\\chi_{K,${a.axis}} \\cdot A \\cdot f_y}{\\gamma_{M1}} = \\frac{${f(a.chi, 3)} \\cdot ${f(p.A, 2)} \\cdot ${f(fy / 10, 1)}}{${GAMMA_M1}} = ${f(a.nRdFormula, 0)}${unit('kN')}`)
    + (a.fromTable ? note(`<b class="d-warn">Achse ${a.axis}: Die C4-Tabelle liegt hier ${f((1 - a.c4.ratio) * 100, 1)} % unter der Formel</b> – schlanker Querschnitt (Klasse 4, lokales Beulen), den die Formel nicht erfasst. Massgebend ist der Tabellenwert: N<sub>K,Rd,${a.axis}</sub> = ${f(a.nRd, 0)} kN.`) : '')).join('');
  body += res(`N_{K,Rd} = \\min = ${f(chosen.nRd, 0)}${unit('kN')}\\quad (\\text{Knicken um } ${gov.axis})`);
  const tableNotes = ax.map((a) => {
    if (!a.c4 || a.fromTable) return '';
    if (a.c4.outOfRange) return `Achse ${a.axis}: L<sub>K</sub> ausserhalb der C4-Tabelle (bis ${f(a.c4.max, 1)} m).`;
    const diff = ((a.c4.nRd - a.nRdFormula) / a.nRdFormula) * 100;
    const where = a.c4.exact ? `bei ${f(a.c4.L1, 2)} m` : `zwischen ${f(a.c4.L0, 2)} m (${f(a.c4.N0, 0)} kN) und ${f(a.c4.L1, 2)} m (${f(a.c4.N1, 0)} kN) interpoliert`;
    return `Achse ${a.axis}: ${f(a.c4.nRd, 0)} kN ${where}${Math.abs(diff) >= 0.5 ? ` (${diff > 0 ? '+' : '−'}${f(Math.abs(diff), 1)} % zur Formel)` : ''}.`;
  }).filter(Boolean);
  if (tableNotes.length) body += note(`Zum Vergleich die Bemessungstafeln SZS C4 (Vorbemessung): ${tableNotes.join(' ')}`);
  body += `<div class="d-check-line">${tex(`N_d = ${kn(Nd)} \\le N_{K,Rd} = ${f(chosen.nRd, 0)}${unit('kN')}${ok(chosen.ok)}`)} ${bar(chosen.eta)}</div>`;
  html += step(n++, 'Knickwiderstand und Nachweis', 'f<sub>y</sub> in kN/cm², A in cm²', body);
  return { top: top + candidateTable(results, chosen, 'column'), steps: html };
}

function timberColumnResult(d, last, decimals) {
  const c = d.column;
  const input = columnInput(c, last, decimals);
  if (input.error) return `<p class="d-empty">${input.error}</p>`;
  const Nd = input.Nd;
  const material = TIMBER[c.timber];
  const etaW = TIMBER_EXPOSURE.find((e) => e.id === c.exposure).factor;
  const k = columnLengths(c, input.L);
  exp = { kind: 'timberColumn', c, input, k };
  const intro = columnIntro(c, input, k);
  const round = c.shape === 'round';
  const calc = (bb, hh, dd) => timberColumn({ material, shape: c.shape, b: bb, h: hh, d: dd, LkY: k.LkY, LkZ: k.LkZ, Nd, etaW, table: c.kcTable });
  // Biegung aus einer Horizontalkraft am Fuss (starke Richtung, nur zum Vergleich): die Suche nimmt sie mit
  const bendingAt = (bb, hh, dd) => {
    const wBend = round ? (Math.PI * dd ** 3) / 32 : (Math.min(bb, hh) * Math.max(bb, hh) ** 2) / 6;
    return columnBending(input, (wBend * material.fmd * etaW) / 1e6, `W · f<sub>m,d</sub>${etaW < 1 ? ' · η<sub>w</sub>' : ''}`);
  };
  const fits = (bb, hh, dd) => {
    const bend = bendingAt(bb, hh, dd);
    return calc(bb, hh, dd).ok && (!bend || bend.enough);
  };
  const stepMm = timberStep(c.step, material, false);
  let bw = c.b;
  let hw = c.h;
  let dw = c.d;
  let auto = '';
  if (round) {
    if (!(dw > 0)) {
      auto = 'Durchmesser automatisch';
      dw = roundUp(60, stepMm);
      while (dw < 2000 && !fits(0, 0, dw)) dw += stepMm;
      dw = Math.min(dw, 2000);
    }
  } else if (!(bw > 0) && !(hw > 0)) {
    auto = 'quadratisch, automatisch';
    let a = roundUp(60, stepMm);
    while (a < 2000 && !fits(a, a)) a += stepMm;
    bw = a;
    hw = a;
  } else if (!(hw > 0)) {
    auto = 'Höhe automatisch';
    hw = roundUp(Math.max(bw, stepMm), stepMm);
    // höchstens 400 Schritte (Schutz vor absurden Eingaben)
    for (let guard = 0; guard < 400 && hw < 8 * bw && !fits(bw, hw); guard++) hw += stepMm;
  } else if (!(bw > 0)) {
    auto = 'Breite automatisch';
    bw = roundUp(60, stepMm);
    for (let guard = 0; guard < 400 && bw < hw && !fits(bw, hw); guard++) bw += stepMm;
  }
  const r = calc(bw, hw, dw);
  exp.r = r;
  const name = round ? `Ø ${f(dw, 0)} mm` : `b/h = ${f(bw, 0)}/${f(hw, 0)} mm`;
  const bending = bendingAt(bw, hw, dw);
  const bendEta = bending ? bending.M / bending.mRd : 0;
  const sameAxes = round || Math.abs(r.y.nRd - r.z.nRd) < 1e-9;
  const top = head(`${material.text.split(' ')[0]} · ${name}${auto ? ` <span class="d-auto">${auto}</span>` : ''}`, Math.max(r.eta, bendEta), r.ok && (!bending || bending.enough),
    `N<sub>K,Rd</sub> = ${f(r.nRd, 1)} kN${sameAxes ? '' : ` (Knicken um ${r.governing.axis})`} · N<sub>d</sub> = ${kn(Nd)} kN${input.column ? ` · ${columnLabel(input.column)}, L = ${f(input.L, 2)} m` : ''}${bending ? `<br><span class="d-caution">${bending.text}</span>` : ''}`
    + (auto && !r.ok ? failText(['auch der grösste gesuchte Querschnitt reicht nicht – Last, Knicklänge oder Holzklasse prüfen']) : ''),
    { warn: bending ? 'Nur Knicken geprüft' : '', govern: bendEta > r.eta ? `Biegung aus ${escapeHtml(input.column.name)}<sub>x</sub> massgebend` : sameAxes ? (round ? '' : 'beide Achsen gleich') : `Knicken um ${r.governing.axis} massgebend` });
  let html = intro.html;
  let n = intro.next;
  // Rundholz mit gleicher Knicklänge: nur eine Richtung zeigen
  const ax = round && Math.abs(k.LkY - k.LkZ) < 1e-12 ? [r.governing] : [r.y, r.z];
  const sub = (a) => (ax.length === 1 ? '' : `_${a.axis}`);
  const subComma = (a) => (ax.length === 1 ? '' : `,${a.axis}`);
  const section = round
    ? eq(`A = \\frac{\\pi \\cdot d^2}{4} = \\frac{\\pi \\cdot ${f(dw, 0)}^2}{4} = ${f(r.section.A, 0)}${unit('mm^2')},\\qquad i = \\frac{d}{4} = ${f(r.y.i, 1)}${unit('mm')}`)
    : eq(`A = b \\cdot h = ${f(bw, 0)} \\cdot ${f(hw, 0)} = ${f(r.section.A, 0)}${unit('mm^2')}`)
      + eq(`i_y = 0.289 \\cdot h = ${f(r.y.i, 1)}${unit('mm')},\\qquad i_z = 0.289 \\cdot b = ${f(r.z.i, 1)}${unit('mm')}`);
  const timberSketch = timberSectionSvg({ shape: c.shape, b: bw, h: hw, d: dw }, { buckling: sameAxes ? null : r.governing.axis });
  html += step(n++, 'Querschnittswerte', name, withSketch(timberSketch, sameAxes ? `${name} · ${round ? 'in jede Richtung gleich' : 'beide Achsen gleich'}.` : bucklingCaption(r.governing.axis),
    section + (round ? '' : note('i = h/√12 = 0.289 · h; für Knicken um z zählt die Breite b.'))));
  const slender = ax.filter((a) => a.lambda > 150);
  html += step(n++, 'Schlankheit', '',
    ax.map((a) => eq(`\\lambda${sub(a)} = \\frac{L_{K${c.zOwn ? `,${a.axis}` : ''}}}{i${sub(a)}} = \\frac{${f(a.Lk * 1000, 0)}}{${f(a.i, 1)}} = ${f(a.lambda, 1)},\\qquad \\lambda_{rel${subComma(a)}} = \\frac{\\lambda${sub(a)}}{${material.lambda0}} = ${f(a.lambdaRel, 3)}`)).join('')
    + note(`λ<sub>rel</sub> = λ / ${material.lambda0} für ${material.glulam ? 'Brettschichtholz' : 'Vollholz'} (wie im Unterricht).${slender.length ? ` <b class="d-warn">λ = ${f(slender[0].lambda, 0)} &gt; 150: zu schlank</b> (Grenze 150, Windverbände 200).` : ' Grenze λ ≤ 150 eingehalten.'}`));
  const kcLine = (a) => {
    if (c.kcTable) {
      const row = `\\lambda_{rel${subComma(a)}} = ${f(a.lambdaRel, 3)} \\;\\rightarrow\\; \\text{Zeile } ${f(a.used, 2)}`;
      return eq(a.k === null ? `${row} \\;\\Rightarrow\\; k_{c${subComma(a)}} = 1.0` : `${row}:\\quad k_{c${subComma(a)}} = ${f(a.kc, 3)}`);
    }
    return eq(a.k === null
      ? `\\lambda_{rel${subComma(a)}} = ${f(a.lambdaRel, 3)} \\le 0.3 \\;\\Rightarrow\\; k_{c${subComma(a)}} = 1.0`
      : `k${sub(a)} = 0.5 \\left[1 + \\beta_c (\\lambda_{rel} - 0.3) + \\lambda_{rel}^2\\right] = ${f(a.k, 3)},\\qquad k_{c${subComma(a)}} = \\frac{1}{k + \\sqrt{k^2 - \\lambda_{rel}^2}} = ${f(a.kc, 3)}`);
  };
  html += step(n++, '<span>Knickbeiwert k<sub>c</sub></span>', c.kcTable ? 'Tabelle HBT S. 52' : `β<sub>c</sub> = ${material.glulam ? '0.1 (Brettschichtholz)' : '0.2 (Vollholz)'}`,
    ax.map(kcLine).join('')
    + note(c.kcTable
      ? `Wie im Unterricht: λ<sub>rel</sub> auf die nächsthöhere Tabellenzeile (Schritt 0.02) aufrunden und k<sub>c</sub> ablesen. Die Tabelle folgt k<sub>c</sub> = 1 / (k + √(k² − λ<sub>rel</sub>²)) mit k = 0.5·[1 + β<sub>c</sub>(λ<sub>rel</sub> − 0.3) + λ<sub>rel</sub>²], β<sub>c</sub> = ${material.glulam ? '0.1 (BSH)' : '0.2 (Vollholz)'}.`
      : 'SIA 265 (265.30/31), exakt ohne Tabellenrundung.'));
  const fc0d = r.y.fc0d;
  let body = eq(`f_{c,0,d}${etaW < 1 ? ` \\cdot \\eta_w = ${f(material.fc0d, 1)} \\cdot ${etaW}` : ''} = ${f(fc0d, 2)}${unit('N/mm^2')}`);
  body += ax.map((a) => eq(`N_{K,Rd${subComma(a)}} = k_{c${subComma(a)}} \\cdot f_{c,0,d} \\cdot A = ${f(a.kc, 3)} \\cdot ${f(fc0d, 2)} \\cdot ${f(a.A, 0)} = ${f(a.nRd, 1)}${unit('kN')}`)).join('');
  if (ax.length > 1) body += res(`N_{K,Rd} = \\min = ${f(r.nRd, 1)}${unit('kN')}\\quad (\\text{Knicken um } ${r.governing.axis})`);
  if (!round && auto === 'Höhe automatisch' && r.governing.axis === 'z') {
    const hErf = (Nd * 1000) / (r.z.kc * fc0d * bw);
    body += note(`Gesuchte Höhe: h<sub>erf</sub> = N<sub>d</sub> / (k<sub>c,z</sub> · f<sub>c,0,d</sub> · b) = ${f(hErf, 0)} mm → gewählt ${f(hw, 0)} mm.`);
  }
  body += `<div class="d-check-line">${tex(`N_d = ${kn(Nd)} \\le N_{K,Rd} = ${f(r.nRd, 1)}${unit('kN')}${ok(r.ok)}`)} ${bar(r.eta)}</div>`;
  html += step(n++, 'Knickwiderstand und Nachweis', `${escapeHtml(material.text)}, HBT 2021`, body);
  return { top, steps: html };
}

// ---------- Aktualisieren ----------

export function updateDesign() {
  if (!ctx) return;
  const d = ctx.getDesign();
  const last = ctx.getLast();
  const decimals = ctx.getDecimals();
  // Standardmässig aus: nur die Kopfzeile mit dem Haken, kein Rechenweg, keine Biegelinie
  const enabled = !ctx.getEnabled || ctx.getEnabled();
  $('designCard').classList.toggle('is-off', !enabled);
  $('designCheck').checked = enabled;
  if (!enabled) {
    setResult('');
    setSteps('');
    beamLine = null;
    renderBeamLine(d, last);
    return;
  }
  // Stützen im System (Lager unter der Achse): Formular neu aufbauen, wenn eine dazukommt oder wegfällt
  const columns = systemColumns(last);
  const signature = columns.map((x) => `${x.name}${x.below ? 'u' : 'o'}`).join(',');
  if (d.tab === 'column' && signature !== columnSignature) renderDesignForm();
  const info = $('designColumnInfo');
  if (info) {
    const col = pickColumn(d.column, columns);
    let html;
    if (!last || !last.result || !last.result.ok) html = '<span>System oben noch nicht lösbar</span>';
    else if (!col) html = '<b class="d-warn">Kein Lager unter der Achse</b> <span>– Lager in der Skizze nach unten ziehen, dann ist das der Stützenfuss</span>';
    else if (!col.below && col.compression <= 1e-9) html = `<span class="d-col-chip">Lager ${escapeHtml(col.name)} hängt über der Achse (Hänger, L = ${f(col.L, 2)} m) – Zug, kein Knicken</span>`;
    else if (!col.below) html = `<span class="d-col-chip">Druckstab über Lager ${escapeHtml(col.name)}: L = ${f(col.L, 2)} m · N = ${kn(col.compression)} kN</span>`;
    else html = `<span class="d-col-chip">Stütze unter Lager ${escapeHtml(col.name)}: L = ${f(col.L, 2)} m · ${escapeHtml(col.name)}<sub>z</sub> = ${kn(col.Rz)} kN${col.Rz < 0 ? ' (Zug)' : ''}</span>`;
    if (info.__html !== html) { info.__html = html; info.innerHTML = html; }
  }
  const take = $('designReactions');
  if (take) {
    // nur drückende Auflagerkräfte (nach oben) als Normalkraft anbieten
    const reactions = last && last.result && last.result.ok ? last.result.reactions.filter((r) => r.Rz > 1e-9) : [];
    const html = reactions.length
      ? `<span>aus dem System:</span>${reactions.map((r) => `<button type="button" class="small" data-take="${Math.abs(r.Rz)}" title="Auflagerkraft als Normalkraft übernehmen">${escapeHtml(r.name)}<sub>z</sub> = ${kn(Math.abs(r.Rz))} kN</button>`).join('')}`
      : '';
    if (take.__html !== html) { take.__html = html; take.innerHTML = html; }
  }
  if (!ensureData()) {
    setResult('<p class="d-empty">Profiltabellen werden geladen …</p>');
    return;
  }
  explainOn = !!(ctx.getExplain && ctx.getExplain());
  termsSeen = new Set();
  beamLine = null;
  // Ungültige Eingabe (rot): nicht mit einem Ersatzwert weiterrechnen, sondern sagen, was fehlt
  const invalid = $('designForm').querySelector('input.invalid');
  if (invalid) {
    const label = invalid.closest('label') ? invalid.closest('label').querySelector('span').textContent : 'Ein Feld';
    setResult(`<p class="d-empty"><b class="d-warn">„${escapeHtml(label)}“ ist ungültig</b> (rot markiert). ${escapeHtml(invalid.title || 'Bitte eine gültige Zahl eingeben.')}.</p>`);
    setSteps('');
    renderBeamLine(d, last);
    return;
  }
  let out;
  if (d.tab === 'beam') out = d.beam.material === 'steel' ? steelBeamResult(d, last, decimals) : timberBeamResult(d, last, decimals);
  else out = d.column.material === 'steel' ? steelColumnResult(d, last, decimals) : timberColumnResult(d, last, decimals);
  // Oben das Ergebnis (Kopf, Nachbarprofile), der Lösungsweg steht unten in der Karte „Lösungsweg“
  const top = typeof out === 'string' ? out : out.top;
  const steps = typeof out === 'string' ? '' : out.steps;
  const what = d.tab === 'beam'
    ? `Träger in ${d.beam.material === 'steel' ? 'Stahl' : 'Holz'}`
    : `Stütze in ${d.column.material === 'steel' ? 'Stahl' : 'Holz'} (Knicken)`;
  setResult(top + (steps ? '<p class="d-to-steps"><a href="#designSteps">Lösungsweg der Bemessung unten ↓</a></p>' : ''));
  setSteps(steps ? `<h3 class="sol-part">Bemessung: ${what}</h3>${steps}` : '');
  renderBeamLine(d, last);
}

// Biegelinie unter der M-Fläche: nur mit gewähltem Träger (Reiter „Träger“) und geradem System
function renderBeamLine(d, last) {
  const box = $('deflectionDiagram');
  if (!box) return;
  const layout = ctx.getLayout ? ctx.getLayout() : null;
  const ok = d.tab === 'beam' && beamLine && layout && last && last.result && last.result.ok;
  const events = last.forces && last.forces.ok ? last.forces.events.map((e) => e.x) : [];
  const html = ok ? renderDeflection(beamLine, layout, last.result.reactions.map((s) => [s.x, s.name]), events) : '';
  if (box.__html !== html) { box.__html = html; box.innerHTML = html; }
  box.hidden = !html;
}

function setSteps(html) {
  const element = $('designSteps');
  if (!element || element.__html === html) return;
  // aufgeklappte „Warum?“-Boxen bleiben beim Neuaufbau offen
  const open = [...element.querySelectorAll('details[open] > summary')].map((s) => s.textContent);
  element.__html = html;
  element.innerHTML = html;
  element.querySelectorAll('details > summary').forEach((s) => { if (open.includes(s.textContent)) s.parentElement.open = true; });
  const part = $('staticsPart');
  if (part) part.hidden = !html;
}

function setPath(path, value) {
  const d = ctx.getDesign();
  const [group, key] = path.split('.');
  if (group === 'tab') { d.tab = value; return; }
  d[group][key] = value;
}

function readValue(element) {
  const path = element.getAttribute('data-d');
  const key = path.split('.')[1];
  if (element.type === 'checkbox') return element.checked;
  if (element.tagName === 'SELECT') {
    if (key === 'plastic') return element.value === 'true';
    if (key === 'step' && element.value === 'auto') return 'auto';
    if (['euler', 'eulerZ', 'step', 'limit'].includes(key)) return Number(element.value);
    return element.value;
  }
  const value = parseNumber(element.value);
  // M und V dürfen negativ sein, g_k und q_k null; alles andere muss grösser als 0 sein (Grenzen wie sanitizeDesign)
  const range = FIELD_RANGES[key] || [1e-9, 1e6];
  const bad = Number.isNaN(value) || (value !== null && (value < range[0] || value > range[1]));
  element.classList.toggle('invalid', bad);
  element.title = bad ? `Bitte eine Zahl von ${range[0] < 1e-6 && range[0] > 0 ? 'grösser als 0' : range[0]} bis ${range[1]} eingeben` : '';
  return !bad && Number.isFinite(value) ? value : null;
}

const FIELD_RANGES = {
  M: [-1e6, 1e6], V: [-1e6, 1e6], gamma: [0.1, 10], gk: [0, 1e4], qk: [0, 1e4], area: [1e-9, 1e6], N: [1e-9, 1e6],
  L: [0.01, 200], Lz: [0.01, 200], beta: [0.1, 10], betaZ: [0.1, 10],
  b: [20, 2000], h: [20, 4000], d: [20, 2000], lA: [10, 2000], qSpan: [1e-3, 1e5],
};

export function initDesign(context) {
  ctx = context;
  const card = $('designCard');
  $('designCheck').addEventListener('change', (event) => {
    if (ctx.setEnabled) ctx.setEnabled(event.target.checked);
    ctx.onChange();
    renderDesignForm();
    updateDesign();
  });
  card.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      setPath('tab', tab.dataset.tab);
      renderDesignForm();
      updateDesign();
      ctx.onChange();
      return;
    }
    const set = event.target.closest('[data-set]');
    if (set) {
      const raw = set.dataset.value;
      setPath(set.dataset.set, /^\d+$/.test(raw) ? Number(raw) : raw);
      renderDesignForm();
      updateDesign();
      ctx.onChange();
      return;
    }
    const takeButton = event.target.closest('[data-take]');
    if (takeButton) {
      setPath('column.N', Math.round(Number(takeButton.dataset.take) * 1000) / 1000);
      renderDesignForm();
      updateDesign();
      ctx.onChange();
      return;
    }
    const row = event.target.closest('tr[data-profile]');
    if (row) {
      const d = ctx.getDesign();
      setPath(`${d.tab}.profile`, row.dataset.profile);
      renderDesignForm();
      updateDesign();
      ctx.onChange();
    }
  });
  const form = $('designForm');
  form.addEventListener('input', (event) => {
    const element = event.target;
    if (!element.matches('input[type="text"][data-d]')) return;
    setPath(element.getAttribute('data-d'), readValue(element));
    updateDesign();
    ctx.onChange();
  });
  form.addEventListener('change', (event) => {
    const element = event.target;
    if (!element.matches('select[data-d], input[type="checkbox"][data-d]')) return;
    const path = element.getAttribute('data-d');
    setPath(path, readValue(element));
    // Neue Profilreihe: Profilwahl zurück auf automatisch
    if (path.endsWith('.family')) setPath(path.replace('family', 'profile'), '');
    renderDesignForm();
    updateDesign();
    ctx.onChange();
  });
  renderDesignForm();
}
