// StatiCulator Web – Oberfläche
import { solve, internalForces, resolveModel, axisZAt } from './statik.js';
import { renderFigure, arrowHeadPath } from './figure.js';
import { DIM_STYLE, dimSlash, dimLine } from './dimension.js';
import { renderDiagrams } from './diagrams.js';
import { renderSolution, renderMessages } from './solution.js';
import { EXAMPLES, exampleById, emptyModel } from './examples.js';
import { parseNumber, plain, escapeHtml, label, fixed, htmlName, length } from './format.js';
import { initDesign, updateDesign, renderDesignForm, sanitizeDesign, deflectionAt, deflectionBasis, deflectionMarks } from './design-ui.js';
import { enhanceSteps, anyClosed, setAllSteps, resetSteps } from './step-list.js';
import { initPhotoImport, resetImport } from './photo-import.js';
import { exportImage } from './export-image.js';
import { initSelfCheck, updateSelfCheck, clearSelfCheck } from './self-check.js';
import { shearDerivation, momentDerivation, shearAreas, deflectionDerivation } from './cursor-derive.js';

const STORAGE_KEY = 'staticulator-web-model-v1';
const DIRECTION_OPTIONS = {
  F: [['down', '↓'], ['up', '↑'], ['right', '→'], ['left', '←']],
  q: [['down', '↓'], ['up', '↑']],
};

const state = {
  model: null,
  decimals: 2,
  exampleId: '',
  view: { snap: true, snapPoints: true, grid: false, step: 0.05, angles: true, highlight: 'frame', dim: true, coords: false, scale: null, scheme: 'family', scaleMode: false, explain: false, lever: true, design: false, cursor: true, derive: false },
  guide: null,
  // Auswahl und Hover als Verweise "S:i" (Lager), "L:i" (Last), "P:i" (Achspunkt)
  selection: [],
  selectionSource: '',
  hover: null,
  last: null,
};

const TABLE_KIND = { axisTable: 'P', supportTable: 'S', loadTable: 'L' };

const $ = (id) => document.getElementById(id);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------- Laden und Speichern ----------

// Ein negativer Lastwert kehrt die Richtung um: als Betrag mit umgedrehtem Pfeil speichern,
// damit Tabelle, Skizze und Lösungsweg dasselbe zeigen (↓ −50 wird ↑ 50)
const OPPOSITE_DIR = { down: 'up', up: 'down', left: 'right', right: 'left' };
function positiveLoad(load) {
  // massgebend ist der erste Wert ungleich 0 (wie im Rechenkern): Dreieckslast 0 → −30 zeigt dann ↑ 0 → 30
  const end = typeof load.value2 === 'number' && Number.isFinite(load.value2) ? load.value2 : null;
  const lead = typeof load.value === 'number' && Number.isFinite(load.value) && load.value !== 0 ? load.value : end;
  if (typeof lead === 'number' && lead < 0) {
    // Trapezlast: der Wert am Ende kehrt mit um
    const flipped = { ...load, dir: OPPOSITE_DIR[load.dir] || load.dir };
    if (typeof load.value === 'number' && Number.isFinite(load.value)) flipped.value = load.value === 0 ? 0 : -load.value;
    if (end !== null) flipped.value2 = end === 0 ? 0 : -end;
    return flipped;
  }
  return load;
}

function encodeModel(model) {
  const json = JSON.stringify({ v: 1, model });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeModel(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  return sanitizeModel(data.model || data);
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Nimmt nur bekannte Felder mit passenden Typen an (Datei, Link, Speicher).
function sanitizeModel(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Kein gültiges Modell.');
  const axis = Array.isArray(raw.axis) ? raw.axis.slice(0, 50).map((p) => ({ x: numberOrNull(p && p.x), z: numberOrNull(p && p.z) ?? 0 })) : [];
  const supports = (Array.isArray(raw.supports) ? raw.supports : []).slice(0, 2).map((s, i) => ({
    name: i === 0 ? 'A' : 'B',
    type: s && s.type === 'rolle' ? 'rolle' : 'fest',
    x: numberOrNull(s && s.x),
    z: numberOrNull(s && s.z),
  }));
  while (supports.length < 2) supports.push({ name: supports.length === 0 ? 'A' : 'B', type: supports.length === 0 ? 'fest' : 'rolle', x: null, z: null });
  const loads = (Array.isArray(raw.loads) ? raw.loads : []).slice(0, 200).map((l) => {
    if (l && l.kind === 'q') {
      // value2: Wert am Ende einer Trapez- oder Dreieckslast (fehlt = gleichmässig)
      const value2 = numberOrNull(l.value2);
      return positiveLoad({ kind: 'q', dir: l.dir === 'up' ? 'up' : 'down', value: numberOrNull(l.value), ...(value2 !== null ? { value2 } : {}), x1: numberOrNull(l.x1), x2: numberOrNull(l.x2), name: typeof l.name === 'string' ? l.name.slice(0, 20) : '' });
    }
    const dir = ['down', 'up', 'right', 'left'].includes(l && l.dir) ? l.dir : 'down';
    return positiveLoad({ kind: 'F', dir, value: numberOrNull(l && l.value), x: numberOrNull(l && l.x), z: numberOrNull(l && l.z), name: typeof (l && l.name) === 'string' ? l.name.slice(0, 20) : '' });
  });
  return {
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    axis: axis.length >= 2 ? axis : [{ x: 0, z: 0 }, { x: 6, z: 0 }],
    supports,
    loads,
    pivot: raw.pivot === 'A' || raw.pivot === 'B' ? raw.pivot : 'B',
    design: sanitizeDesign(raw.design),
  };
}

function storeModel() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ model: state.model, decimals: state.decimals, exampleId: state.exampleId, view: state.view }));
  } catch (error) {
    // Privater Modus oder voller Speicher: Ohne Zwischenspeicher weiterarbeiten.
  }
}

// Darstellungseinstellungen aus dem Speicher (gelten auch, wenn ein geteilter Link geöffnet wird).
function restoreSettings(stored) {
  if (!stored) return;
  if (Number.isInteger(stored.decimals)) state.decimals = Math.min(5, Math.max(0, stored.decimals));
  if (stored.view && typeof stored.view === 'object') {
    const v = stored.view;
    state.view = {
      snap: v.snap !== false,
      snapPoints: v.snapPoints !== false,
      grid: v.grid === true,
      step: [0.01, 0.05, 0.1, 0.25, 0.5, 1].includes(v.step) ? v.step : 0.05,
      angles: v.angles !== false,
      highlight: HIGHLIGHTS.includes(v.highlight) ? v.highlight : (v.highlight === 'focus' ? 'none' : 'frame'),
      dim: v.dim !== false,
      coords: v.coords === true,
      scaleMode: v.scaleMode === true,
      explain: v.explain === true,
      lever: v.lever !== false,
      cursor: v.cursor !== false,
      derive: v.derive === true,
      design: v.design === true,
      scheme: ['family', 'sign', 'six'].includes(v.scheme) ? v.scheme : 'family',
      scale: v.scale && typeof v.scale === 'object' && [v.scale.length, v.scale.force, v.scale.moment].every((n) => typeof n === 'number' && n > 0)
        ? { length: v.scale.length, force: v.scale.force, moment: v.scale.moment, custom: v.scale.custom === true }
        : null,
    };
  }
}

function initialModel() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (error) {
    stored = null;
  }
  restoreSettings(stored);
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('m=')) {
    // Den Link nach dem Einlesen aus der Adresse nehmen: sonst lädt F5 später wieder den alten
    // Stand aus dem Link und überschreibt die inzwischen weitergeführte Arbeit.
    history.replaceState(null, '', location.pathname + location.search);
    try {
      return { model: decodeModel(hash.slice(2)), exampleId: '' };
    } catch (error) {
      toast('Der Link enthält kein gültiges System.');
    }
  }
  try {
    if (stored && stored.model) {
      return { model: sanitizeModel(stored.model), exampleId: typeof stored.exampleId === 'string' ? stored.exampleId : '' };
    }
  } catch (error) {
    // ignorieren
  }
  const first = EXAMPLES[0];
  return { model: sanitizeModel(clone(first.model)), exampleId: first.id };
}

// ---------- Eingabetabellen ----------

function input(field, value, attrs = '') {
  return `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-field="${field}" value="${escapeHtml(plain(value))}" ${attrs}>`;
}

function renderAxisTable() {
  const rows = state.model.axis.map((p, i) => `<tr data-index="${i}">
      <td class="label">P${i + 1}</td>
      <td><label class="cell"><span>x</span>${input('x', p.x)}</label></td>
      <td><label class="cell"><span>z</span>${input('z', p.z)}</label></td>
      <td class="tools">${state.model.axis.length > 2 ? '<button type="button" class="icon" data-action="remove-axis" title="Punkt entfernen" aria-label="Punkt entfernen">✕</button>' : ''}</td>
    </tr>`);
  $('axisTable').innerHTML = `<tbody>${rows.join('')}</tbody>`;
}

function renderSupportTable() {
  const rows = state.model.supports.map((s, i) => `<tr data-index="${i}">
      <td class="label strong">${escapeHtml(s.name)}</td>
      <td class="type"><select data-field="type" aria-label="Lagerart ${escapeHtml(s.name)}">
        <option value="fest"${s.type === 'fest' ? ' selected' : ''}>Gelenklager</option>
        <option value="rolle"${s.type === 'rolle' ? ' selected' : ''}>Rollenlager</option>
      </select></td>
      <td><label class="cell"><span>x</span>${input('x', s.x)}</label></td>
      <td><label class="cell"><span>z</span>${input('z', s.z, 'placeholder="Achse"')}</label></td>
      <td class="pivot"><label class="pivot-pick" title="Drehpunkt (DP) für die Momentensumme"><input type="radio" name="pivotPick" data-pivot="${escapeHtml(s.name)}"${state.model.pivot === s.name ? ' checked' : ''}>DP</label></td>
    </tr>`);
  $('supportTable').innerHTML = `<tbody>${rows.join('')}</tbody>`;
}

// Automatische Namen nach Position in der Liste (F1, H1, q1), wie im Rechenkern.
function autoLabels() {
  let f = 0;
  let h = 0;
  let q = 0;
  return state.model.loads.map((l) => {
    if (l.kind === 'q') { q += 1; return `q${q}`; }
    if (l.dir === 'left' || l.dir === 'right') { h += 1; return `H${h}`; }
    f += 1;
    return `F${f}`;
  });
}

// Automatische Namen ändern sich, wenn eine Last zwischen senkrecht und waagrecht wechselt:
// nur die Platzhalter nachführen, damit das gerade bediente Feld den Fokus behält.
function refreshLoadPlaceholders() {
  const auto = autoLabels();
  document.querySelectorAll('#loadTable tr[data-index] input[data-field="name"]').forEach((field) => {
    const label = auto[Number(field.closest('tr').dataset.index)] || '';
    field.placeholder = label;
    field.title = `Name wie in der Aufgabe, z. B. F_A, G oder Q_1 (Unterstrich = Index). Leer lassen = ${label}`;
  });
}

function renderLoadTable() {
  const auto = autoLabels();
  const labels = state.model.loads.map((l, i) => (l.name || '').trim() || auto[i]);
  if (!state.model.loads.length) {
    $('loadTable').innerHTML = '<tbody><tr><td class="empty">Noch keine Lasten.</td></tr></tbody>';
    return;
  }
  const rows = state.model.loads.map((l, i) => {
    const isQ = l.kind === 'q';
    const options = DIRECTION_OPTIONS[isQ ? 'q' : 'F']
      .map(([value, text]) => `<option value="${value}"${l.dir === value ? ' selected' : ''}>${text}</option>`)
      .join('');
    const position = isQ
      ? `<td><label class="cell"><span>von</span>${input('x1', l.x1)}</label></td><td><label class="cell"><span>bis</span>${input('x2', l.x2)}</label></td>`
      : `<td><label class="cell"><span>x</span>${input('x', l.x)}</label></td><td><label class="cell"><span>z</span>${input('z', l.z, 'placeholder="Achse"')}</label></td>`;
    return `<tr data-index="${i}" class="${isQ ? 'is-q' : 'is-f'}">
      <td class="label strong"><input type="text" class="name-input" data-field="name" value="${escapeHtml(l.name || '')}" placeholder="${escapeHtml(auto[i])}" maxlength="12" autocomplete="off" spellcheck="false" aria-label="Name der Last ${escapeHtml(auto[i])}" title="Name wie in der Aufgabe, z. B. F_A, G oder Q_1 (Unterstrich = Index). Leer: ${escapeHtml(auto[i])}"></td>
      <td class="dir"><select data-field="dir" title="Richtung" aria-label="Richtung ${escapeHtml(labels[i])}">${options}</select></td>
      ${isQ
    ? `<td><div class="cell q-values" title="Wert am Anfang („von“) und am Ende („bis“). Ende leer = gleichmässig, anderer Wert = Trapezlast, 0 = Dreieckslast"><span>kN/m</span>${input('value', l.value, `aria-label="Wert am Anfang von ${escapeHtml(labels[i])}"`)}<span class="q-to" aria-hidden="true">→</span>${input('value2', l.value2, `placeholder="=" aria-label="Wert am Ende von ${escapeHtml(labels[i])} (leer = gleichmässig)"`)}</div></td>`
    : `<td><label class="cell"><span>kN</span>${input('value', l.value)}</label></td>`}
      ${position}
      <td class="tools"><button type="button" class="icon" data-action="remove-load" title="Last entfernen" aria-label="Last ${escapeHtml(labels[i])} entfernen">✕</button></td>
    </tr>`;
  });
  $('loadTable').innerHTML = `<tbody>${rows.join('')}</tbody>`;
}

function renderPivotSelect() {
  $('pivotSelect').innerHTML = state.model.supports
    .map((s) => `<option value="${escapeHtml(s.name)}"${state.model.pivot === s.name ? ' selected' : ''}>Lager ${escapeHtml(s.name)}</option>`)
    .join('');
}

// Drehpunkt wechseln: aus der Lagertabelle (DP), der Skizze (Legende), dem Lösungsweg oder „Darstellung“.
function setPivot(name) {
  if (!state.model.supports.some((s) => s.name === name) || state.model.pivot === name) return;
  state.model.pivot = name;
  renderPivotSelect();
  document.querySelectorAll('input[data-pivot]').forEach((radio) => { radio.checked = radio.dataset.pivot === name; });
  scheduleUpdate();
}

function togglePivot() {
  const other = state.model.supports.find((s) => s.name !== state.model.pivot);
  if (other) setPivot(other.name);
}

function renderInputs() {
  $('titleInput').value = state.model.title || '';
  renderAxisTable();
  renderSupportTable();
  renderLoadTable();
  renderPivotSelect();
  $('decimalsSelect').value = String(state.decimals);
  $('exampleSelect').value = state.exampleId || '';
  renderDesignForm();
}

// ---------- Berechnen und Darstellen ----------

// Setzt HTML nur, wenn es sich geändert hat: spart Seitenaufbau, z. B. wenn beim Ziehen
// ein eingerastetes Element an derselben Stelle bleibt.
function setHtml(element, html) {
  if (element.__html === html) return;
  element.__html = html;
  element.innerHTML = html;
}

function update() {
  const model = state.model;
  const result = solve(model);
  const resolved = result.resolved || resolveModel(model);
  const forces = result.ok ? internalForces(result) : null;
  state.last = { result, resolved, forces };
  // Cursor und Herleitung gehören zur alten Rechnung (Eingabe, Rückgängig, Pfeiltasten ohne Mausbewegung)
  hideDiagramCursor();
  drawFigure();

  if (forces && forces.ok) {
    setHtml($('diagrams'), renderDiagrams(forces, state.layout, result, state.decimals));
    $('diagramCard').hidden = false;
  } else {
    setHtml($('diagrams'), '');
    $('diagramCard').hidden = true;
  }

  // Beim Ziehen nur Skizze und Diagramme nachführen (je unter 1 ms). Der Lösungsweg mit KaTeX
  // kostet rund 10 ms und folgt beim Loslassen, ebenso das Speichern.
  if (drag) return;
  // Aufgeklappte Abschnitte (z. B. „Glieder der Momentensumme“) bleiben nach dem Neuaufbau offen
  const openSections = [...$('solution').querySelectorAll('details[open] > summary')].map((s) => s.textContent);
  setHtml($('solution'), renderSolution(result, forces, state.decimals, { explain: state.view.explain }));
  $('solution').querySelectorAll('details > summary').forEach((s) => { if (openSections.includes(s.textContent)) s.parentElement.open = true; });
  // Übersicht: pro Schritt Titel und Ergebnis, die Rechnung zum Aufklappen
  enhanceSteps($('solution'), { explain: state.view.explain, changed: updateStepsToggle });
  setHtml($('messages'), renderMessages(result));
  const example = exampleById(state.exampleId);
  const title = (model.title || '').trim();
  setHtml($('taskTitle'), title
    ? `<strong>${escapeHtml(title)}</strong>${example && example.title === title ? `<span>${escapeHtml(example.source)}</span>` : ''}`
    : '<strong>Eigenes System</strong>');
  setHtml($('summary'), result.ok ? '' : `<div class="sol-error">${escapeHtml(result.error)}</div>`);
  showInputIssues(checkInputs(model));
  renderScaleCard();
  updateDesign();
  updateSelfCheck();
  storeModel();
  recordHistory();
}

// Knopf „Alle aufklappen / Alle zuklappen“ im Kopf des Lösungswegs
function updateStepsToggle() {
  const button = $('stepsToggle');
  if (!button) return;
  button.hidden = !document.querySelector('section.sol-step.sol-acc:not(.sol-flat)');
  button.textContent = anyClosed() ? 'Alle aufklappen' : 'Alle zuklappen';
}

// ---------- Rückgängig / Wiederholen ----------
// Nach jeder vollständigen Neuberechnung wird das System mit dem letzten Stand verglichen. Tippen im selben
// Feld und gehaltene Pfeiltasten werden zu einem Schritt zusammengefasst; beim Ziehen zählt erst das Loslassen.
// Die Einstellungen der Bemessung gehören nicht dazu (sie bleiben beim Rückgängigmachen, wie sie sind).
const HISTORY_LIMIT = 100;
const HISTORY_SAME_KEY_MS = 4000; // gleiches Feld: so lange zählt weiteres Tippen zum selben Schritt
const HISTORY_BURST_MS = 250; // sehr schnelle Folgen (Tastenwiederholung) immer zusammen
const undoHistory = { undo: [], redo: [], current: null, lastChange: 0, lastKey: null };
let historyKey = null; // Herkunft der nächsten Änderung (Feld, Pfeiltasten), gesetzt von den Eingaben

function modelSnapshot() {
  const { design, ...system } = state.model;
  return JSON.stringify({ model: system, exampleId: state.exampleId });
}

function recordHistory() {
  const now = modelSnapshot();
  const key = historyKey;
  historyKey = null;
  if (undoHistory.current === null) {
    undoHistory.current = now;
    updateHistoryButtons();
    return;
  }
  if (now === undoHistory.current) return;
  const time = Date.now();
  const since = time - undoHistory.lastChange;
  const merge = since < HISTORY_BURST_MS || (key !== null && key === undoHistory.lastKey && since < HISTORY_SAME_KEY_MS);
  if (!merge) {
    undoHistory.undo.push(undoHistory.current);
    if (undoHistory.undo.length > HISTORY_LIMIT) undoHistory.undo.shift();
  }
  undoHistory.lastChange = time;
  undoHistory.lastKey = key;
  undoHistory.redo = [];
  undoHistory.current = now;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undoButton').disabled = !undoHistory.undo.length;
  $('redoButton').disabled = !undoHistory.redo.length;
}

// back = true: rückgängig, sonst wiederholen
function stepHistory(back) {
  const from = back ? undoHistory.undo : undoHistory.redo;
  const to = back ? undoHistory.redo : undoHistory.undo;
  if (!from.length || drag) return;
  to.push(undoHistory.current);
  const snapshot = JSON.parse(from.pop());
  state.model = sanitizeModel({ ...snapshot.model, design: state.model.design });
  resetSteps();
  state.exampleId = snapshot.exampleId && exampleById(snapshot.exampleId) ? snapshot.exampleId : '';
  undoHistory.current = modelSnapshot();
  undoHistory.lastChange = 0;
  clearSelection();
  $('exampleSelect').value = state.exampleId;
  renderInputs();
  update();
  updateHistoryButtons();
  toast(back ? 'Rückgängig gemacht' : 'Wiederholt');
}

// ---------- Eingabeprüfung ----------
// Hinweise mit Zielfeld: Fehler (rot) verhindern die Rechnung oder machen sie falsch,
// Warnungen (orange) sind Annahmen, die man prüfen sollte. Ein Hinweis ohne Text markiert
// nur ein weiteres beteiligtes Feld.

const ISSUE_TABLES = { axis: 'axisTable', support: 'supportTable', load: 'loadTable' };

function checkInputs(model) {
  const issues = [];
  const add = (level, table, index, field, text) => issues.push({ level, table, index, field, text });
  const num = (value) => typeof value === 'number' && Number.isFinite(value);
  const missing = (value) => (Number.isNaN(value) ? 'ist keine gültige Zahl' : 'fehlt');
  const axisXs = model.axis.map((p) => p.x).filter(num);
  const xmin = axisXs.length ? Math.min(...axisXs) : 0;
  const xmax = axisXs.length ? Math.max(...axisXs) : 0;
  const onAxis = (x) => axisXs.length >= 2 && x >= xmin - 1e-9 && x <= xmax + 1e-9;

  // Trägerachse
  model.axis.forEach((p, i) => {
    if (!num(p.x)) add('error', 'axis', i, 'x', `P${i + 1}: x ${missing(p.x)}.`);
    if (!num(p.z)) add('error', 'axis', i, 'z', `P${i + 1}: z ${missing(p.z)}.`);
  });
  if (axisXs.length >= 2 && xmax - xmin < 1e-9) {
    add('error', 'axis', 0, 'x', 'Die Achse hat keine Länge: alle Punkte haben dasselbe x.');
    model.axis.forEach((p, i) => { if (i > 0) add('error', 'axis', i, 'x', null); });
  }

  // Lager
  model.supports.forEach((s, i) => {
    if (!num(s.x)) add('error', 'support', i, 'x', `Lager ${s.name}: x ${missing(s.x)}.`);
    else if (!onAxis(s.x)) add('warn', 'support', i, 'x', `Lager ${s.name} liegt ausserhalb der Trägerachse (${plain(xmin)} bis ${plain(xmax)} m).`);
    if (Number.isNaN(s.z)) add('error', 'support', i, 'z', `Lager ${s.name}: z ist keine gültige Zahl.`);
  });
  const [a, b] = model.supports;
  if (a && b && num(a.x) && num(b.x) && Math.abs(a.x - b.x) < 1e-9) {
    add('error', 'support', 0, 'x', 'A und B liegen senkrecht übereinander: Die vertikalen Reaktionen lassen sich so nicht bestimmen. Die Lager brauchen verschiedene x.');
    add('error', 'support', 1, 'x', null);
  }

  // Horizontalkräfte und Lagerarten
  const horizontal = model.loads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.kind !== 'q' && (l.dir === 'left' || l.dir === 'right') && num(l.value) && Math.abs(l.value) > 0 && num(l.x));
  const sumH = horizontal.reduce((sum, { l }) => sum + (l.dir === 'right' ? l.value : -l.value), 0);
  const fixed = model.supports.filter((s) => s.type === 'fest').length;
  if (fixed === 0 && Math.abs(sumH) > 1e-9) {
    add('error', 'support', 0, 'type', `Kein Gelenklager, aber Horizontalkräfte (ΣH = ${plain(Math.round(sumH * 1000) / 1000)} kN): Ein Rollenlager nimmt nur senkrechte Kräfte auf. Ein Lager muss ein Gelenklager sein.`);
    add('error', 'support', 1, 'type', null);
    horizontal.forEach(({ i }) => add('error', 'load', i, 'dir', null));
  } else if (fixed === 0) {
    add('warn', 'support', 0, 'type', 'Zwei Rollenlager: Das System ist horizontal verschieblich (labil). Üblich ist ein Gelenklager und ein Rollenlager.');
    add('warn', 'support', 1, 'type', null);
  } else if (fixed === 2 && horizontal.length) {
    add('warn', 'support', 0, 'type', 'Zwei Gelenklager mit Horizontalkraft: horizontal statisch unbestimmt. Die Horizontalkraft wird vereinfachend ganz einem Lager zugewiesen.');
    add('warn', 'support', 1, 'type', null);
  }

  // Lasten
  const auto = autoLabels();
  model.loads.forEach((l, i) => {
    const name = (l.name || '').trim() || auto[i];
    // Trapez-/Dreieckslast: Wert am Ende (leer = gleichmässig); 0 am Anfang ist dann eine Dreieckslast
    const hasEnd = l.kind === 'q' && l.value2 !== null && l.value2 !== undefined;
    if (hasEnd && !num(l.value2)) add('error', 'load', i, 'value2', `${name}: Wert am Ende ist keine Zahl (leer lassen = gleichmässig).`);
    else if (hasEnd && num(l.value) && l.value * l.value2 < 0) add('warn', 'load', i, 'value2', `${name}: Anfang und Ende zeigen in verschiedene Richtungen; gerechnet wird mit den Beträgen. Für eine Last, die das Vorzeichen wechselt, zwei Streckenlasten eingeben.`);
    if (!num(l.value)) add('error', 'load', i, 'value', `${name}: Wert ${missing(l.value)}.`);
    else if (l.value === 0 && !(hasEnd && num(l.value2) && l.value2 !== 0)) add('warn', 'load', i, 'value', `${name}: Der Wert ist 0, die Last wirkt nicht.`);
    if (l.kind === 'q') {
      if (!num(l.x1)) add('error', 'load', i, 'x1', `${name}: Anfang („von“) ${missing(l.x1)}.`);
      if (!num(l.x2)) add('error', 'load', i, 'x2', `${name}: Ende („bis“) ${missing(l.x2)}.`);
      if (num(l.x1) && num(l.x2)) {
        if (Math.abs(l.x1 - l.x2) < 1e-9) {
          add('warn', 'load', i, 'x2', `${name}: Die Streckenlast hat keine Länge und wirkt nicht.`);
        } else {
          if (!onAxis(l.x1)) add('warn', 'load', i, 'x1', `${name} beginnt ausserhalb der Trägerachse.`);
          if (!onAxis(l.x2)) add('warn', 'load', i, 'x2', `${name} endet ausserhalb der Trägerachse.`);
        }
      }
    } else {
      if (!num(l.x)) add('error', 'load', i, 'x', `${name}: x ${missing(l.x)}.`);
      else if (!onAxis(l.x)) add('warn', 'load', i, 'x', `${name} liegt ausserhalb der Trägerachse (${plain(xmin)} bis ${plain(xmax)} m).`);
      if (Number.isNaN(l.z)) add('error', 'load', i, 'z', `${name}: z ist keine gültige Zahl.`);
    }
  });
  return issues;
}

// Markiert die betroffenen Felder (rot/orange, Tooltip) und listet die Meldungen unter der Tabelle.
function showInputIssues(issues) {
  document.querySelectorAll('.inputs [data-field].invalid, .inputs [data-field].warn').forEach((field) => {
    field.classList.remove('invalid', 'warn');
    if (field.dataset.baseTitle !== undefined) field.title = field.dataset.baseTitle;
  });
  document.querySelectorAll('.inputs tr.has-error, .inputs tr.has-warn').forEach((row) => row.classList.remove('has-error', 'has-warn'));
  for (const issue of issues) {
    const row = document.querySelector(`#${ISSUE_TABLES[issue.table]} tr[data-index="${issue.index}"]`);
    const field = row && row.querySelector(`[data-field="${issue.field}"]`);
    if (!field) continue;
    const error = issue.level === 'error';
    if (error) field.classList.remove('warn');
    if (error || !field.classList.contains('invalid')) field.classList.add(error ? 'invalid' : 'warn');
    row.classList.add(error ? 'has-error' : 'has-warn');
    if (field.dataset.baseTitle === undefined) field.dataset.baseTitle = field.title || '';
    if (issue.text) field.title = issue.text;
  }
  document.querySelectorAll('.inputs tr.has-error.has-warn').forEach((row) => row.classList.remove('has-warn'));
  for (const [table, listId] of [['axis', 'axisIssues'], ['support', 'supportIssues'], ['load', 'loadIssues']]) {
    const items = issues
      .filter((issue) => issue.table === table && issue.text)
      .map((issue) => `<li class="${issue.level}"><button type="button" data-goto="${table}:${issue.index}:${issue.field}">${escapeHtml(issue.text)}</button></li>`);
    setHtml($(listId), items.join(''));
  }
}

// Klick auf eine Meldung: zum Feld springen und es auswählen
function gotoIssue(target) {
  const [table, index, field] = target.split(':');
  const element = document.querySelector(`#${ISSUE_TABLES[table]} tr[data-index="${index}"] [data-field="${field}"]`);
  if (!element) return;
  element.focus();
  if (typeof element.select === 'function') element.select();
}

// Zeichenbreite = tatsächliche Breite der Karte in CSS-Pixeln: Linien und Schrift erscheinen
// 1:1 (nicht hochskaliert), Haarlinien bleiben scharf. Sehr schmale Ansichten verkleinern.
function figureWidth() {
  const box = $('figure');
  const style = getComputedStyle(box);
  const inner = box.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
  return Math.round(Math.min(1600, Math.max(440, inner || 1000)));
}

// Nur die Skizze neu zeichnen (Auswahl, Raster, Winkel): Rechnung und Lösungsweg bleiben.
function drawFigure() {
  if (!state.last) return;
  const figure = renderFigure(state.last.result, state.last.resolved, {
    width: figureWidth(),
    decimals: state.decimals,
    grid: { show: state.view.grid, step: state.view.step },
    showAngles: state.view.angles,
    guide: drag ? state.guide : null,
    focus: state.selection,
    layout: drag ? drag.layout : null,
    paper: state.view.scaleMode ? currentScales() : null,
    top: drag ? drag.top : null,
  });
  const previousViewTop = state.viewTop || 0;
  setHtml($('figure'), figure.svg);
  state.layout = figure.layout;
  state.top = figure.top;
  state.viewTop = figure.viewTop;
  state.figureDims = { dimY: figure.dimY, lowestAt: figure.lowestAt };
  const svg = $('figure').querySelector('svg');
  if (drag && svg) {
    svg.classList.add('dragging');
    // Fläche ist oben gewachsen (oder wieder geschrumpft): Seite um denselben Betrag verschieben,
    // damit die Zeichnung am Platz bleibt und das gezogene Element unter dem Zeiger.
    const shift = previousViewTop - figure.viewTop;
    if (Math.abs(shift) > 0.01) window.scrollBy(0, shift * (svg.getBoundingClientRect().width / figure.layout.width));
  }
  applyHighlight();
  // Schatten der alten Lage (gestrichelt) unter allen Formen, solange gezogen wird
  if (drag && drag.moved && drag.ghost && svg && !svg.querySelector(':scope > .drag-ghost')) {
    const ghost = document.createElementNS(SVG_NS, 'g');
    ghost.setAttribute('class', 'drag-ghost');
    ghost.innerHTML = drag.ghost;
    const anchor = svg.querySelector(':scope > .hl-layer') || svg.querySelector(':scope > .hit-layer') || svg.querySelector(':scope > defs');
    if (anchor) anchor.after(ghost);
    else svg.prepend(ghost);
  }
  drawSelectionLever();
  renderCursorLayer();
}

let pending = 0;
let pendingFull = false;
function queueRender(full) {
  if (full) pendingFull = true;
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const doFull = pendingFull || !state.last;
    pendingFull = false;
    if (doFull) update();
    else drawFigure();
  });
}
function scheduleUpdate() {
  queueRender(true);
}
function scheduleFigure() {
  queueRender(false);
}

// ---------- Auswahl und Markierung ----------

function rowRef(row) {
  const table = row && row.closest('table');
  const kind = table && TABLE_KIND[table.id];
  return kind ? `${kind}:${row.dataset.index}` : null;
}

function findRow(ref) {
  const [kind, index] = String(ref).split(':');
  const id = Object.keys(TABLE_KIND).find((key) => TABLE_KIND[key] === kind);
  return id ? document.querySelector(`#${id} tr[data-index="${index}"]`) : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HIGHLIGHTS = ['frame', 'color', 'glow', 'none'];

// Ein Achsabschnitt ("A:i") steht für seine beiden Endpunkte: die werden mit markiert und
// zeigen ihre Griffe zum Ziehen.
function expandRefs(refs) {
  const out = new Set(refs.filter(Boolean));
  for (const ref of refs) {
    if (!ref || !ref.startsWith('A:')) continue;
    const element = $('figure').querySelector(`[data-ref="${ref}"]`);
    const ends = element && element.getAttribute('data-ends');
    if (ends) ends.split(',').forEach((end) => out.add(end));
  }
  return out;
}

// Umgebendes Rechteck aller Teile eines Elements (Form, Pfeile, Beschriftungen).
function refBox(svg, ref) {
  let box = null;
  svg.querySelectorAll(`[data-ref="${ref}"]`).forEach((element) => {
    const b = element.getBBox();
    if (!b.width && !b.height) return;
    box = box
      ? { x1: Math.min(box.x1, b.x), y1: Math.min(box.y1, b.y), x2: Math.max(box.x2, b.x + b.width), y2: Math.max(box.y2, b.y + b.height) }
      : { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
  });
  return box;
}

// Ziehschlüssel (data-drag) zu einem Element: Lager, Achspunkt, Einzel- oder Streckenlast.
function dragKey(ref) {
  const [kind, index] = String(ref).split(':');
  if (kind === 'S' || kind === 'P') return ref;
  if (kind === 'A') {
    const element = $('figure').querySelector(`[data-ref="${ref}"]`);
    const ends = element ? (element.getAttribute('data-ends') || '').split(',').map((e) => e.split(':')[1]) : [];
    return ends.length === 2 ? `Am:${ends[0]}:${ends[1]}` : null;
  }
  if (kind !== 'L') return null;
  const load = state.model.loads[Number(index)];
  if (!load) return null;
  return `${load.kind === 'q' ? 'q' : 'F'}:${index}`;
}

// Unsichtbare Griffflächen unter gewählten Elementen: Wer irgendwo in den Auswahlrahmen greift,
// zieht das Element. Sie liegen unter den Formen, damit andere Elemente anwählbar bleiben.
function drawSelectionHits(svg) {
  const old = svg.querySelector('.hit-layer');
  if (old) old.remove();
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'hit-layer');
  for (const ref of state.selection) {
    if (!dragKey(ref)) continue;
    const box = refBox(svg, ref);
    if (!box) continue;
    const rect = document.createElementNS(SVG_NS, 'rect');
    const pad = 4;
    Object.entries({ x: box.x1 - pad, y: box.y1 - pad, width: box.x2 - box.x1 + 2 * pad, height: box.y2 - box.y1 + 2 * pad, fill: 'transparent', class: 'sel-hit', 'data-hit-ref': ref })
      .forEach(([key, value]) => rect.setAttribute(key, String(value)));
    layer.appendChild(rect);
  }
  const anchor = svg.querySelector(':scope > g.grid') || svg.querySelector(':scope > defs');
  if (anchor) anchor.after(layer);
  else svg.prepend(layer);
}

// Variante „Rahmen“: gestrichelter Auswahlrahmen mit Eckpunkten um alle Teile des Elements.
function drawFrames(svg) {
  const old = svg.querySelector('.hl-layer');
  if (old) old.remove();
  if (state.view.highlight !== 'frame') return;
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'hl-layer');
  const shape = (tag, attrs) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    layer.appendChild(element);
  };
  const frame = (ref, selected) => {
    const box = refBox(svg, ref);
    if (!box) return;
    const pad = 4;
    const x = Math.round(box.x1 - pad) + 0.5;
    const y = Math.round(box.y1 - pad) + 0.5;
    const w = Math.round(box.x2 - box.x1 + 2 * pad);
    const h = Math.round(box.y2 - box.y1 + 2 * pad);
    shape('rect', { x, y, width: w, height: h, rx: 3, class: selected ? 'hl-frame-sel' : 'hl-frame-hover' });
  };
  state.selection.forEach((ref) => frame(ref, true));
  if (state.hover && !state.selection.includes(state.hover)) frame(state.hover, false);
  // Hinter Formen und Beschriftungen legen: der weisse Rand der Schrift deckt die Rahmenlinie ab,
  // so überdeckt der Rahmen nie Text. Direkt über Raster und Griffflächen.
  const anchor = svg.querySelector(':scope > .hit-layer') || svg.querySelector(':scope > g.grid') || svg.querySelector(':scope > defs');
  if (anchor) anchor.after(layer);
  else svg.prepend(layer);
}

// Markiert Hover und Auswahl in der Skizze und in den Eingabetabellen.
function applyHighlight() {
  const figure = $('figure');
  const selected = expandRefs(state.selection);
  const hovered = state.hover ? expandRefs([state.hover]) : new Set();
  figure.dataset.hl = state.view.highlight;
  figure.dataset.dim = state.view.dim ? '1' : '0';
  figure.querySelectorAll('[data-ref]').forEach((element) => {
    const ref = element.getAttribute('data-ref');
    element.classList.toggle('hl-sel', selected.has(ref));
    element.classList.toggle('hl-hover', hovered.has(ref) && !selected.has(ref));
  });
  const svg = figure.querySelector('svg');
  if (svg) {
    svg.classList.toggle('has-sel', selected.size > 0);
    // Abblenden beim Überfahren nur von der Tabelle aus; in der Skizze selbst würde es beim Bewegen flackern
    svg.classList.toggle('has-hover', hovered.size > 0 && state.hoverSource === 'table');
    drawSelectionHits(svg);
    drawFrames(svg);
  }
  document.querySelectorAll('.inputs tr[data-index]').forEach((row) => {
    const ref = rowRef(row);
    row.classList.toggle('row-sel', selected.has(ref));
    row.classList.toggle('row-hover', hovered.has(ref));
  });
  // Platz bleibt immer reserviert, damit die Skizze beim Anwählen nicht springt
  $('selectionHint').classList.toggle('is-hidden', !state.selection.length);
}

function setHover(ref, source = 'figure') {
  if (ref === state.hover && source === state.hoverSource) return;
  state.hover = ref;
  state.hoverSource = ref ? source : '';
  applyHighlight();
}

// Neue Auswahl: die Skizze wird neu gezeichnet, weil sich die Vermassung danach richtet.
function setSelection(list, source) {
  const next = [...new Set(list.filter(Boolean))];
  state.selectionSource = next.length ? source : '';
  if (next.length === state.selection.length && next.every((ref, i) => ref === state.selection[i])) return;
  state.selection = next;
  scheduleFigure();
}

function clearSelection() {
  state.selection = [];
  state.selectionSource = '';
  state.hover = null;
}

// Zeigt die Tabellenzeile zur Auswahl in der Eingabespalte, ohne die Seite zu verschieben.
function revealRow(ref) {
  const row = findRow(ref);
  const box = document.querySelector('.inputs');
  if (!row || !box || box.scrollHeight <= box.clientHeight + 1) return;
  const rowBox = row.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  if (rowBox.top < view.top) box.scrollTop -= view.top - rowBox.top + 10;
  else if (rowBox.bottom > view.bottom) box.scrollTop += rowBox.bottom - view.bottom + 10;
}

function figurePointerDown(event) {
  if (event.button !== 0) return;
  // Blaues Mass: wird beim Klick bearbeitet (click-Handler), Auswahl bleibt bestehen
  const dim = event.target.closest('[data-dim]');
  if (dim && (dim.dataset.a || dim.dataset.b)) return;
  // Legende „Drehpunkt (DP): Lager …“ wechselt den Drehpunkt
  if (event.target.closest('[data-pivot-toggle]')) {
    togglePivot();
    event.preventDefault();
    return;
  }
  // Treffer auf ein Element, sonst auf die Grifffläche (Auswahlrahmen) eines gewählten Elements
  const target = event.target.closest('[data-ref]');
  const hit = event.target.closest('[data-hit-ref]');
  const ref = target ? target.getAttribute('data-ref') : hit ? hit.getAttribute('data-hit-ref') : null;
  const multi = event.ctrlKey || event.metaKey;
  if (multi) {
    if (ref) setSelection(state.selection.includes(ref) ? state.selection.filter((item) => item !== ref) : [...state.selection, ref], 'figure');
  } else if (!ref) {
    setSelection([], 'figure');
  } else if (!state.selection.includes(ref) && !expandRefs(state.selection).has(ref)) {
    setSelection([ref], 'figure');
  } else {
    // gehört zur Auswahl (z. B. Endecke eines gewählten Abschnitts): Auswahl bleibt, damit Griffe und Spur bleiben
    state.selectionSource = 'figure';
  }
  if (ref) revealRow(ref);
  // Ziehen am Element selbst, an seiner Beschriftung oder irgendwo in seinem Auswahlrahmen
  const handle = event.target.closest('[data-drag]');
  startDrag(event, handle ? handle.dataset.drag : ref && !multi ? dragKey(ref) : null);
}

// ---------- Ziehen mit der Maus ----------

let drag = null;

function axisXRange() {
  const xs = state.model.axis.map((p) => p.x).filter((x) => Number.isFinite(x));
  if (!xs.length) return { min: -Infinity, max: Infinity };
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Ziehschlüssel: S/F/q/q1/q2/P wie bisher, dazu die Griffe am gewählten Stab:
// Sn/Fn = Endgriff (Lager- bzw. Lastpunkt am Ende von Stütze, Hänger, Stiel), Sm/Fm = Mittelgriff
// (Stab waagrecht verschieben), Am:a:b = Mittelgriff eines Achsabschnitts (ganzen Abschnitt verschieben).
function axisPointsValid() {
  return state.model.axis.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

function axisZModel(x) {
  return axisZAt(axisPointsValid(), x);
}

// Lager und Lasten, die an Achsknoten hängen (between: auch dazwischen, beim Verschieben eines
// ganzen Abschnitts). Sie wandern mit; ein Lager an einer Stütze behält seine Stützenlänge.
function attachedTo(nodeIndices, between) {
  const xs = nodeIndices.map((i) => state.model.axis[i] && state.model.axis[i].x).filter(Number.isFinite);
  if (!xs.length) return { supports: [], loads: [] };
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const hit = (x) => Number.isFinite(x) && (between ? x >= lo - 1e-6 && x <= hi + 1e-6 : xs.some((v) => Math.abs(v - x) < 1e-6));
  return {
    supports: state.model.supports.map((s, i) => ({ i, x: s.x, z: s.z })).filter((s) => hit(s.x)),
    loads: state.model.loads.map((l, i) => ({ i, x: l.x, z: l.z, x1: l.x1, x2: l.x2 }))
      .filter((l) => (state.model.loads[l.i].kind === 'q' ? hit(l.x1) || hit(l.x2) : hit(l.x))),
    hit,
  };
}

function moveAttached(attached, deltaX, deltaZ) {
  if (!attached) return;
  for (const s of attached.supports) {
    const support = state.model.supports[s.i];
    support.x = roundMm(s.x + deltaX);
    if (Number.isFinite(s.z)) support.z = roundMm(s.z + deltaZ);
  }
  for (const l of attached.loads) {
    const load = state.model.loads[l.i];
    if (load.kind === 'q') {
      if (attached.hit(l.x1)) load.x1 = roundMm(l.x1 + deltaX);
      if (attached.hit(l.x2)) load.x2 = roundMm(l.x2 + deltaX);
    } else {
      load.x = roundMm(l.x + deltaX);
      if (Number.isFinite(l.z)) load.z = roundMm(l.z + deltaZ);
    }
  }
}

// Anderes Ende eines gewählten Achsabschnitts, an dem der Achspunkt index hängt (für die Spurführung)
function selectedSegmentOther(index) {
  const svg = $('figure').querySelector('svg');
  for (const ref of state.selection) {
    if (!ref.startsWith('A:') || !svg) continue;
    const element = svg.querySelector(`[data-ref="${ref}"]`);
    const ends = element ? (element.getAttribute('data-ends') || '').split(',').map((e) => Number(e.split(':')[1])) : [];
    if (ends.length === 2 && ends.includes(index)) return ends[0] === index ? ends[1] : ends[0];
  }
  return null;
}

// Schatten der alten Lage: Kopie der gewählten Formen (ohne Beschriftungen und Griffe), gestrichelt
function captureGhost(refs) {
  const svg = $('figure').querySelector('svg');
  if (!svg) return '';
  const wanted = expandRefs(refs);
  const parts = [];
  svg.querySelectorAll('[data-ref]').forEach((element) => {
    if (!wanted.has(element.getAttribute('data-ref'))) return;
    if (element.matches('.lbl, .vertex, .grip-node, .grip-mid, .edge')) return;
    parts.push(element.outerHTML);
  });
  return parts.join('').replace(/ data-(ref|drag|ends)="[^"]*"/g, '').replace(/ class="[^"]*"/g, '');
}

function startDrag(event, key) {
  if (!key || event.button !== 0 || !state.layout) return;
  const [kind, indexText, extraText] = key.split(':');
  const index = Number(indexText);
  const svg = $('figure').querySelector('svg');
  if (!svg) return;
  let item;
  if (kind === 'S' || kind === 'Sn' || kind === 'Sm') item = state.model.supports[index];
  else if (kind === 'P' || kind === 'Am') item = state.model.axis[index];
  else item = state.model.loads[index];
  if (!item) return;
  // Streckenlast mit „von > bis“: erst ordnen, sonst passen die Griffe (links = von) nicht zum Modell
  if (item.kind === 'q' && Number.isFinite(item.x1) && Number.isFinite(item.x2) && item.x1 > item.x2) {
    [item.x1, item.x2] = [item.x2, item.x1];
    // Trapezlast: die Werte gehören zu ihren Enden und wandern mit (sonst wäre die Last gespiegelt)
    if (Number.isFinite(item.value2)) {
      [item.value, item.value2] = [item.value2, item.value];
      Object.assign(item, positiveLoad(item));
    }
  }
  const ghostRefs = state.selection.length ? state.selection : [];
  drag = {
    kind,
    index,
    // Massstab und Lage der Skizze bleiben beim Ziehen fest, damit der Punkt dem Zeiger folgt
    layout: state.layout,
    top: state.top,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    unitsPerPixel: state.layout.width / svg.getBoundingClientRect().width,
    scale: state.layout.scale,
    start: clone(item),
    snapshot: clone(state.model),
    ghost: captureGhost(ghostRefs),
    moved: false,
  };
  // Endgriff von Stütze, Hänger oder Stiel: Knoten am Stabende, Spur entlang der (senkrechten) Stabachse
  if (kind === 'Sn' || kind === 'Fn') {
    const axisZ = axisZModel(item.x);
    const z0 = Number.isFinite(item.z) ? item.z : axisZ;
    if (Number.isFinite(axisZ) && Number.isFinite(z0)) {
      const dir = Math.abs(z0 - axisZ) > 1e-9 ? Math.sign(z0 - axisZ) : -1;
      drag.node = { x: item.x, z: z0 };
      drag.track = { fx: item.x, fz: axisZ, ux: 0, uz: dir, length: Math.abs(z0 - axisZ) };
    }
  }
  // Achsecke: hängt sie an einem gewählten Abschnitt, Spur entlang dieses Abschnitts (Länge ändern)
  if (kind === 'P') {
    drag.node = { x: item.x, z: item.z };
    const other = selectedSegmentOther(index);
    const fixed = other !== null ? state.model.axis[other] : null;
    if (fixed && Number.isFinite(fixed.x) && Number.isFinite(fixed.z)) {
      const length = Math.hypot(item.x - fixed.x, item.z - fixed.z);
      if (length > 1e-9) drag.track = { fx: fixed.x, fz: fixed.z, ux: (item.x - fixed.x) / length, uz: (item.z - fixed.z) / length, length };
    }
    drag.attached = attachedTo([index], false);
  }
  // Ganzer Achsabschnitt: beide Knoten samt allem, was darauf steht
  if (kind === 'Am') {
    drag.extra = Number(extraText);
    const other = state.model.axis[drag.extra];
    if (!other) { drag = null; return; }
    drag.nodes = [{ i: index, x: item.x, z: item.z }, { i: drag.extra, x: other.x, z: other.z }];
    drag.attached = attachedTo([index, drag.extra], true);
  }
  try {
    $('figure').setPointerCapture(event.pointerId);
  } catch (error) {
    // ohne Capture weiterziehen (z. B. synthetische Ereignisse)
  }
  svg.classList.add('dragging');
  event.preventDefault();
}

const SNAP_PIXELS = 9;

function roundMm(value) {
  return Math.round(value * 1000) / 1000;
}

function snapToGrid(value) {
  const step = state.view.step;
  return roundMm(Math.round(value / step) * step);
}

// Was gerade gezogen wird, rastet nicht an sich selbst ein.
function dragExcludes(target) {
  const supports = ['S', 'Sn', 'Sm'].includes(target.kind) ? [target.index] : [];
  const loads = ['F', 'Fn', 'Fm', 'q', 'q1', 'q2'].includes(target.kind) ? [target.index] : [];
  const axis = target.kind === 'P' ? [target.index] : target.kind === 'Am' ? [target.index, target.extra] : [];
  if (target.attached) {
    target.attached.supports.forEach((s) => supports.push(s.i));
    target.attached.loads.forEach((l) => loads.push(l.i));
  }
  return { supports, loads, axis };
}

// x-Stellen, an denen ein gezogenes Element einrasten kann (ohne das Element selbst).
function snapTargetsX(exclude) {
  const ex = dragExcludes(exclude);
  const xs = [];
  const add = (x) => { if (Number.isFinite(x)) xs.push(x); };
  state.model.axis.forEach((p, i) => { if (!ex.axis.includes(i)) add(p.x); });
  state.model.supports.forEach((s, i) => { if (!ex.supports.includes(i)) add(s.x); });
  state.model.loads.forEach((l, i) => {
    if (ex.loads.includes(i)) return;
    if (l.kind === 'q') { add(l.x1); add(l.x2); } else add(l.x);
  });
  return xs;
}

function snapTargetsZ(exclude) {
  const ex = dragExcludes(exclude);
  const zs = [];
  state.model.axis.forEach((p, i) => { if (!ex.axis.includes(i) && Number.isFinite(p.z)) zs.push(p.z); });
  state.model.supports.forEach((s, i) => { if (!ex.supports.includes(i) && Number.isFinite(s.z)) zs.push(s.z); });
  state.model.loads.forEach((l, i) => { if (!ex.loads.includes(i) && Number.isFinite(l.z)) zs.push(l.z); });
  return zs;
}

// Rastet einen Wert ein: zuerst an einem nahen Punkt (Hilfslinie), sonst am Raster.
function snapCoordinate(raw, targets, free) {
  if (free || !state.view.snap) return { value: roundMm(raw), guide: null };
  if (state.view.snapPoints) {
    const tolerance = SNAP_PIXELS * drag.unitsPerPixel / drag.scale;
    let best = null;
    for (const t of targets) {
      const distance = Math.abs(t - raw);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { value: t, distance };
    }
    if (best) return { value: roundMm(best.value), guide: best.value };
  }
  return { value: snapToGrid(raw), guide: null };
}

const signed = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  let dx = ((event.clientX - drag.startX) * drag.unitsPerPixel) / drag.scale;
  let dz = (-(event.clientY - drag.startY) * drag.unitsPerPixel) / drag.scale;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
  drag.moved = true;
  // Umschalttaste: nur waagrecht oder senkrecht. Alt: ohne Einrasten.
  if (event.shiftKey) {
    if (Math.abs(dx) >= Math.abs(dz)) dz = 0;
    else dx = 0;
  }
  const free = event.altKey;
  const range = axisXRange();
  const s = drag.start;
  const targets = snapTargetsX(drag);
  let guide = null;
  let info = '';
  const snapX = (raw) => {
    const snapped = snapCoordinate(raw, targets, free);
    if (snapped.guide !== null) guide = { ...(guide || {}), x: snapped.guide };
    return snapped.value;
  };
  const snapZ = (raw, extra = []) => {
    const snapped = snapCoordinate(raw, [...snapTargetsZ(drag), ...extra].filter(Number.isFinite), free);
    if (snapped.guide !== null) guide = { ...(guide || {}), z: snapped.guide };
    return snapped.value;
  };
  // Höhe z (Lager an Stütze/Hänger, Horizontallast am Stiel): erst ab 8 px senkrechter Bewegung,
  // damit waagrechtes Ziehen nichts verstellt. Rastet an Achse, Lagern und Achspunkten; zurück
  // auf der Achse wird z wieder leer („Achse“).
  const dragHeight = (item) => {
    if (!drag.zActive && Math.abs(event.clientY - drag.startY) > 8 && dz !== 0) drag.zActive = true;
    if (!drag.zActive) return;
    const startZ = Number.isFinite(s.z) ? s.z : axisZModel(s.x);
    if (!Number.isFinite(startZ)) return;
    const axisHere = axisZModel(item.x);
    const value = snapZ(startZ + dz, [axisHere]);
    item.z = Number.isFinite(axisHere) && Math.abs(value - axisHere) < 1e-6 ? null : value;
  };
  // Knoten am Stabende: nahe der Stabachse (< 10 px daneben) ändert sich nur die Länge, sonst frei
  const moveNode = (node) => {
    let x = node.x + dx;
    let z = node.z + dz;
    const t = drag.track;
    if (t) {
      const vx = x - t.fx;
      const vz = z - t.fz;
      const along = vx * t.ux + vz * t.uz;
      const offPixels = (Math.abs(-vx * t.uz + vz * t.ux) * drag.scale) / drag.unitsPerPixel;
      if (offPixels < 10) {
        const length = free || !state.view.snap ? roundMm(along) : snapToGrid(along);
        info = `L = ${Math.abs(length).toFixed(2)} m (${signed(Math.abs(length) - t.length)})`;
        return { x: roundMm(t.fx + t.ux * length), z: roundMm(t.fz + t.uz * length), tracked: true };
      }
    }
    x = snapX(x);
    z = snapZ(z);
    info = `Δx = ${signed(x - node.x)} m  ·  Δz = ${signed(z - node.z)} m`;
    return { x, z, tracked: false };
  };
  switch (drag.kind) {
    case 'S': {
      const support = state.model.supports[drag.index];
      support.x = clamp(snapX(s.x + dx), range.min, range.max);
      dragHeight(support);
      info = `Δx = ${signed(support.x - s.x)} m`;
      break;
    }
    case 'F': {
      const load = state.model.loads[drag.index];
      load.x = clamp(snapX(s.x + dx), range.min, range.max);
      if (load.dir === 'left' || load.dir === 'right') dragHeight(load);
      info = `Δx = ${signed(load.x - s.x)} m`;
      break;
    }
    case 'Sn':
    case 'Fn': {
      if (!drag.node) return;
      const item = drag.kind === 'Sn' ? state.model.supports[drag.index] : state.model.loads[drag.index];
      const next = moveNode(drag.node);
      item.x = clamp(next.x, range.min, range.max);
      const axisHere = axisZModel(item.x);
      item.z = Number.isFinite(axisHere) && Math.abs(next.z - axisHere) < 1e-6 ? null : next.z;
      break;
    }
    case 'Sm':
    case 'Fm': {
      // ganze Stütze bzw. ganzer Stiel: waagrecht verschieben, oben bleibt er an der Achse
      const item = drag.kind === 'Sm' ? state.model.supports[drag.index] : state.model.loads[drag.index];
      item.x = clamp(snapX(s.x + dx), range.min, range.max);
      info = `Δx = ${signed(item.x - s.x)} m`;
      break;
    }
    case 'q': {
      // Der ganze Block rastet mit seinem linken oder rechten Ende ein, je nachdem was näher liegt.
      const length = s.x2 - s.x1;
      const left = snapCoordinate(s.x1 + dx, targets, free);
      const right = snapCoordinate(s.x2 + dx, targets, free);
      let x1 = left.value;
      guide = left.guide !== null ? { x: left.guide } : null;
      if (right.guide !== null && (left.guide === null || Math.abs(right.guide - (s.x2 + dx)) < Math.abs(left.guide - (s.x1 + dx)))) {
        x1 = roundMm(right.value - length);
        guide = { x: right.guide };
      }
      x1 = clamp(x1, range.min, range.max - length);
      state.model.loads[drag.index].x1 = x1;
      state.model.loads[drag.index].x2 = roundMm(x1 + length);
      info = `Δx = ${signed(x1 - s.x1)} m`;
      break;
    }
    case 'q1':
      state.model.loads[drag.index].x1 = clamp(snapX(s.x1 + dx), range.min, s.x2 - 0.01);
      info = `L = ${(s.x2 - state.model.loads[drag.index].x1).toFixed(2)} m`;
      break;
    case 'q2':
      state.model.loads[drag.index].x2 = clamp(snapX(s.x2 + dx), s.x1 + 0.01, range.max);
      info = `L = ${(state.model.loads[drag.index].x2 - s.x1).toFixed(2)} m`;
      break;
    case 'P': {
      const point = state.model.axis[drag.index];
      const next = moveNode(drag.node);
      point.x = next.x;
      point.z = next.z;
      moveAttached(drag.attached, next.x - drag.node.x, next.z - drag.node.z);
      break;
    }
    case 'Am': {
      // ganzen Abschnitt verschieben: der erste Knoten rastet ein, der zweite folgt
      const [n0, n1] = drag.nodes;
      const x0 = snapX(n0.x + dx);
      const z0 = snapZ(n0.z + dz);
      const deltaX = x0 - n0.x;
      const deltaZ = z0 - n0.z;
      Object.assign(state.model.axis[n0.i], { x: roundMm(n0.x + deltaX), z: roundMm(n0.z + deltaZ) });
      Object.assign(state.model.axis[n1.i], { x: roundMm(n1.x + deltaX), z: roundMm(n1.z + deltaZ) });
      moveAttached(drag.attached, deltaX, deltaZ);
      info = `Δx = ${signed(deltaX)} m  ·  Δz = ${signed(deltaZ)} m`;
      break;
    }
    default:
      return;
  }
  state.guide = guide;
  state.dragInfo = info;
  state.exampleId = '';
  scheduleUpdate();
}

function endDrag(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  removeGhost();
  const moved = drag.moved;
  drag = null;
  state.guide = null;
  state.dragInfo = '';
  const svg = $('figure').querySelector('svg');
  if (svg) svg.classList.remove('dragging');
  if (moved) {
    $('exampleSelect').value = '';
    renderAxisTable();
    renderSupportTable();
    renderLoadTable();
    scheduleUpdate();
  }
}

// Pfeiltasten: gewählte Elemente um (dx, dz) verschieben; Achsknoten nehmen ihre Lager und Lasten mit.
function nudgeSelection(dx, dz) {
  const svg = $('figure').querySelector('svg');
  const moveZ = (item) => {
    if (!dz) return;
    const axisHere = axisZModel(item.x);
    const start = Number.isFinite(item.z) ? item.z : axisHere;
    if (!Number.isFinite(start)) return;
    const value = roundMm(start + dz);
    item.z = Number.isFinite(axisHere) && Math.abs(value - axisHere) < 1e-6 ? null : value;
  };
  const moveNodes = (indices, between) => {
    const attached = attachedTo(indices, between);
    indices.forEach((i) => {
      const p = state.model.axis[i];
      if (p) { p.x = roundMm(p.x + dx); p.z = roundMm(p.z + dz); }
    });
    moveAttached(attached, dx, dz);
  };
  for (const ref of state.selection) {
    const [kind, indexText] = ref.split(':');
    const index = Number(indexText);
    if (kind === 'S') {
      const support = state.model.supports[index];
      if (!support) continue;
      if (Number.isFinite(support.x)) support.x = roundMm(support.x + dx);
      moveZ(support);
    } else if (kind === 'L') {
      const load = state.model.loads[index];
      if (!load) continue;
      if (load.kind === 'q') {
        load.x1 = roundMm(load.x1 + dx);
        load.x2 = roundMm(load.x2 + dx);
      } else {
        if (Number.isFinite(load.x)) load.x = roundMm(load.x + dx);
        if (load.dir === 'left' || load.dir === 'right' || Number.isFinite(load.z)) moveZ(load);
      }
    } else if (kind === 'P') {
      moveNodes([index], false);
    } else if (kind === 'A') {
      const element = svg && svg.querySelector(`[data-ref="${ref}"]`);
      const ends = element ? (element.getAttribute('data-ends') || '').split(',').map((e) => Number(e.split(':')[1])) : [];
      if (ends.length === 2) moveNodes(ends, true);
    }
  }
  state.exampleId = '';
  $('exampleSelect').value = '';
  renderAxisTable();
  renderSupportTable();
  renderLoadTable();
  scheduleUpdate();
}

// ---------- Blaue Masse direkt ändern ----------
// Ein Klick auf ein blaues Mass (Auswahl) öffnet darüber ein Eingabefeld. Bewegt wird das Ende,
// das zu einem gewählten Element gehört (bei zwei solchen das rechte bzw. untere). Eine
// Streckenlast ändert bei ihrem eigenen Mass die Länge, sonst wird sie als Ganzes verschoben.

let dimEditor = null;

function closeDimEditor(commit) {
  if (!dimEditor) return;
  const { input, info } = dimEditor;
  dimEditor = null;
  input.remove();
  if (commit) applyDimension(info, parseNumber(input.value));
}

function openDimEditor(textElement) {
  const info = {
    axis: textElement.dataset.dim,
    a: textElement.dataset.a || '',
    b: textElement.dataset.b || '',
    va: Number(textElement.dataset.va),
    vb: Number(textElement.dataset.vb),
  };
  if ((!info.a && !info.b) || !Number.isFinite(info.va) || !Number.isFinite(info.vb)) return;
  closeDimEditor(false);
  const box = textElement.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.className = 'dim-editor';
  input.setAttribute('aria-label', 'Mass in m');
  input.value = plain(roundMm(Math.abs(info.vb - info.va)));
  input.style.left = `${box.left + box.width / 2 + window.scrollX}px`;
  input.style.top = `${box.top + box.height / 2 + window.scrollY}px`;
  document.body.appendChild(input);
  dimEditor = { input, info };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeDimEditor(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDimEditor(false);
    }
  });
  input.addEventListener('blur', () => closeDimEditor(true));
  input.focus();
  input.select();
}

function applyDimension(info, value) {
  if (value === null) return;
  if (!Number.isFinite(value) || value < 0) {
    toast('Bitte eine Länge ab 0 in m eingeben.');
    return;
  }
  if (Math.abs(value - Math.abs(info.vb - info.va)) < 1e-9) return;
  const moveB = !!info.b;
  const ref = moveB ? info.b : info.a;
  const oldValue = moveB ? info.vb : info.va;
  // x wächst nach rechts (a links, b rechts); z: a ist die obere, b die untere Stelle
  const target = info.axis === 'x'
    ? (moveB ? info.va + value : info.vb - value)
    : (moveB ? info.va - value : info.vb + value);
  moveOwner(ref, info.axis, oldValue, roundMm(target), info.a !== info.b);
  state.exampleId = '';
  $('exampleSelect').value = '';
  renderAxisTable();
  renderSupportTable();
  renderLoadTable();
  scheduleUpdate();
}

function moveOwner(ref, axis, oldValue, newValue, whole) {
  const [kind, indexText] = String(ref).split(':');
  const index = Number(indexText);
  if (kind === 'S' || kind === 'P') {
    const item = kind === 'S' ? state.model.supports[index] : state.model.axis[index];
    if (item) item[axis] = newValue;
    return;
  }
  const load = kind === 'L' ? state.model.loads[index] : null;
  if (!load) return;
  if (load.kind !== 'q') {
    load[axis] = newValue;
    return;
  }
  const field = Math.abs(load.x1 - oldValue) <= Math.abs(load.x2 - oldValue) ? 'x1' : 'x2';
  if (whole) {
    const delta = newValue - load[field];
    load.x1 = roundMm(load.x1 + delta);
    load.x2 = roundMm(load.x2 + delta);
  } else {
    load[field] = newValue;
  }
}

function removeGhost() {
  const ghost = $('figure').querySelector('.drag-ghost');
  if (ghost) ghost.remove();
}

// Bricht ein laufendes Ziehen ab, wenn das Modell ersetzt oder gekürzt wird (sonst veraltete Indizes).
function cancelDrag() {
  if (!drag) return;
  removeGhost();
  const pointerId = drag.pointerId;
  drag = null;
  state.guide = null;
  state.dragInfo = '';
  try {
    $('figure').releasePointerCapture(pointerId);
  } catch (error) {
    // Capture war schon weg
  }
  const svg = $('figure').querySelector('svg');
  if (svg) svg.classList.remove('dragging');
}

// ---------- Ereignisse ----------

function setField(target) {
  const row = target.closest('tr[data-index]');
  const table = target.closest('table');
  if (!row || !table) return;
  const index = Number(row.dataset.index);
  const field = target.dataset.field;
  let item;
  if (table.id === 'axisTable') item = state.model.axis[index];
  else if (table.id === 'supportTable') item = state.model.supports[index];
  else if (table.id === 'loadTable') item = state.model.loads[index];
  if (!item || !field) return;

  if (field === 'name') {
    // eigener Name wie in der Aufgabe; leer = automatischer Name
    item.name = target.value.trim().slice(0, 12);
    return;
  }
  if (target.tagName === 'SELECT') {
    const relabel = field === 'dir' && item.kind !== 'q' && ((item.dir === 'left' || item.dir === 'right') !== (target.value === 'left' || target.value === 'right'));
    item[field] = target.value;
    if (relabel) refreshLoadPlaceholders();
    return;
  }
  const value = parseNumber(target.value);
  // z (Last neben der Achse) und der Wert am Ende einer Streckenlast dürfen leer sein
  const optional = (field === 'z' && table.id !== 'axisTable') || field === 'value2';
  if (value === null) {
    target.classList.toggle('invalid', !optional);
    item[field] = optional ? null : NaN;
  } else if (Number.isNaN(value)) {
    target.classList.add('invalid');
    item[field] = NaN;
  } else {
    target.classList.remove('invalid');
    item[field] = value;
  }
}

function addLoad(kind) {
  const axis = state.model.axis.filter((p) => Number.isFinite(p.x));
  const xs = axis.map((p) => p.x);
  const xmin = xs.length ? Math.min(...xs) : 0;
  const xmax = xs.length ? Math.max(...xs) : 6;
  const middle = Math.round(((xmin + xmax) / 2) * 100) / 100;
  if (kind === 'q') state.model.loads.push({ kind: 'q', dir: 'down', value: 10, x1: xmin, x2: xmax, name: '' });
  else if (kind === 'horizontal') state.model.loads.push({ kind: 'F', dir: 'right', value: 10, x: xmin, z: null, name: '' });
  else state.model.loads.push({ kind: 'F', dir: 'down', value: 10, x: middle, z: null, name: '' });
}

function handleAction(action, button) {
  cancelDrag();
  const row = button.closest('tr[data-index]');
  const index = row ? Number(row.dataset.index) : -1;
  // Neue Zeile: Cursor ins erste Feld, damit das neue Element gleich markiert ist.
  const focusNewRow = (tableId, field) => {
    const rows = document.querySelectorAll(`#${tableId} tr[data-index]`);
    const fieldInput = rows.length ? rows[rows.length - 1].querySelector(`input[data-field="${field}"]`) : null;
    if (fieldInput) { fieldInput.focus(); fieldInput.select(); }
  };
  switch (action) {
    case 'add-axis': {
      const last = state.model.axis[state.model.axis.length - 1] || { x: 0, z: 0 };
      state.model.axis.push({ x: (Number.isFinite(last.x) ? last.x : 0) + 1, z: Number.isFinite(last.z) ? last.z : 0 });
      renderAxisTable();
      focusNewRow('axisTable', 'x');
      break;
    }
    case 'remove-axis':
      if (state.model.axis.length > 2) state.model.axis.splice(index, 1);
      clearSelection();
      renderAxisTable();
      break;
    case 'add-point':
      addLoad('point');
      renderLoadTable();
      focusNewRow('loadTable', 'value');
      break;
    case 'add-horizontal':
      addLoad('horizontal');
      renderLoadTable();
      focusNewRow('loadTable', 'value');
      break;
    case 'add-q':
      addLoad('q');
      renderLoadTable();
      focusNewRow('loadTable', 'value');
      break;
    case 'remove-load':
      state.model.loads.splice(index, 1);
      clearSelection();
      renderLoadTable();
      break;
    default:
      return;
  }
  state.exampleId = '';
  $('exampleSelect').value = '';
  scheduleUpdate();
}

// Bemessung zum neuen System passend machen: Vorgabe des Beispiels (Tab, Werkstoff) übernehmen;
// sonst ohne Stütze im System vom Stützen-Tab (Quelle „aus dem System“) zurück zum Träger.
function fitDesign(design, model, hint) {
  const d = clone(design);
  if (!d || !d.beam || !d.column) return design;
  // ein von Hand gewähltes Profil gehört zur alten Aufgabe: im neuen System wieder automatisch wählen
  d.beam.profile = '';
  d.column.profile = '';
  if (hint) {
    if (hint.tab === 'beam' || hint.tab === 'column') d.tab = hint.tab;
    if (hint.material === 'steel' || hint.material === 'timber') d[d.tab].material = hint.material;
    return d;
  }
  const axis = (model.axis || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  const hasColumn = (model.supports || []).some((s) => {
    const zAxis = axisZAt(axis, s.x);
    return Number.isFinite(s.z) && zAxis !== null && Math.abs(s.z - zAxis) > 1e-6;
  });
  if (d.tab === 'column' && d.column.source === 'system' && !hasColumn) d.tab = 'beam';
  return d;
}

function loadExample(id) {
  const example = exampleById(id);
  if (!example) return;
  cancelDrag();
  rememberCurrent();
  // Die Einstellungen der Bemessung (Profilreihe, Stahlsorte …) bleiben beim Beispielwechsel erhalten;
  // Tab und Werkstoff passen sich dem Beispiel an
  state.model = sanitizeModel({ design: fitDesign(state.model.design, example.model, example.design), ...clone(example.model), title: example.title });
  resetSteps();
  state.exampleId = id;
  clearSelection();
  resetImport();
  history.replaceState(null, '', location.pathname + location.search);
  renderInputs();
  update();
}

// Vom Foto-Import erkanntes System übernehmen (Bemessungseinstellungen bleiben, wie beim Beispielwechsel)
function applyPhotoTask(task) {
  const raw = {
    title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : 'Aufgabe aus Foto',
    axis: task.axis,
    supports: task.supports,
    loads: task.loads,
    pivot: 'B',
  };
  const model = sanitizeModel({ design: fitDesign(state.model.design, raw, null), ...raw });
  cancelDrag();
  rememberCurrent();
  state.model = model;
  resetSteps();
  state.exampleId = '';
  clearSelection();
  history.replaceState(null, '', location.pathname + location.search);
  renderInputs();
  update();
}

// ---------- Zuletzt bearbeitet ----------
// Bevor ein anderes System geladen wird (Beispiel, Neu, Öffnen, Foto, Link), merkt sich die App das bisherige,
// wenn es etwas Eigenes ist (unverändertes Beispiel nicht). Höchstens sechs, das neueste zuerst.
const RECENT_KEY = 'staticulator-recent';
const RECENT_MAX = 6;

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((entry) => entry && entry.model && typeof entry.key === 'string') : [];
  } catch (error) {
    return [];
  }
}

function systemKey(model) {
  const { design, pivot, ...system } = model;
  return JSON.stringify(system);
}

function rememberCurrent() {
  clearSelfCheck();
  const model = state.model;
  if (!model || !(model.loads || []).some((load) => Number.isFinite(load.value))) return;
  const key = systemKey(model);
  if (state.exampleId) {
    const example = exampleById(state.exampleId);
    if (example && systemKey(sanitizeModel({ ...clone(example.model), title: example.title })) === key) return;
  }
  const { design, ...system } = model;
  const list = readRecent().filter((entry) => entry.key !== key);
  list.unshift({ key, title: model.title || 'ohne Titel', at: Date.now(), model: system });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (error) {
    // voller Speicher: ohne Liste weiter
  }
  renderRecent();
}

function agoText(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}

function renderRecent() {
  const list = readRecent();
  $('recentPicker').hidden = !list.length;
  $('recentSelect').innerHTML = '<option value="">zurückholen …</option>'
    + list.map((entry, i) => `<option value="${i}">${escapeHtml(entry.title)} · ${agoText(entry.at)}</option>`).join('');
  $('recentSelect').value = '';
}

function restoreRecent(index) {
  const entry = readRecent()[index];
  if (!entry) return;
  cancelDrag();
  rememberCurrent();
  state.model = sanitizeModel({ design: fitDesign(state.model.design, entry.model, null), ...entry.model });
  resetSteps();
  state.exampleId = '';
  clearSelection();
  resetImport();
  history.replaceState(null, '', location.pathname + location.search);
  renderInputs();
  update();
  toast(`„${entry.title}“ wieder geladen.`);
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2600);
}

async function copyShareLink() {
  // Der Link geht nur in die Zwischenablage, nicht in die Adresszeile: sonst würde F5 später
  // diesen Stand laden und die inzwischen weitergeführte Arbeit überschreiben.
  const url = `${location.origin}${location.pathname}#m=${encodeModel(state.model)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopiert – er enthält das ganze System.');
  } catch (error) {
    window.prompt('Link zum Kopieren:', url);
  }
}

function saveFile() {
  const blob = new Blob([JSON.stringify({ app: 'StatiCulator Web', v: 1, model: state.model }, null, 2)], { type: 'application/json' });
  const name = ((state.model.title || 'staticulator').replace(/[^\wäöüÄÖÜ.-]+/g, '_').slice(0, 60) || 'staticulator') + '.json';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Skizze (und Flächen) als Bild: ohne Auswahl, Hebelarm und Mauszeiger, immer im hellen Farbschema
async function saveImage(format) {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme');
  const selection = state.selection.slice();
  const name = (state.model.title || 'staticulator').replace(/[^\wäöüÄÖÜ.-]+/g, '_').slice(0, 60) || 'staticulator';
  try {
    root.setAttribute('data-theme', 'light');
    state.selection = [];
    removeLever();
    hideDiagramCursor();
    drawFigure();
    const svgs = [$('figure').querySelector('svg')];
    if ($('exportDiagrams').checked) svgs.push(...document.querySelectorAll('#diagrams svg.diagram, #deflectionDiagram:not([hidden]) svg.diagram'));
    await exportImage(format, svgs, state.model.title, name);
    toast(format === 'svg' ? 'Bild als SVG gespeichert.' : 'Bild als PNG gespeichert.');
  } catch (error) {
    toast(error.message || 'Das Bild liess sich nicht speichern.');
  } finally {
    if (theme) root.setAttribute('data-theme', theme);
    state.selection = selection;
    drawFigure();
    drawSelectionLever();
  }
}

function openFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      cancelDrag();
      rememberCurrent();
      state.model = sanitizeModel(data.model || data);
      resetSteps();
      state.exampleId = '';
      clearSelection();
      resetImport();
      renderInputs();
      update();
      toast('System geöffnet.');
    } catch (error) {
      toast('Die Datei enthält kein gültiges StatiCulator-System.');
    }
  };
  reader.readAsText(file);
}

// ---------- Zeichnen im Massstab ----------
// Längen-, Kräfte- und Momentenmassstab wie in der Aufgabe (1 cm ≙ … m / kN / kNm). Ohne eigene
// Eingabe schlägt die App runde Massstäbe vor, mit denen alles auf ein A4-Blatt passt.

const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const SCALE_FIELDS = { length: 'scaleLength', force: 'scaleForce', moment: 'scaleMoment' };

function niceScale(value, maxCm) {
  if (!(value > 0)) return 1;
  return NICE_STEPS.find((step) => value / step <= maxCm) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

// Vorschlag: Träger höchstens 16 cm breit (A4 hoch), grösste Kraft 5 cm, grösstes Moment 4 cm
function suggestScales() {
  const { result, resolved, forces } = state.last || {};
  if (!resolved) return { length: 1, force: 10, moment: 50 };
  const xs = [];
  const zs = [];
  resolved.axis.forEach((p) => { xs.push(p.x); zs.push(p.z); });
  resolved.supports.forEach((s) => { if (Number.isFinite(s.x)) { xs.push(s.x); zs.push(s.z); } });
  resolved.points.forEach((p) => { xs.push(p.x); zs.push(p.z); });
  resolved.qloads.forEach((q) => xs.push(q.x1, q.x2));
  const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 1;
  const height = zs.length ? Math.max(...zs) - Math.min(...zs) : 0;
  const forceValues = [
    ...resolved.points.map((p) => Math.abs(p.value)),
    ...resolved.qloads.map((q) => Math.abs(q.resultant)),
    ...(result && result.ok ? result.reactions.flatMap((r) => [Math.abs(r.Rx), Math.abs(r.Rz)]) : []),
  ];
  const momentValues = forces && forces.ok ? [Math.abs(forces.mMax.m), Math.abs(forces.mMin.m)] : [];
  return {
    length: niceScale(Math.max(span, height * 1.6), 16),
    force: niceScale(Math.max(0, ...forceValues), 5),
    moment: niceScale(Math.max(0, ...momentValues), 4),
  };
}

function currentScales() {
  const custom = state.view.scale;
  if (custom && custom.custom) return custom;
  return suggestScales();
}

function fillScaleInputs(scales, force = false) {
  for (const [key, id] of Object.entries(SCALE_FIELDS)) {
    const field = $(id);
    if (force || document.activeElement !== field) field.value = plain(scales[key]);
  }
}

function renderScaleCard() {
  const card = $('scaleCard');
  if (card) card.hidden = !state.view.scaleMode;
  const { result, resolved, forces } = state.last || {};
  if (!card || !resolved) return;
  const scales = currentScales();
  fillScaleInputs(scales);
  $('scaleRatio').textContent = `(Massstab 1:${plain(Math.round(scales.length * 100 * 1000) / 1000)})`;
  const toCm = (value, per) => fixed(value / per, 2);
  const rows = (items) => items.map((cells) => `<tr>${cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  const table = (title, head, body) => (body ? `<div><h3>${title}</h3><table class="scale-table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` : '');

  // Längen: Punkte entlang x mit Abstand vom Trägeranfang und zum vorherigen Punkt
  const points = [];
  const addPoint = (x, name) => {
    if (!Number.isFinite(x)) return;
    const found = points.find((p) => Math.abs(p.x - x) < 1e-7);
    if (found) { if (!found.names.includes(name)) found.names.push(name); } else points.push({ x, names: [name] });
  };
  resolved.axis.forEach((p, i) => addPoint(p.x, i === 0 ? 'Achse Anfang' : i === resolved.axis.length - 1 ? 'Achse Ende' : `Achspunkt P${i + 1}`));
  resolved.supports.forEach((s) => addPoint(s.x, `Lager ${escapeHtml(s.name)}`));
  resolved.points.forEach((p) => addPoint(p.x, htmlName(p.label)));
  resolved.qloads.forEach((q) => { addPoint(q.x1, `${htmlName(q.label)} Anfang`); addPoint(q.x2, `${htmlName(q.label)} Ende`); });
  points.sort((a, b) => a.x - b.x);
  const start = points.length ? points[0].x : 0;
  const lengthRows = rows(points.map((p, i) => [
    p.names.join(', '),
    `${label(p.x, 2)} m`,
    `${toCm(p.x - start, scales.length)} cm`,
    i ? `${toCm(p.x - points[i - 1].x, scales.length)} cm` : '–',
  ]));

  // Höhen: Niveaus über dem tiefsten Punkt (nur wenn es mehrere gibt)
  const levels = [];
  const addLevel = (z, name) => {
    if (!Number.isFinite(z)) return;
    const found = levels.find((l) => Math.abs(l.z - z) < 1e-7);
    if (found) { if (!found.names.includes(name)) found.names.push(name); } else levels.push({ z, names: [name] });
  };
  resolved.axis.forEach((p) => addLevel(p.z, 'Achse'));
  resolved.supports.forEach((s) => addLevel(s.z, `Lager ${escapeHtml(s.name)}`));
  resolved.points.forEach((p) => { if (Math.abs(p.z - p.axisZ) > 1e-9) addLevel(p.z, htmlName(p.label)); });
  levels.sort((a, b) => b.z - a.z);
  const bottom = levels.length ? levels[levels.length - 1].z : 0;
  const heightRows = levels.length > 1
    ? rows(levels.map((l) => [l.names.join(', '), `${label(l.z, 2)} m`, `${toCm(l.z - bottom, scales.length)} cm`]))
    : '';

  // Kräfte: Lasten (Streckenlast als Resultierende) und Auflagerkräfte als Pfeillängen
  const forceRows = [
    ...resolved.points.map((p) => [htmlName(p.label), `${fixed(p.value, 2)} kN`, `${toCm(p.value, scales.force)} cm`]),
    ...resolved.qloads.map((q) => [`${htmlName(q.label)} (Resultierende ${q.trapez ? `(${fixed(q.value, 2)} + ${fixed(q.value2, 2)}) / 2` : fixed(q.value, 2)} kN/m · ${fixed(q.length, 2)} m)`, `${fixed(Math.abs(q.resultant), 2)} kN`, `${toCm(Math.abs(q.resultant), scales.force)} cm`]),
  ];
  if (result && result.ok) {
    for (const r of result.reactions) {
      if (r.hasRx && Math.abs(r.Rx) > 1e-9) forceRows.push([`${escapeHtml(r.name)}<sub>x</sub>`, `${fixed(Math.abs(r.Rx), 2)} kN`, `${toCm(Math.abs(r.Rx), scales.force)} cm`]);
      if (Math.abs(r.Rz) > 1e-9) forceRows.push([`${escapeHtml(r.name)}<sub>z</sub>`, `${fixed(Math.abs(r.Rz), 2)} kN`, `${toCm(Math.abs(r.Rz), scales.force)} cm`]);
    }
  }

  // Schnittgrössen: Extremwerte als Ordinaten der V- und M-Fläche
  const internalRows = [];
  if (forces && forces.ok) {
    if (Math.abs(forces.vMax.v) > 1e-9) internalRows.push(['V<sub>max</sub>', `${label(forces.vMax.v, 2)} kN`, `${toCm(Math.abs(forces.vMax.v), scales.force)} cm`]);
    if (Math.abs(forces.vMin.v) > 1e-9) internalRows.push(['V<sub>min</sub>', `${label(forces.vMin.v, 2)} kN`, `${toCm(Math.abs(forces.vMin.v), scales.force)} cm`]);
    if (Math.abs(forces.mMax.m) > 1e-9) internalRows.push(['M<sub>max</sub>', `${label(forces.mMax.m, 2)} kNm`, `${toCm(Math.abs(forces.mMax.m), scales.moment)} cm`]);
    if (Math.abs(forces.mMin.m) > 1e-9) internalRows.push(['M<sub>min</sub>', `${label(forces.mMin.m, 2)} kNm`, `${toCm(Math.abs(forces.mMin.m), scales.moment)} cm`]);
  }

  setHtml($('scaleTables'), [
    table(`Längen (1 cm ≙ ${plain(scales.length)} m)`, ['Punkt', 'x', 'ab Anfang', 'Abstand'], lengthRows),
    table(`Höhen (1 cm ≙ ${plain(scales.length)} m)`, ['Niveau', 'z', 'über tiefstem Punkt'], heightRows),
    table(`Kräfte (1 cm ≙ ${plain(scales.force)} kN)`, ['Kraft', 'Wert', 'Pfeillänge'], rows(forceRows)),
    table(`V- und M-Fläche (1 cm ≙ ${plain(scales.force)} kN bzw. ${plain(scales.moment)} kNm)`, ['Grösse', 'Wert', 'Ordinate'], rows(internalRows)),
  ].join(''));
  updateConverter();
}

function updateConverter() {
  const scales = currentScales();
  const unitScale = { length: scales.length, force: scales.force, moment: scales.moment };
  const value = parseNumber($('convValue').value);
  const unit = $('convUnit').value;
  $('convToPaper').textContent = Number.isFinite(value) ? fixed(value / unitScale[unit], 2) : '–';
  const paper = parseNumber($('convPaper').value);
  $('convFromPaper').textContent = Number.isFinite(paper)
    ? `${fixed(paper * scales.length, 3)} m · ${fixed(paper * scales.force, 2)} kN · ${fixed(paper * scales.moment, 2)} kNm`
    : '–';
}

function initScaleCard() {
  fillScaleInputs(currentScales(), true);
  for (const [key, id] of Object.entries(SCALE_FIELDS)) {
    $(id).addEventListener('input', () => {
      const value = parseNumber($(id).value);
      $(id).classList.toggle('invalid', !(value > 0));
      if (!(value > 0)) return;
      state.view.scale = { ...currentScales(), [key]: value, custom: true };
      storeModel();
      renderScaleCard();
      scheduleFigure();
    });
  }
  $('scaleSuggest').addEventListener('click', () => {
    state.view.scale = { ...suggestScales(), custom: false };
    Object.values(SCALE_FIELDS).forEach((id) => $(id).classList.remove('invalid'));
    fillScaleInputs(state.view.scale, true);
    storeModel();
    renderScaleCard();
    scheduleFigure();
  });
  ['convValue', 'convPaper'].forEach((id) => $(id).addEventListener('input', updateConverter));
  $('convUnit').addEventListener('change', updateConverter);
}

// ---------- Lösungsweg: Glied überfahren → Last und Hebelarm in der Skizze ----------
// Die Glieder tragen data-term (solution.js): m:i / mu (ΣM), v:i / vu / vk (ΣV), h:i / hu (ΣH).

function termInfo(key) {
  const result = state.last && state.last.result;
  if (!result || !result.ok) return null;
  const { h, m, v } = result.steps;
  const f = (value) => fixed(value, state.decimals);
  const name = (text) => String(text).replace('_', '');
  const dirWord = { up: 'nach oben', down: 'nach unten', right: 'nach rechts', left: 'nach links' };
  const senseText = (moment) => (moment > 0 ? 'dreht im Uhrzeigersinn ↷ → positiv' : 'dreht gegen den Uhrzeigersinn ↶ → negativ');
  const pivot = { pivotX: m.pivotX, pivotZ: m.pivotZ, pivotName: m.pivot };
  const [group, indexText] = key.split(':');
  const index = Number(indexText);
  if (key === 'mu') {
    return {
      ref: m.unknownRef, ...pivot, x: m.unknownX, z: m.unknownZ, vertical: true, lever: m.unknownLever, sense: m.unknownSense,
      text: `${name(m.unknown)} gesucht, nach oben angenommen · Hebelarm ${length(m.unknownLever, state.decimals)} m bis ${m.pivot} · ${senseText(m.unknownSense)}`,
    };
  }
  if (group === 'm' && m.terms[index]) {
    const t = m.terms[index];
    // Trapezlast: Rechteck (Resultierende in der Mitte) und Dreieck (im Drittelspunkt) getrennt
    const what = t.kind === 'q'
      ? (t.part === 'tri'
        ? `${t.label} (Dreieck): ½ · ${f(t.q)} kN/m · ${length(t.length, state.decimals)} m = ${f(t.force)} kN, Resultierende im Drittelspunkt (x = ${length(t.x, state.decimals)} m)`
        : `${t.label}${t.part ? ' (Rechteck)' : ''}: ${f(t.q)} kN/m · ${length(t.length, state.decimals)} m = ${f(t.force)} kN, Resultierende in der Mitte (x = ${length(t.x, state.decimals)} m)`)
      : `${name(t.label)} = ${f(t.force)} kN ${dirWord[t.dir] || ''}`;
    return {
      ref: t.ref, ...pivot, x: t.x, z: t.z, vertical: t.kind === 'v' || t.kind === 'q', lever: t.lever, sense: Math.sign(t.moment), resultant: t.kind === 'q',
      text: `${what} · Hebelarm ${length(t.lever, state.decimals)} m bis ${m.pivot} · ${senseText(t.moment)}`,
    };
  }
  if (group === 'v' && v.terms[index]) {
    const t = v.terms[index];
    const what = t.q !== undefined
      ? `${t.label}${t.part ? (t.part === 'tri' ? ' (Dreieck)' : ' (Rechteck)') : ''}: ${t.half ? '½ · ' : ''}${f(t.q)} kN/m · ${length(t.length, state.decimals)} m = ${f(Math.abs(t.value))} kN`
      : `${name(t.label)} = ${f(Math.abs(t.value))} kN`;
    return { ref: t.ref, text: `${what} ${t.value > 0 ? 'nach oben → positiv' : 'nach unten → negativ'} (nach oben positiv)` };
  }
  if (key === 'vu') return { ref: v.unknownRef, text: `${name(v.unknown)} gesucht, nach oben angenommen` };
  if (key === 'vk') return { ref: v.knownRef, text: `${name(v.knownName)} = ${f(v.known)} kN aus ΣM` };
  if (group === 'h' && h.terms[index]) {
    const t = h.terms[index];
    return { ref: t.ref, text: `${name(t.label)} = ${f(Math.abs(t.value))} kN ${t.value > 0 ? 'nach rechts → positiv' : 'nach links → negativ'} (nach rechts positiv)` };
  }
  if (key === 'hu' && h.supportName) {
    const support = state.model.supports.findIndex((s) => s.name === h.supportName);
    return { ref: support >= 0 ? `S:${support}` : null, text: `${name(h.unknown)} gesucht, nach rechts angenommen` };
  }
  return null;
}

function removeLever() {
  const figure = $('figure');
  const layer = figure.querySelector('.lever-layer');
  if (layer) layer.remove();
  const svg = figure.querySelector('svg');
  if (svg) {
    svg.classList.remove('lever-focus');
    svg.querySelectorAll('.lv-under').forEach((element) => element.classList.remove('lv-under'));
  }
}

let leverMeasure = null;
// Breite einer Plakette (Text fett 12.5 px plus Rand)
function pillWidth(content) {
  if (!leverMeasure) {
    leverMeasure = document.createElement('canvas').getContext('2d');
    leverMeasure.font = '700 12.5px system-ui, -apple-system, "Segoe UI", sans-serif';
  }
  return leverMeasure.measureText(content).width + 16;
}

// Breite einer Masszahl am Mauszeiger (11.5 px, halbfett wie .dc-dim-text)
let dimMeasure = null;
function dimTextWidth(content) {
  if (!dimMeasure) {
    dimMeasure = document.createElement('canvas').getContext('2d');
    dimMeasure.font = '400 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  }
  return dimMeasure.measureText(content).width;
}

// Wirkungslinie (gestrichelt), Hebelarm als farbiges Mass (Doppelpfeil mit Plakette auf der Linie), Drehpunkt
// (Ring mit Hof) und bei gewählter Last der Drehsinn als Bogenpfeil mit dem Moment daneben.
// Farbe nach Drehsinn wie im Lösungsweg: ↷ blau, ↶ orange (über CSS, auch im Dark Mode).
function drawLever(info) {
  removeLever();
  const svg = $('figure').querySelector('svg');
  const layout = state.layout;
  if (!svg || !layout || !info || !Number.isFinite(info.lever) || !Number.isFinite(info.pivotX)) return;
  const X = layout.X;
  const Y = (z) => state.top + (layout.zmax - z) * layout.scale;
  const r1 = (value) => Math.round(value * 10) / 10;
  const width = svg.viewBox.baseVal.width;
  const line = (x1, y1, x2, y2, cls) => `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
  // gleiche Pfeilspitze wie in der Skizze: schlankes, gefülltes Dreieck
  const head = (x, y, angle, size = 11) => `<path class="lv-fill" d="${arrowHeadPath(x, y, angle, size)}"/>`;
  // Hebelarm als Mass wie überall (dimension.js): Masslinie mit Überstand und Schrägstrichen, etwas
  // kräftiger und in der Farbe des Drehsinns (currentColor der Ebene)
  const lever = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const over = DIM_STYLE.lineOver;
    const vertical = Math.abs(x2 - x1) < 1e-6;
    return line(x1 - ux * over, y1 - uy * over, x2 + ux * over, y2 + uy * over, 'lv-arm')
      + dimSlash(x1, y1, vertical, { k: 1.2, color: 'currentColor' }) + dimSlash(x2, y2, vertical, { k: 1.2, color: 'currentColor' });
  };
  // Plakette: farbiges, abgerundetes Feld mit weisser Schrift; im Bild gehalten
  const pill = (cx, cy, content, anchor = 'middle') => {
    const w = pillWidth(content);
    let left = anchor === 'start' ? cx : anchor === 'end' ? cx - w : cx - w / 2;
    left = Math.min(width - w - 3, Math.max(3, left));
    return `<g class="lv-pill"><rect x="${r1(left)}" y="${r1(cy - 10)}" width="${r1(w)}" height="20" rx="10"/>`
      + `<text x="${r1(left + w / 2)}" y="${r1(cy + 4.3)}" text-anchor="middle">${escapeHtml(content)}</text></g>`;
  };
  const px = X(info.pivotX);
  const py = Y(info.pivotZ);
  const fx = X(info.x);
  const fy = Y(info.z);
  const leverText = `a = ${length(info.lever, state.decimals)} m`;
  const parts = [];
  let momentAt = []; // Kandidaten für die Plakette mit dem Moment
  // Plaketten, Drehpunkt und Drehpfeil dürfen sich nie überdecken: jede Plakette nimmt die erste freie Lage
  const placed = [{ x: px - 13, y: py - 13, width: 26, height: 26 }];
  const momentArc = info.showMoment && info.lever > 1e-9 && Number.isFinite(info.moment) && Math.abs(info.moment) >= 1e-9;
  // beim Überfahren eines ΣM-Terms nur der Drehsinn (ohne Plakette): der Term zeigt Kraft · Hebelarm schon
  const senseArc = !info.showMoment && info.showArc && info.lever > 1e-9 && Math.abs(info.sense || 0) > 0;
  if (momentArc || senseArc) placed.push({ x: px - 32, y: py - 34, width: 64, height: 30 });
  const boxOf = (cx, cy, content, anchor = 'middle') => {
    const w = pillWidth(content);
    let left = anchor === 'start' ? cx : anchor === 'end' ? cx - w : cx - w / 2;
    left = Math.min(width - w - 3, Math.max(3, left));
    return { x: left, y: cy - 10, width: w, height: 20 };
  };
  const vb = svg.viewBox.baseVal;
  const placePill = (content, candidates) => {
    let best = null;
    const tryAt = (c) => {
      const box = boxOf(c.x, c.y, content, c.anchor);
      // oben oder unten aus dem Bild zählt wie eine Überdeckung
      const outside = Math.max(0, vb.y + 2 - box.y) + Math.max(0, box.y + box.height - (vb.y + vb.height - 2));
      const hit = placed.reduce((sum, o) => sum + overlapArea(box, o, 3), 0) + outside * box.width;
      if (!best || hit < best.hit) best = { c, hit, box };
      return hit === 0;
    };
    // erst die bevorzugten Lagen; ist keine frei (lange Zahlen, Rand), schrittweise darum herum suchen
    if (!candidates.some(tryAt)) {
      const steps = [[0, -22], [0, 22], [-40, 0], [40, 0], [-40, -22], [40, -22], [-40, 22], [40, 22]];
      search: for (let k = 1; k <= 3; k++) {
        for (const c of candidates) {
          for (const [dx, dy] of steps) {
            if (tryAt({ ...c, x: c.x + dx * k, y: c.y + dy * k })) break search;
          }
        }
      }
    }
    placed.push(best.box);
    return pill(best.c.x, best.c.y, content, best.c.anchor);
  };
  // Hebelarm wie ein Mass: frei unter Lagern und Reaktionspfeilen, über der Masskette, mit Hilfslinien
  if (info.vertical) {
    const dims = state.figureDims || {};
    const lowest = (xm) => (dims.lowestAt ? dims.lowestAt(xm) : null);
    const lowP = lowest(info.pivotX);
    const lowF = lowest(info.x);
    let ly = Math.max(py + 26, (lowP ?? py) + 14, (lowF ?? fy) + 14);
    if (Number.isFinite(dims.dimY)) ly = Math.min(ly, dims.dimY - 34);
    parts.push(line(fx, Math.min(fy, ly), fx, Math.max(fy, ly) + DIM_STYLE.extOver, 'lv-action'));
    if (Math.abs(fx - px) > 2) {
      // Hilfslinie am Drehpunkt erst unter Lager und Reaktion, damit sie das Lagersymbol nicht kreuzt
      const helpFrom = Math.min(ly - 8, (lowP ?? py) + 4);
      // Plakette auf der Masslinie (wie eine Masszahl); bei kurzem Hebelarm darüber
      const onLine = Math.abs(fx - px) > pillWidth(leverText) + 34;
      const mid = (fx + px) / 2;
      parts.push(line(px, helpFrom, px, ly + DIM_STYLE.extOver, 'lv-help'), lever(fx, ly, px, ly), placePill(leverText, onLine ? [{ x: mid, y: ly }, { x: mid, y: ly - 15 }] : [{ x: mid, y: ly - 15 }, { x: mid, y: ly + 15 }]));
    }
    // Moment neben dem Drehpfeil über dem Drehpunkt, zur Bildmitte hin
    const inward = px > width / 2 ? [{ x: px - 36, y: py - 34, anchor: 'end' }, { x: px + 36, y: py - 34, anchor: 'start' }] : [{ x: px + 36, y: py - 34, anchor: 'start' }, { x: px - 36, y: py - 34, anchor: 'end' }];
    momentAt = [...inward, { x: px, y: py - 60 }, { x: (fx + px) / 2, y: ly + 24 }];
    if (info.resultant) {
      placed.push({ x: fx - 6, y: fy - 6, width: 12, height: 12 });
      parts.push(`<circle class="lv-fill" cx="${r1(fx)}" cy="${r1(fy)}" r="4.5"/>`, placePill('R', [{ x: fx, y: fy - 17 }, { x: fx, y: fy - 36 }, { x: fx + 12, y: fy - 17, anchor: 'start' }, { x: fx - 12, y: fy - 17, anchor: 'end' }]));
    }
  } else {
    const lx = px + 28;
    parts.push(line(Math.min(fx, lx), fy, Math.max(fx, lx + DIM_STYLE.extOver), fy, 'lv-action'));
    if (Math.abs(fy - py) > 2) {
      parts.push(line(px, py, lx + DIM_STYLE.extOver, py, 'lv-help'), lever(lx, fy, lx, py), placePill(leverText, [{ x: lx + 9, y: (fy + py) / 2, anchor: 'start' }, { x: lx - 9, y: (fy + py) / 2, anchor: 'end' }]));
    }
    const mid = (fy + py) / 2;
    momentAt = [{ x: lx + 9, y: mid + 24, anchor: 'start' }, { x: lx + 9, y: mid - 24, anchor: 'start' }, { x: px - 36, y: py - 34, anchor: 'end' }, { x: px + 36, y: py - 34, anchor: 'start' }, { x: px, y: py - 60 }, { x: px, y: py + 40 }];
  }
  // Drehpunkt: Hof, Ring und Mittelpunkt
  parts.push(`<circle class="lv-halo" cx="${r1(px)}" cy="${r1(py)}" r="13"/>`, `<circle class="lv-ring" cx="${r1(px)}" cy="${r1(py)}" r="7.5"/>`, `<circle class="lv-fill" cx="${r1(px)}" cy="${r1(py)}" r="2.6"/>`);
  // Drehsinn um den Drehpunkt: Bogenpfeil über dem Drehpunkt
  const arc = () => {
    const radius = 26;
    const headLength = 12;
    const a0 = (-160 * Math.PI) / 180;
    const a1 = (-20 * Math.PI) / 180;
    const cw = info.sense > 0;
    const point = (a) => [px + radius * Math.cos(a), py + radius * Math.sin(a)];
    // Der Bogen endet, wo die Spitze beginnt; die Spitze folgt der Sehne über ihre eigene Länge
    const back = headLength / radius;
    const [sx, sy] = point(cw ? a0 : a1);
    const [bx, by] = point(cw ? a1 - back : a0 + back);
    const [tx, ty] = point(cw ? a1 : a0);
    // in Bildschirmkoordinaten ist sweep 1 der Uhrzeigersinn
    parts.push(`<path class="lv-arc" d="M${r1(sx)},${r1(sy)} A${radius},${radius} 0 0 ${cw ? 1 : 0} ${r1(bx)},${r1(by)}"/>`);
    parts.push(head(tx, ty, Math.atan2(ty - by, tx - bx), headLength));
  };
  if (senseArc) arc();
  // bei gewählter Last zusätzlich das Moment daneben
  if (info.showMoment) {
    if (!(info.lever > 1e-9) || !Number.isFinite(info.moment) || Math.abs(info.moment) < 1e-9) {
      parts.push(placePill('Hebelarm 0: geht durch den Drehpunkt, kein Moment', [{ x: px, y: py - 24 }, { x: px, y: py - 46 }, { x: px, y: py + 40 }]));
    } else {
      arc();
      const cw = info.sense > 0;
      const f = (value) => fixed(value, state.decimals);
      const content = `M = ${f(info.force)} · ${length(info.lever, state.decimals)} = ${f(Math.abs(info.moment))} kNm ${cw ? '↷' : '↶'}`;
      parts.push(placePill(content, momentAt));
    }
  }
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', `lever-layer ${info.sense > 0 ? 'cw' : 'ccw'}`);
  layer.innerHTML = parts.join('');
  svg.appendChild(layer);
  // Der Rest der Skizze tritt zurück, solange der Hebelarm gezeigt wird
  svg.classList.add('lever-focus');
  // Beschriftungen, über die Hebelarm oder Plaketten laufen, treten fast ganz zurück (ausser der eigenen Last)
  const marks = [...layer.querySelectorAll('.lv-arm, .lv-pill')].map((element) => element.getBBox());
  for (const text of svg.querySelectorAll('text')) {
    if (text.closest('.lever-layer')) continue;
    const owner = text.closest('[data-ref]');
    if (owner && (owner.classList.contains('hl-sel') || owner.classList.contains('hl-hover'))) continue;
    const box = text.getBBox();
    const hit = marks.some((m) => box.x < m.x + m.width + 2 && box.x + box.width > m.x - 2 && box.y < m.y + m.height + 2 && box.y + box.height > m.y - 2);
    if (hit) text.classList.add('lv-under');
  }
}

let activeTerm = null;

function showTerm(element, event) {
  const info = termInfo(element.dataset.term);
  if (!info) return;
  activeTerm = element;
  element.classList.add('term-active');
  if (info.ref) setHover(info.ref, 'solution');
  // ohne Hebelarm (ΣV, ΣH) auch keinen Hebelarm einer gewählten Last zeigen, sonst wirkt es wie ΣM
  if (info.lever !== undefined) drawLever({ ...info, showArc: true });
  else removeLever();
  const tip = $('termTip');
  tip.textContent = info.text;
  tip.hidden = false;
  positionTip(event);
  showFigurePeek(event);
}

// Ausschnitt für das schwebende Fenster: Hebelarm (Wirkungslinie, Mass, Drehpunkt, Drehpfeil) und die
// markierte Last samt Beschriftung, mit Rand und Mindestbreite; im Bild gehalten. Ohne Markierung: null.
function peekRegion(svg, focus) {
  const vb = svg.viewBox.baseVal;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const hasLever = !!svg.querySelector('.lever-layer');
  const parts = [...svg.querySelectorAll('.lever-layer, [data-ref]')]
    .filter((element) => element.classList.contains('lever-layer') || focus.has(element.getAttribute('data-ref')));
  for (const element of parts) {
    let box;
    try { box = element.getBBox(); } catch (error) { continue; }
    if (!(box.width > 0 || box.height > 0)) continue;
    x1 = Math.min(x1, box.x);
    y1 = Math.min(y1, box.y);
    x2 = Math.max(x2, box.x + box.width);
    y2 = Math.max(y2, box.y + box.height);
  }
  if (!Number.isFinite(x1)) return null;
  x1 -= 40;
  x2 += 40;
  y1 -= 28;
  y2 += 28;
  // Mindestbreite (eine einzelne Last soll nicht riesig werden) und ein angenehmes Seitenverhältnis
  // ohne Hebelarm (z. B. ΣV) mehr Umgebung, damit man sieht, wo die Last im System sitzt
  const minWidth = Math.max(320, vb.width * (hasLever ? 0.4 : 0.6), (y2 - y1) * 1.8);
  if (x2 - x1 < minWidth) {
    const center = (x1 + x2) / 2;
    x1 = center - minWidth / 2;
    x2 = center + minWidth / 2;
  }
  // Mindesthöhe, damit Träger und Lager rund um die Last mit drauf sind
  const minHeight = (x2 - x1) * 0.45;
  if (y2 - y1 < minHeight) {
    const middle = (y1 + y2) / 2;
    y1 = middle - minHeight / 2;
    y2 = middle + minHeight / 2;
  }
  // im Bild halten (verschieben statt abschneiden)
  const width = Math.min(x2 - x1, vb.width);
  x1 = Math.min(Math.max(x1, vb.x), vb.x + vb.width - width);
  const height = Math.min(y2 - y1, vb.height);
  y1 = Math.min(Math.max(y1, vb.y), vb.y + vb.height - height);
  // lohnt sich nur, wenn der Ausschnitt deutlich kleiner als das ganze Bild ist
  if (width > vb.width * 0.9) return null;
  const round = (v) => Math.round(v * 10) / 10;
  return { x: round(x1), y: round(y1), width: round(width), height: round(height) };
}

// In der Vorschau tritt alles zurück, was mit dem überfahrenen Term nichts zu tun hat: kräftig bleiben die Last
// (bzw. Lagerkraft), der Hebelarm und am Drehpunkt das Lager mit Namen; der Träger bleibt als Bezug halb sichtbar.
function fadePeek(copy, info, focus) {
  copy.querySelectorAll(':scope > .hl-layer, :scope > .hit-layer').forEach((element) => element.remove());
  if (!focus.size) return;
  const pivot = info && info.pivotName !== undefined ? state.model.supports.findIndex((s) => s.name === info.pivotName) : -1;
  const pivotRef = pivot >= 0 ? `S:${pivot}` : null;
  for (const child of copy.children) {
    if (child.tagName === 'defs' || child.classList.contains('lever-layer')) continue;
    const ref = child.getAttribute('data-ref');
    if (ref && focus.has(ref)) continue;
    // Lagersymbol und Name am Drehpunkt bleiben; seine Lagerkraft (Hebelarm 0) tritt zurück
    const pivotPart = ref && ref === pivotRef
      && (child.classList.contains('drag') || (child.classList.contains('lbl') && !child.textContent.includes('=')));
    if (pivotPart) continue;
    child.classList.add(ref && ref.startsWith('A:') ? 'peek-context' : 'peek-faded');
  }
}

// Ist die Skizze weggescrollt, zeigt ein schwebendes Fenster eine Kopie mit Markierung und Hebelarm
let peekPointerY = 0;

function showFigurePeek(event) {
  if (event && Number.isFinite(event.clientY)) peekPointerY = event.clientY;
  const peek = $('figurePeek');
  const svg = $('figure').querySelector('svg');
  const rect = $('figure').getBoundingClientRect();
  // Oberkante des sichtbaren Bereichs: unter der Kopfzeile, solange sie oben klebt
  const topbar = document.querySelector('.topbar');
  const top = topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0;
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, top);
  if (!svg || visible > Math.min(rect.height, window.innerHeight - top) * 0.5) {
    peek.hidden = true;
    return;
  }
  const copy = svg.cloneNode(true);
  // keine doppelten IDs im Dokument: Verweise (Filter) zeigen dann auf die Originale in der Skizze
  copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  const info = activeTerm ? termInfo(activeTerm.dataset.term) : null;
  const focus = expandRefs([info && info.ref]);
  fadePeek(copy, info, focus);
  // nur den Ausschnitt um Last, Hebelarm und Drehpunkt zeigen: so wird er gross und lesbar
  const region = peekRegion(svg, focus);
  if (region) copy.setAttribute('viewBox', `${region.x} ${region.y} ${region.width} ${region.height}`);
  // Gegenüber dem Mauszeiger, damit das Fenster die Formel nicht verdeckt
  const atTop = peekPointerY > window.innerHeight / 2;
  peek.classList.toggle('at-top', atTop);
  peek.style.top = atTop ? `${top + 10}px` : '';
  peek.replaceChildren(copy);
  peek.hidden = false;
}

function hideTerm() {
  if (activeTerm) activeTerm.classList.remove('term-active');
  activeTerm = null;
  $('termTip').hidden = true;
  $('figurePeek').hidden = true;
  $('figurePeek').replaceChildren();
  removeLever();
  setHover(null);
  drawSelectionLever();
}

// Genau eine Einzel- oder Streckenlast gewählt: Hebelarm und Drehsinn um den aktuellen Drehpunkt
// dauerhaft zeigen (auch beim Ziehen, dann mit den neuen Werten).
function drawSelectionLever() {
  if (activeTerm) return;
  removeLever();
  if (!state.view.lever) return;
  const result = state.last && state.last.result;
  if (state.selection.length !== 1 || !state.selection[0].startsWith('L:') || !result || !result.ok) return;
  const index = result.steps.m.terms.findIndex((t) => t.ref === state.selection[0]);
  if (index < 0) return;
  const term = result.steps.m.terms[index];
  const info = termInfo(`m:${index}`);
  if (!info) return;
  // Trapezlast (Rechteck + Dreieck im Lösungsweg): hier die ganze Last mit der Resultierenden im Schwerpunkt
  const parts = result.steps.m.terms.filter((t) => t.ref === state.selection[0]);
  const load = parts.length > 1 ? result.resolved.qloads.find((q) => `L:${q.source}` === state.selection[0]) : null;
  if (load) {
    const moment = parts.reduce((s, t) => s + t.moment, 0);
    drawLever({ ...info, x: load.xc, lever: Math.abs(load.xc - info.pivotX), showMoment: true, moment, force: Math.abs(load.resultant), sense: Math.sign(moment) || 1 });
    return;
  }
  drawLever({ ...info, showMoment: true, moment: term.moment, force: term.force, sense: Math.sign(term.moment) || 1 });
}

// Tooltip neben dem Zeiger, immer mit 8 px Abstand im Bild (rechts und unten; sonst über dem Zeiger)
function positionTip(event) {
  const tip = $('termTip');
  if (tip.hidden) return;
  const viewW = document.documentElement.clientWidth;
  const viewH = document.documentElement.clientHeight;
  // zuerst links ansetzen, damit die Breite nach dem Umbruch gemessen wird
  tip.style.left = '8px';
  tip.style.top = '0px';
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.max(8, Math.min(viewW - w - 8, event.clientX + 14));
  let top = event.clientY + 18;
  if (top + h > viewH - 8) top = Math.max(8, event.clientY - h - 12);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ---------- Mauszeiger in der V- und M-Fläche ----------
// Senkrechte Linie durch beide Flächen, Punkt und Wert auf der Kurve, unten das Mass vom Trägeranfang
// bis zum Zeiger (und ab dem Lager links davon). Nahe einer Ereignisstelle (Last, Lager) rastet der
// Zeiger dort ein und zeigt den Sprung in V als „links → rechts“.
const cursorSvgs = () => [...$('diagrams').querySelectorAll('svg.diagram'), ...($('deflectionDiagram').hidden ? [] : $('deflectionDiagram').querySelectorAll('svg.diagram'))];

function diagramCursor(event) {
  const svg = event.target.closest && event.target.closest('#diagrams svg.diagram, #deflectionDiagram svg.diagram');
  const forces = state.last && state.last.forces;
  const layout = state.layout;
  if (!state.view.cursor || !svg || !forces || !forces.ok || !layout || drag) {
    hideDiagramCursor();
    return;
  }
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  const X = layout.X;
  const toX = (px) => layout.xmin + (px - layout.offsetX) / layout.scale;
  if (point.x < X(forces.xmin) - 12 || point.x > X(forces.xmax) + 12) {
    hideDiagramCursor();
    return;
  }
  // auf cm gerundet (wie man es abliest), an Ereignisstellen eingerastet
  let x = Math.min(forces.xmax, Math.max(forces.xmin, Math.round(toX(point.x) * 100) / 100));
  const snap = forces.events.find((e) => Math.abs(X(e.x) - point.x) <= 6);
  if (snap) {
    x = snap.x;
  } else {
    // auch an den markierten Werten der Fläche unter dem Zeiger: V = 0 in der V-Fläche, Mmax/Mmin (und V = 0)
    // in der M-Fläche, die Werte der Biegelinie (Feld, Kragarme) – dann zeigt der Cursor genau diesen Wert
    const kind = svg.dataset.kind;
    const zeros = forces.zeroCrossings.filter((z) => z.inSegment).map((z) => z.x);
    const marks = kind === 'V' ? zeros
      : kind === 'M' ? [...zeros, forces.mMax.x, forces.mMin.x]
        : kind === 'W' ? deflectionMarks().map((m) => m.x) : [];
    let near = null;
    for (const mx of marks) {
      const distance = Math.abs(X(mx) - point.x);
      if (Number.isFinite(mx) && distance <= 6 && (!near || distance < near.distance)) near = { x: mx, distance };
    }
    if (near) x = near.x;
  }
  const at = forces.valueAt(x);
  const w = deflectionAt(x);
  const values = {
    V: snap ? [snap.vLeft, snap.vRight] : [at.v],
    M: snap ? [snap.mLeft, snap.mRight] : [at.m],
    W: w === null ? [] : [w * 1000],
  };
  // am Trägerende gibt es nur eine Seite
  if (snap && Math.abs(x - forces.xmin) < 1e-9) { values.V = [snap.vRight]; values.M = [snap.mRight]; }
  if (snap && Math.abs(x - forces.xmax) < 1e-9) { values.V = [snap.vLeft]; values.M = [snap.mLeft]; }
  for (const kind of ['V', 'M']) {
    const list = values[kind];
    if (list.length === 2 && Math.abs(list[0] - list[1]) < 1e-9) list.pop();
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const f = (v) => label(Math.abs(v) < 1e-9 ? 0 : v, state.decimals);
  const px = X(x);
  const svgs = cursorSvgs();
  const hoverKind = svg.dataset.kind;
  const derive = state.view.derive;
  // Mass im Streifen unter der untersten Fläche (data-band), sonst in der letzten Fläche
  const dimSvg = [...svgs].reverse().find((s) => Number(s.dataset.band) > 0) || svgs[svgs.length - 1];
  svgs.forEach((s) => {
    const kind = s.dataset.kind;
    const base = Number(s.dataset.base);
    const max = Number(s.dataset.max);
    const amp = Number(s.dataset.amp);
    const width = s.viewBox.baseVal.width;
    const height = s.viewBox.baseVal.height;
    const band = Number(s.dataset.band) || 0;
    const contentHeight = height - band; // ohne den Streifen für das Mass
    const withDim = s === dimSvg;
    const dimY = height - 8; // Masslinie im Streifen
    const Yv = (v) => base + (v / max) * amp;
    const list = values[kind] || [];
    const unit = { V: 'kN', M: 'kNm', W: 'mm' }[kind] || '';
    const name = kind === 'W' ? 'w' : kind;
    const fmt = kind === 'W' ? (v) => label(Math.abs(v) < 1e-9 ? 0 : v, 1) : f;
    // Herleitung: beim Zeigen in die M-Fläche die Querkraftflächen bis zum Cursor in der V-Fläche,
    // in der M-Fläche die Tangente mit der Steigung V (dM/dx = V)
    const extra = derive && max > 0
      ? (kind === 'V' && hoverKind === 'M' ? shearAreaMarks(forces, x, X, base, Yv, r1, s) : kind === 'M' ? tangentMarks(values, x, forces, X, px, Yv, max, amp, r1) : { svg: '', boxes: [] })
      : { svg: '', boxes: [] };
    const parts = [extra.svg, `<line class="dc-line" x1="${r1(px)}" y1="${r1(base - amp - 16)}" x2="${r1(px)}" y2="${r1(withDim ? dimY + DIM_STYLE.extOver : base + amp + 16)}"/>`];
    for (const v of list) parts.push(`<circle class="dc-dot" cx="${r1(px)}" cy="${r1(Yv(v))}" r="4"/>`);
    // Wert als Plakette neben dem Punkt: erste Lage, die keine Beschriftung der Fläche und keinen Punkt überdeckt
    const content = `${name} = ${list.map(fmt).join(' → ')} ${unit}`;
    const w = pillWidth(content);
    const right = px < width / 2;
    const yMid = list.length ? Yv(list[list.length - 1]) : base;
    if (list.length) {
      const obstacles = [...diagramTextBoxes(s), ...extra.boxes, ...list.map((v) => ({ x: px - 6, y: Yv(v) - 6, width: 12, height: 12 }))];
      const sides = right ? [px + 10, px - 10 - w] : [px - 10 - w, px + 10];
      // zuerst neben dem Punkt; ist dort alles belegt (lange Zahlen), auch mittig über/unter dem Punkt und weiter weg
      const candidates = [];
      for (const dy of [-26, 8, -50, 32, -74, 56]) sides.forEach((x) => candidates.push([x, dy]));
      for (const dy of [-26, 8, -50, 32, -74, 56, -98, 80]) candidates.push([px - w / 2, dy]);
      for (const dy of [-98, 80]) sides.forEach((x) => candidates.push([x, dy]));
      let best = null;
      for (const [x, dy] of candidates) {
        const left = Math.min(width - w - 3, Math.max(3, x));
        const top = Math.min(contentHeight - 22, Math.max(2, yMid + dy));
        const box = { x: left, y: top, width: w, height: 20 };
        const hit = obstacles.reduce((sum, o) => sum + overlapArea(box, o, 2), 0);
        if (!best || hit < best.hit) best = { left, top, hit };
        if (hit === 0) break;
      }
      // dicht beschriftete Fläche: freie Lage im Raster suchen, möglichst nah am Punkt und nicht über dem Zeiger
      if (best.hit > 0) {
        let near = null;
        for (let top = 2; top <= contentHeight - 22; top += 6) {
          for (let left = 3; left <= width - w - 3; left += 8) {
            const box = { x: left, y: top, width: w, height: 20 };
            if (obstacles.some((o) => overlapArea(box, o, 2) > 0)) continue;
            const distance = Math.hypot(left + w / 2 - px, top + 10 - yMid) + (left < px && left + w > px ? 60 : 0);
            if (!near || distance < near.distance) near = { left, top, distance };
          }
        }
        if (near) best = { left: near.left, top: near.top, hit: 0 };
      }
      parts.push(`<g class="dc-pill"><rect x="${r1(best.left)}" y="${r1(best.top)}" width="${r1(w)}" height="20" rx="10"/><text x="${r1(best.left + w / 2)}" y="${r1(best.top + 14.3)}" text-anchor="middle">${escapeHtml(content)}</text></g>`);
    }
    // Mass beidseitig in der unteren Fläche: Trägeranfang bis Zeiger und Zeiger bis Trägerende,
    // dazu der Abstand zum nächsten Lager auf der jeweiligen Seite (wenn es nicht am Trägerende steht)
    if (withDim) {
      const y = dimY;
      const x0 = X(forces.xmin);
      const x1 = X(forces.xmax);
      // gleiche Vermassung wie in der Skizze (dimension.js): Schrägstriche, Masslinie mit Überstand,
      // kurze Hilfslinien an den Trägerenden, Masszahl über der Linie
      const tick = (tx) => dimSlash(tx, y);
      const reactions = state.last.result.reactions || [];
      const inside = (s2) => s2.x > forces.xmin + 1e-9 && s2.x < forces.xmax - 1e-9;
      const leftSupport = reactions.filter((s2) => inside(s2) && s2.x < x - 1e-9).sort((a, b) => b.x - a.x)[0];
      const rightSupport = reactions.filter((s2) => inside(s2) && s2.x > x + 1e-9).sort((a, b) => a.x - b.x)[0];
      const textWidth = (content) => dimTextWidth(content) + 4;
      const dist = (d) => `${length(d, state.decimals)} m`;
      // links: Trägeranfang bis Zeiger, rechts: Zeiger bis Trägerende; Text lang (mit Lagerabstand) und kurz
      const specs = [];
      if (x - forces.xmin > 1e-9) specs.push({ from: x0, to: px, side: 'left', short: dist(x - forces.xmin), long: `${dist(x - forces.xmin)}${leftSupport ? ` (${dist(x - leftSupport.x)} ab ${leftSupport.name})` : ''}` });
      if (forces.xmax - x > 1e-9) specs.push({ from: px, to: x1, side: 'right', short: dist(forces.xmax - x), long: `${dist(forces.xmax - x)}${rightSupport ? ` (${dist(rightSupport.x - x)} bis ${rightSupport.name})` : ''}` });
      // Masszahl über der Linie, mittig; passt sie nicht hinein, aussen neben das Mass; immer im Bild
      const placeText = (spec, content, forceOutside = false) => {
        const tw = textWidth(content);
        let tx = (spec.from + spec.to) / 2;
        let anchor = 'middle';
        if (forceOutside || Math.abs(spec.to - spec.from) < tw) {
          tx = spec.side === 'left' ? spec.from - 6 : spec.to + 6;
          anchor = spec.side === 'left' ? 'end' : 'start';
        }
        if (anchor === 'middle') tx = Math.min(width - 4 - tw / 2, Math.max(4 + tw / 2, tx));
        if (anchor === 'end' && tx - tw < 2) { tx = spec.to + 6; anchor = 'start'; }
        if (anchor === 'start' && tx + tw > width - 2) { tx = spec.from - 6; anchor = 'end'; }
        const left = anchor === 'middle' ? tx - tw / 2 : anchor === 'end' ? tx - tw : tx;
        return { content, tx, anchor, box: { x: left, y: y - 16, width: tw, height: 13 } };
      };
      const clash = (labels) => labels.length === 2 && overlapArea(labels[0].box, labels[1].box, 4) > 0;
      // Zwei Masszahlen dürfen sich nie berühren: erst ohne Lagerabstand, dann die kürzere aussen, sonst nur eine
      let labels = specs.map((spec) => placeText(spec, spec.long));
      if (clash(labels)) labels = specs.map((spec) => placeText(spec, spec.short));
      if (clash(labels)) {
        const shorter = Math.abs(specs[0].to - specs[0].from) < Math.abs(specs[1].to - specs[1].from) ? 0 : 1;
        labels[shorter] = placeText(specs[shorter], specs[shorter].short, true);
        if (clash(labels)) labels[shorter] = null;
      }
      if (specs.length) {
        const from = Math.min(...specs.map((spec) => spec.from));
        const to = Math.max(...specs.map((spec) => spec.to));
        for (const ex of [x0, x1]) parts.push(`<line class="dim-ext" x1="${r1(ex)}" y1="${r1(y - 12)}" x2="${r1(ex)}" y2="${r1(y + DIM_STYLE.extOver)}" stroke="${DIM_STYLE.ext}" stroke-width="1" shape-rendering="crispEdges"/>`);
        parts.push(dimLine(from - DIM_STYLE.lineOver, y, to + DIM_STYLE.lineOver, y));
      }
      specs.forEach((spec, i) => {
        const lab = labels[i];
        if (lab) parts.push(`<text class="dc-dim-text dim-text" x="${r1(lab.tx)}" y="${r1(y - DIM_STYLE.textGap)}" text-anchor="${lab.anchor}">${escapeHtml(lab.content)}</text>`);
      });
      if (x - forces.xmin > 1e-9) parts.push(tick(x0));
      if (forces.xmax - x > 1e-9) parts.push(tick(x1));
      parts.push(tick(px));
    }
    let layer = s.querySelector('g.diagram-cursor');
    if (!layer) {
      layer = document.createElementNS(SVG_NS, 'g');
      layer.setAttribute('class', 'diagram-cursor');
      s.appendChild(layer);
    }
    layer.innerHTML = parts.join('');
  });
  if (derive) showDerivePanel(hoverKind, x, snap, values, event);
  else hideDerivePanel();
}

// Querkraftflächen vom Trägeranfang bis x in der V-Fläche: blau (+, M nimmt zu), rot (−, M nimmt ab),
// jede mit ihrer Nummer A1, A2 … wie im Herleitungsfenster (gerundet 0 zählt nicht als eigene Fläche)
function shearAreaMarks(forces, x, X, base, Yv, r1, svg) {
  const parts = [];
  const boxes = [];
  const taken = diagramTextBoxes(svg);
  const free = (box) => ![...taken, ...boxes].some((o) => overlapArea(box, o, 1) > 0);
  for (const p of shearAreas(forces, x, 0.5 / 10 ** state.decimals)) {
    const xa = X(p.a);
    const xb = X(p.b);
    // Kante der Fläche: gerade (q gleichmässig) oder Parabel durch Anfang, Mitte und Ende (Trapezlast)
    const vq = (s) => p.va * (1 - s) * (1 - 2 * s) + 4 * p.vm * s * (1 - s) + p.vb * s * (2 * s - 1);
    const edge = p.shape === 'para'
      ? Array.from({ length: 13 }, (_, j) => `${r1(xa + ((xb - xa) * j) / 12)},${r1(Yv(vq(j / 12)))}`).join(' ')
      : `${r1(xa)},${r1(Yv(p.va))} ${r1(xb)},${r1(Yv(p.vb))}`;
    parts.push(`<polygon class="dc-area ${p.area > 0 ? 'pos' : 'neg'}" points="${r1(xa)},${r1(base)} ${edge} ${r1(xb)},${r1(base)}"/>`);
    const width = xb - xa;
    if (width < 5) continue;
    // Nummer mitten in der Fläche; ist sie zu flach oder zu schmal, kleiner und ausserhalb (über der Kurve
    // oder jenseits der Nulllinie) – nie auf einer Beschriftung oder einer anderen Nummer
    const far = Yv(p.shape === 'para' ? p.vm : (p.va + p.vb) / 2);
    const out = far > base ? 1 : -1; // Richtung der Fläche von der Nulllinie aus
    const cx = (xa + xb) / 2;
    const big = width >= 18;
    const radius = big ? 8.5 : 6.5;
    const spots = [];
    if (big && Math.abs(far - base) >= 20) spots.push((base + far) / 2);
    spots.push(base - out * (radius + 3), far + out * (radius + 3));
    const cy = spots.find((y) => free({ x: cx - radius - 1, y: y - radius - 1, width: 2 * radius + 2, height: 2 * radius + 2 }));
    if (cy === undefined) continue;
    parts.push(`<g class="dc-area-num${big ? '' : ' small'}"><circle cx="${r1(cx)}" cy="${r1(cy)}" r="${radius}"/><text x="${r1(cx)}" y="${r1(cy + (big ? 3.6 : 3))}" text-anchor="middle">${p.n}</text></g>`);
    boxes.push({ x: cx - radius - 1, y: cy - radius - 1, width: 2 * radius + 2, height: 2 * radius + 2 });
  }
  return { svg: parts.join(''), boxes };
}

// Tangente an der M-Linie am Cursor: Steigung = V (an einer Einzelkraft links und rechts verschieden)
function tangentMarks(values, x, forces, X, px, Yv, max, amp, r1) {
  const layout = state.layout;
  const slopes = values.V.length === 2 ? values.V : [values.V[0], values.V[0]];
  const mLeft = values.M[0];
  const mRight = values.M[values.M.length - 1];
  if (![...slopes, mLeft, mRight].every(Number.isFinite)) return { svg: '', boxes: [] };
  const k = (v) => ((v / max) * amp) / layout.scale; // Bildschirm-y pro Pixel in x
  // gleiche Länge (nicht gleiche Breite), damit eine steile Tangente nicht aus der Fläche schiesst
  const half = 46;
  const reach = (v) => half / Math.hypot(1, k(v));
  const xl = Math.max(X(forces.xmin), px - reach(slopes[0]));
  const xr = Math.min(X(forces.xmax), px + reach(slopes[1]));
  const parts = [];
  const boxes = [];
  const seg = (x1, y1, x2, y2) => {
    parts.push(`<line class="dc-tangent" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`);
    // für die Plakette: die Tangente als Hindernis (in drei Stücken, damit schräge Linien nicht zu viel sperren)
    for (let i = 0; i < 3; i++) {
      const ax = x1 + ((x2 - x1) * i) / 3;
      const ay = y1 + ((y2 - y1) * i) / 3;
      const bx = x1 + ((x2 - x1) * (i + 1)) / 3;
      const by = y1 + ((y2 - y1) * (i + 1)) / 3;
      boxes.push({ x: Math.min(ax, bx) - 2, y: Math.min(ay, by) - 2, width: Math.abs(bx - ax) + 4, height: Math.abs(by - ay) + 4 });
    }
  };
  if (px - xl > 1) seg(xl, Yv(mLeft) + k(slopes[0]) * (xl - px), px, Yv(mLeft));
  if (xr - px > 1) seg(px, Yv(mRight), xr, Yv(mRight) + k(slopes[1]) * (xr - px));
  return { svg: parts.join(''), boxes };
}

// Herleitungsfenster neben dem Mauszeiger: V nach dem Schnittprinzip (mit Skizze, rechts vom Schnitt
// abgedeckt), M aus den Querkraftflächen. Inhalt nur neu, wenn sich Stelle oder Rechnung ändern.
let deriveKey = '';
let deriveSketch = null;

function showDerivePanel(kind, x, snap, values, event) {
  const panel = $('derivePanel');
  const result = state.last && state.last.result;
  const forces = state.last && state.last.forces;
  const basis = kind === 'W' ? deflectionBasis() : null;
  if (!(kind === 'V' || kind === 'M' || (kind === 'W' && basis)) || !result || !result.ok || !forces || !forces.ok) {
    hideDerivePanel();
    return;
  }
  const atStart = Math.abs(x - forces.xmin) < 1e-9;
  // am Trägerende mit Kraft (Lager, Last an der Kragarmspitze): V links und der Sprung zurück auf 0 als Kontrolle
  const atEnd = Math.abs(x - forces.xmax) < 1e-9 && Math.abs(values.V[0]) > 1e-9;
  const side = kind === 'V' && (values.V.length === 2 || atEnd) ? 'both' : atStart ? 'right' : 'left';
  const key = `${kind}|${x}|${side}|${state.decimals}|${basis ? basis.EI : ''}`;
  const figureSvg = $('figure').querySelector('svg');
  if (key !== deriveKey || panel.__last !== state.last || panel.__figure !== figureSvg) {
    deriveKey = key;
    panel.__last = state.last;
    panel.__figure = figureSvg;
    // mit Skizze breiter, damit ihre Beschriftung lesbar bleibt
    panel.classList.toggle('wide', kind === 'V' || kind === 'W');
    panel.classList.remove('compact');
    const where = `x = ${length(x, state.decimals)} m`;
    if (kind === 'V') {
      panel.innerHTML = `<div class="dp-head"><b>Querkraft V</b> bei ${where} · Schnitt, alle Kräfte links davon</div><div class="dp-sketch figure-box"></div>`
        + `<div class="dp-body">${shearDerivation(result, forces, x, side, state.decimals)}</div>`;
      panel.querySelector('.dp-sketch').appendChild(deriveSketchAt(x, side));
    } else if (kind === 'W') {
      const ei = Math.round(basis.EI).toLocaleString('de-CH');
      panel.innerHTML = `<div class="dp-head"><b>Durchbiegung w</b> bei ${where} · Anteil jeder Last (Überlagerung)${basis.name ? ` · ${escapeHtml(basis.name)}` : ''}, EI = ${ei} kNm²</div>`
        + `<div class="dp-body">${deflectionDerivation(state.model, state.last, x, basis.EI, state.decimals)}</div>`;
    } else {
      const slopes = values.V.length === 2 ? values.V : [values.V[0]];
      const { html } = momentDerivation(result, forces, x, atStart, state.decimals, slopes);
      const jump = values.M.length === 2
        ? `<p class="dp-note">An der Stelle wirkt ein Einzelmoment: rechts davon ist M = ${label(values.M[1], state.decimals)} kNm.</p>`
        : '';
      panel.innerHTML = `<div class="dp-head"><b>Moment M</b> bei ${where} · Fläche unter der Querkraft bis zum Schnitt (in der V-Fläche: <span class="dp-pos">blau +</span>, <span class="dp-neg">rot −</span>)</div>`
        + `<div class="dp-body">${html}${jump}</div>`;
    }
    panel.hidden = false;
    // passt es nicht ganz auf den Bildschirm: Hinweise und Kontrolle weglassen, Skizze kleiner
    if (panel.scrollHeight > panel.clientHeight + 1) panel.classList.add('compact');
  }
  panel.hidden = false;
  placeDerivePanel(panel, kind, event);
}

// Kopie der Skizze, rechts vom Schnitt abgedeckt; die Kopie wird nur bei einer neuen Skizze neu gemacht
function deriveSketchAt(x, side) {
  const source = $('figure').querySelector('svg');
  const layout = state.layout;
  if (!source || !layout) return document.createElement('div');
  if (!deriveSketch || deriveSketch.source !== source) {
    const copy = source.cloneNode(true);
    copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    copy.querySelectorAll('.hl-layer, .hit-layer, .lever-layer, .drag-ghost, .grip, .grip-node, .grip-mid, .vertex, .pivot-toggle').forEach((element) => element.remove());
    copy.classList.remove('has-sel', 'has-hover', 'dragging', 'lever-focus');
    // nur der Träger mit Lasten, Lagern und Lagerkräften (ohne Vermassung und Kopfzeile): so wird er grösser
    let y1 = Infinity;
    let y2 = -Infinity;
    for (const element of source.querySelectorAll('[data-ref]')) {
      if (element.closest('.hit-layer, .hl-layer, .lever-layer')) continue;
      let box;
      try { box = element.getBBox(); } catch (error) { continue; }
      if (!(box.width > 0 || box.height > 0)) continue;
      y1 = Math.min(y1, box.y);
      y2 = Math.max(y2, box.y + box.height);
    }
    const full = source.viewBox.baseVal;
    if (Number.isFinite(y1) && y2 - y1 < full.height - 30) copy.setAttribute('viewBox', `${full.x} ${Math.round(y1 - 16)} ${full.width} ${Math.round(y2 - y1 + 26)}`);
    const cut = document.createElementNS(SVG_NS, 'g');
    cut.setAttribute('class', 'dp-cut');
    cut.innerHTML = '<rect class="dp-fade"/><line class="dp-cut-line"/><text class="dp-cut-text" text-anchor="middle">Schnitt</text>';
    copy.appendChild(cut);
    deriveSketch = { source, copy };
  }
  const { copy } = deriveSketch;
  const vb = copy.viewBox.baseVal;
  const cx = layout.X(x) + (side === 'right' ? 3 : -3);
  const beamY = state.top + (layout.zmax - state.last.forces.z0) * layout.scale;
  const rect = copy.querySelector('.dp-fade');
  rect.setAttribute('x', cx);
  rect.setAttribute('y', vb.y);
  rect.setAttribute('width', Math.max(0, vb.x + vb.width - cx));
  rect.setAttribute('height', vb.height);
  const cutLine = copy.querySelector('.dp-cut-line');
  cutLine.setAttribute('x1', cx);
  cutLine.setAttribute('x2', cx);
  cutLine.setAttribute('y2', Math.min(vb.y + vb.height, beamY + 44));
  const cutText = copy.querySelector('.dp-cut-text');
  cutText.setAttribute('x', Math.min(vb.x + vb.width - 24, Math.max(vb.x + 24, cx)));
  cutText.setAttribute('y', Math.max(vb.y + 11, beamY - 50));
  cutLine.setAttribute('y1', Math.max(vb.y + 14, beamY - 44));
  return copy;
}

// Das Fenster soll nichts verdecken, was zur Herleitung gehört: bei M die V-Fläche (mit den Teilflächen) und
// die M-Fläche, bei V die V-Fläche – davon nur der Teil links vom Cursor samt Plakette und Tangente, und nie
// den Zeiger selbst. Mehrere Lagen werden bewertet (verdeckte Fläche), bei Gleichstand gilt die Reihenfolge.
function placeDerivePanel(panel, kind, event) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const topbar = document.querySelector('.topbar');
  const top0 = (topbar ? Math.max(0, topbar.getBoundingClientRect().bottom) : 0) + 8;
  const cx = event && Number.isFinite(event.clientX) ? event.clientX : vw / 2;
  const cy = event && Number.isFinite(event.clientY) ? event.clientY : vh / 2;
  const kinds = kind === 'M' ? ['V', 'M'] : kind === 'W' ? ['W'] : ['V'];
  const rects = cursorSvgs().filter((s) => kinds.includes(s.dataset.kind)).map((s) => s.getBoundingClientRect());
  const keep = rects.map((r) => ({ x: r.left, y: r.top, width: Math.max(0, Math.min(r.right, cx + 80) - r.left), height: r.height }));
  const pointer = { x: cx - 30, y: cy - 30, width: 60, height: 60 };
  const keepTop = rects.length ? Math.min(...rects.map((r) => r.top)) : cy;
  const keepBottom = rects.length ? Math.max(...rects.map((r) => r.bottom)) : cy;
  const bestPlace = () => {
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const nearX = cx - w / 2;
    const candidates = [
      [nearX, keepBottom + 8], // unter den Flächen
      [nearX, keepTop - 8 - h], // darüber
      [cx + 70, cy - h / 2], // rechts vom Cursor
      [vw - w - 8, vh - h - 8],
      [vw - w - 8, top0],
      [8, vh - h - 8],
      [8, top0],
    ];
    let best = null;
    for (const [x0, y0] of candidates) {
      const box = {
        x: Math.min(Math.max(8, x0), Math.max(8, vw - w - 8)),
        y: Math.min(Math.max(top0, y0), Math.max(top0, vh - h - 8)),
        width: w,
        height: h,
      };
      const cost = keep.reduce((sum, r) => sum + overlapArea(box, r), 0) + 50 * overlapArea(box, pointer);
      if (!best || cost < best.cost - 1) best = { box, cost };
      if (cost === 0) break;
    }
    return best;
  };
  let best = bestPlace();
  // nirgends frei: kompakt (ohne Kontrolle und Hinweise) versuchen und nehmen, wenn es weniger verdeckt
  if (best.cost > 0 && !panel.classList.contains('compact')) {
    panel.classList.add('compact');
    const compact = bestPlace();
    if (compact.cost < best.cost) best = compact;
    else panel.classList.remove('compact');
  }
  panel.style.left = `${Math.round(best.box.x)}px`;
  panel.style.top = `${Math.round(best.box.y)}px`;
}

function hideDerivePanel() {
  const panel = $('derivePanel');
  if (panel && !panel.hidden) panel.hidden = true;
}

// Überdeckungsfläche zweier Rechtecke (mit Sicherheitsabstand)
function overlapArea(a, b, margin = 0) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + margin;
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + margin;
  return w > 0 && h > 0 ? w * h : 0;
}

// Beschriftungen einer Fläche (ohne die Zeiger-Schicht), einmal pro gezeichnetem SVG gemessen
const textBoxCache = new WeakMap();
function diagramTextBoxes(svg) {
  if (!textBoxCache.has(svg)) {
    textBoxCache.set(svg, [...svg.querySelectorAll('text')].filter((t) => !t.closest('g.diagram-cursor')).map((t) => t.getBBox()));
  }
  return textBoxCache.get(svg);
}

function hideDiagramCursor() {
  document.querySelectorAll('g.diagram-cursor').forEach((g) => g.remove());
  hideDerivePanel();
}

function initDiagramCursor() {
  const boxes = [$('diagrams'), $('deflectionDiagram')];
  for (const box of boxes) {
    box.addEventListener('pointermove', diagramCursor);
    box.addEventListener('pointerdown', diagramCursor);
    // Antippen (Touch): Cursor und Herleitung bleiben stehen, bis woanders hingetippt wird
    box.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') hideDiagramCursor();
    });
  }
  document.addEventListener('pointerdown', (event) => {
    if (!boxes.some((box) => box.contains(event.target))) hideDiagramCursor();
  });
  // beim Scrollen wandern die Flächen unter dem festen Fenster weg: ausblenden, die nächste Bewegung zeigt es neu
  window.addEventListener('scroll', () => {
    if (!$('derivePanel').hidden || document.querySelector('g.diagram-cursor')) hideDiagramCursor();
  }, { passive: true });
}

function initTermHover() {
  const solution = $('solution');
  solution.addEventListener('pointerover', (event) => {
    const element = event.target.closest('[data-term]');
    if (!element || element === activeTerm) return;
    if (activeTerm) hideTerm();
    showTerm(element, event);
  });
  solution.addEventListener('pointerout', (event) => {
    // Antippen (Touch): bleibt stehen, bis woanders hingetippt wird
    if (event.pointerType === 'touch') return;
    const element = event.target.closest('[data-term]');
    if (!element || (event.relatedTarget && element.contains(event.relatedTarget))) return;
    hideTerm();
  });
  solution.addEventListener('pointermove', (event) => { if (activeTerm) positionTip(event); });
  document.addEventListener('pointerdown', (event) => {
    if (activeTerm && event.pointerType === 'touch' && !event.target.closest('[data-term]')) hideTerm();
  });
  // Beim Scrollen das Fenster nachführen (Skizze kommt ins Bild oder verschwindet)
  window.addEventListener('scroll', () => { if (activeTerm) showFigurePeek(); }, { passive: true });
}

// ---------- Farbschema ----------

const THEME_KEY = 'staticulator-theme';
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABELS = { auto: '◐ Auto', light: '☀ Hell', dark: '☾ Dunkel' };
let themeMemory = 'auto';

function themeChoice() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEME_ORDER.includes(stored) ? stored : themeMemory;
  } catch (error) {
    return themeMemory;
  }
}

function applyTheme(choice) {
  themeMemory = choice;
  const dark = choice === 'dark' || (choice === 'auto' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('themeButton').textContent = THEME_LABELS[choice] || THEME_LABELS.auto;
}

// ---------- Cursor-Koordinaten (Haken „Koordinaten“) ----------

function hideCursorCoords() {
  const layer = $('figure').querySelector('.cursor-layer');
  if (layer) layer.remove();
}

// Fadenkreuz und Anzeige x | z in Metern am Mauszeiger, ohne die Skizze neu zu zeichnen.
function showCursorCoords(event) {
  state.lastPointer = { x: event.clientX, y: event.clientY };
  renderCursorLayer();
}

// Etikett am Mauszeiger: Koordinaten (Haken „Koordinaten“, mit Fadenkreuz) und beim Ziehen
// die Verschiebung Δx/Δz bzw. die Stablänge L. Wird nach jedem Neuzeichnen wieder eingesetzt.
function renderCursorLayer() {
  const svg = $('figure').querySelector('svg');
  const layout = state.layout;
  const pointer = state.lastPointer;
  const dragText = drag && drag.moved ? state.dragInfo : '';
  if (!svg || !pointer || (!state.view.coords && !dragText)) {
    hideCursorCoords();
    return;
  }
  const ctm = svg.getScreenCTM();
  if (!ctm || !layout || !Number.isFinite(state.top)) return;
  const point = new DOMPoint(pointer.x, pointer.y).matrixTransform(ctm.inverse());
  const x = layout.xmin + (point.x - layout.offsetX) / layout.scale;
  const z = layout.zmax - (point.y - state.top) / layout.scale;
  let layer = svg.querySelector('.cursor-layer');
  if (!layer) {
    layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'cursor-layer');
    layer.innerHTML = '<line class="cursor-line"/><line class="cursor-line"/><rect class="cursor-chip" rx="4" height="19"/><text class="cursor-text"/>';
    svg.appendChild(layer);
  }
  const [vertical, horizontal] = layer.querySelectorAll('line');
  const width = svg.viewBox.baseVal.width;
  const viewY = svg.viewBox.baseVal.y;
  const height = viewY + svg.viewBox.baseVal.height;
  const set = (element, attrs) => Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  const showLines = state.view.coords;
  set(vertical, { x1: point.x, y1: viewY, x2: point.x, y2: height, visibility: showLines ? 'visible' : 'hidden' });
  set(horizontal, { x1: 0, y1: point.y, x2: width, y2: point.y, visibility: showLines ? 'visible' : 'hidden' });
  const text = layer.querySelector('text');
  const coords = state.view.coords ? `x = ${label(x, 2)} m  ·  z = ${label(z, 2)} m` : '';
  text.textContent = [coords, dragText].filter(Boolean).join('   |   ');
  const chipWidth = text.getComputedTextLength() + 14;
  const left = point.x + 14 + chipWidth > width ? point.x - 14 - chipWidth : point.x + 14;
  const top = point.y + 16 + 19 > height ? point.y - 16 - 19 : point.y + 16;
  set(layer.querySelector('rect'), { x: left, y: top, width: chipWidth });
  set(text, { x: left + 7, y: top + 13.5 });
}

function init() {
  const select = $('exampleSelect');
  select.innerHTML = '<option value="">– eigenes System –</option>' + EXAMPLES.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('');

  const initial = initialModel();
  state.model = initial.model;
  state.exampleId = initial.exampleId;
  if (state.exampleId && !state.model.title) {
    const example = exampleById(state.exampleId);
    if (example) state.model.title = example.title;
  }

  renderInputs();
  // Bemessung (Träger, Stütze): eigene Karte, rechnet mit M, V und den Auflagerkräften des Systems
  initDesign({
    getDesign: () => state.model.design,
    getLast: () => state.last,
    getDecimals: () => state.decimals,
    getExplain: () => state.view.explain,
    getLayout: () => state.layout,
    getEnabled: () => state.view.design,
    setEnabled: (on) => { state.view.design = on; },
    onChange: storeModel,
  });
  update();
  // KaTeX wird als normales Skript geladen; falls es noch fehlt, nach dem Laden neu setzen.
  if (!window.katex) window.addEventListener('load', update, { once: true });

  const inputs = document.querySelector('.inputs');
  inputs.addEventListener('input', (event) => {
    const target = event.target;
    if (target.id === 'titleInput') {
      historyKey = 'title';
      state.model.title = target.value;
      scheduleUpdate();
      return;
    }
    if (target.matches('input[data-field]')) {
      const row = target.closest('tr[data-index]');
      const table = target.closest('table');
      historyKey = `${table ? table.id : ''}:${row ? row.dataset.index : ''}:${target.dataset.field}`;
      setField(target);
      state.exampleId = '';
      $('exampleSelect').value = '';
      scheduleUpdate();
    }
  });
  inputs.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('select[data-field]')) {
      setField(target);
      state.exampleId = '';
      $('exampleSelect').value = '';
      scheduleUpdate();
    } else if (target.matches('#loadTable input[data-field="value"], #loadTable input[data-field="value2"]')) {
      // Minus beim Verlassen des Feldes in die Pfeilrichtung übernehmen (↓ −50 wird ↑ 50; bei Trapezlasten
      // zählt der erste Wert ungleich 0)
      const row = target.closest('tr[data-index]');
      const index = row ? Number(row.dataset.index) : -1;
      const load = state.model.loads[index];
      const flipped = load ? positiveLoad(load) : load;
      if (load && flipped !== load) {
        state.model.loads[index] = flipped;
        const active = document.activeElement;
        const activeRow = active && active.closest && active.closest('#loadTable tr[data-index]');
        const keep = activeRow ? { index: activeRow.dataset.index, field: active.dataset.field } : null;
        historyKey = `loadTable:${index}:${target.dataset.field}`;
        renderLoadTable();
        if (keep && keep.field) {
          const again = document.querySelector(`#loadTable tr[data-index="${keep.index}"] [data-field="${keep.field}"]`);
          if (again) again.focus();
        }
        scheduleUpdate();
      }
    } else if (target.id === 'pivotSelect') {
      setPivot(target.value);
    } else if (target.matches('input[data-pivot]')) {
      setPivot(target.dataset.pivot);
    } else if (target.id === 'decimalsSelect') {
      state.decimals = Number(target.value);
      scheduleUpdate();
    }
  });
  inputs.addEventListener('click', (event) => {
    const issue = event.target.closest('button[data-goto]');
    if (issue) {
      gotoIssue(issue.dataset.goto);
      return;
    }
    // Klick irgendwo in eine Tabellenzeile (auch auf „A“, „P1“ oder in eine Lücke) wählt das Element an.
    // Eingabefelder und Auswahllisten erledigen das selbst über den Fokus.
    const row = event.target.closest('tr[data-index]');
    if (row && !event.target.closest('button, input, select, label')) setSelection([rowRef(row)], 'row');
    const button = event.target.closest('button[data-action]');
    if (button) handleAction(button.dataset.action, button);
  });
  // Zeile unter der Maus bzw. mit dem Cursor: zugehöriges Element in der Skizze markieren
  inputs.addEventListener('pointerover', (event) => {
    const row = event.target.closest('tr[data-index]');
    setHover(row ? rowRef(row) : null, 'table');
  });
  inputs.addEventListener('pointerleave', () => setHover(null));
  inputs.addEventListener('focusin', (event) => {
    const row = event.target.closest('tr[data-index]');
    if (row) setSelection([rowRef(row)], 'table');
  });
  inputs.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (next && next.closest && next.closest('tr[data-index]')) return;
    if (state.selectionSource === 'table') setSelection([], '');
  });

  select.addEventListener('change', () => {
    if (select.value) loadExample(select.value);
  });
  const figureBox = $('figure');
  figureBox.addEventListener('pointerdown', figurePointerDown);
  figureBox.addEventListener('click', (event) => {
    const dim = event.target.closest('[data-dim]');
    if (dim) openDimEditor(dim);
  });
  $('solution').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-pivot]');
    if (button) setPivot(button.dataset.pivot);
  });
  figureBox.addEventListener('pointermove', moveDrag);
  figureBox.addEventListener('pointerup', endDrag);
  figureBox.addEventListener('pointercancel', endDrag);
  figureBox.addEventListener('lostpointercapture', endDrag);
  figureBox.addEventListener('pointerover', (event) => {
    if (drag) return;
    const target = event.target.closest('[data-ref]');
    setHover(target ? target.getAttribute('data-ref') : null);
  });
  figureBox.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
  figureBox.addEventListener('pointermove', showCursorCoords);
  figureBox.addEventListener('pointerleave', () => {
    if (drag) return;
    state.lastPointer = null;
    hideCursorCoords();
  });

  // Farbschema: Auto (folgt dem System), Hell, Dunkel
  applyTheme(themeChoice());
  $('themeButton').addEventListener('click', () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themeChoice()) + 1) % THEME_ORDER.length];
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      // ohne Speicher gilt die Wahl nur bis zum Neuladen
    }
    applyTheme(next);
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeChoice() === 'auto') applyTheme('auto');
    });
  }
  document.addEventListener('keydown', (event) => {
    // Esc beim Ziehen: zurück auf die alte Lage
    if (event.key === 'Escape' && drag) {
      const snapshot = drag.snapshot;
      cancelDrag();
      if (snapshot) state.model = snapshot;
      renderAxisTable();
      renderSupportTable();
      renderLoadTable();
      scheduleUpdate();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && state.selection.length) {
      setSelection([], '');
      if (document.activeElement && document.activeElement.closest('tr[data-index]')) document.activeElement.blur();
      return;
    }
    // Pfeiltasten: Auswahl um einen Rasterschritt verschieben (mit Umschalttaste zehn)
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const typing = event.target && event.target.closest && event.target.closest('input, select, textarea, [contenteditable]');
    // Strg+Z / Strg+Y (Strg+Umschalt+Z): ganzes Modell; in einem Eingabefeld bleibt das Rückgängig des Felds
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !typing && (key === 'z' || key === 'y')) {
      stepHistory(key === 'z' && !event.shiftKey);
      event.preventDefault();
      return;
    }
    if (arrows[event.key] && state.selection.length && !drag && !typing) {
      const step = state.view.step * (event.shiftKey ? 10 : 1);
      historyKey = 'nudge';
      nudgeSelection(arrows[event.key][0] * step, arrows[event.key][1] * step);
      event.preventDefault();
    }
  });
  // Neue Kartenbreite (Fenstergrösse, Bildlaufleiste): Skizze und Diagramme 1:1 neu zeichnen
  if (window.ResizeObserver) {
    let lastWidth = figureWidth();
    new ResizeObserver(() => {
      const width = figureWidth();
      if (width !== lastWidth && !drag) {
        lastWidth = width;
        scheduleUpdate();
      }
    }).observe(figureBox);
  }
  // Ausdruck immer mit allen Massen und ohne Markierung
  window.addEventListener('beforeprint', () => {
    if (!state.selection.length && !state.hover) return;
    clearSelection();
    drawFigure();
  });

  // Darstellung der Skizze: Einrasten, Raster, Winkel
  $('snapCheck').checked = state.view.snap;
  $('snapPointsCheck').checked = state.view.snapPoints;
  $('snapPointsCheck').disabled = !state.view.snap;
  $('gridCheck').checked = state.view.grid;
  $('gridSelect').value = String(state.view.step);
  $('angleCheck').checked = state.view.angles;
  $('highlightSelect').value = state.view.highlight;
  $('dimCheck').checked = state.view.dim;
  $('coordCheck').checked = state.view.coords;
  $('leverCheck').checked = state.view.lever;
  // Cursor in den Flächen und die Herleitung dazu (V: Schnittprinzip, M: Querkraftflächen)
  $('cursorCheck').checked = state.view.cursor;
  $('deriveCheck').checked = state.view.derive;
  $('deriveCheck').disabled = !state.view.cursor;
  $('cursorCheck').addEventListener('change', (event) => {
    state.view.cursor = event.target.checked;
    $('deriveCheck').disabled = !state.view.cursor;
    storeModel();
    if (!state.view.cursor) hideDiagramCursor();
  });
  $('deriveCheck').addEventListener('change', (event) => {
    state.view.derive = event.target.checked;
    storeModel();
    // Flächen und Tangente gehören zur Herleitung: mit dem Fenster weg (die nächste Bewegung zeigt den Cursor neu)
    hideDiagramCursor();
  });
  $('scaleCheck').checked = state.view.scaleMode;
  // Alle Schritte des Lösungswegs auf- oder zuklappen
  $('stepsToggle').addEventListener('click', () => setAllSteps(anyClosed()));
  // Erklärmodus im Lösungsweg: „Warum?“-Boxen je Schritt
  $('explainCheck').checked = state.view.explain;
  $('explainCheck').addEventListener('change', (event) => {
    state.view.explain = event.target.checked;
    storeModel();
    scheduleUpdate();
  });
  initTermHover();
  initDiagramCursor();
  initPhotoImport({ apply: applyPhotoTask });
  initSelfCheck({ getLast: () => state.last, getDecimals: () => state.decimals });
  updateSelfCheck();
  // Farbschema der V- und M-Fläche (nur CSS, kein Neuzeichnen nötig)
  $('schemeSelect').value = state.view.scheme;
  $('diagrams').dataset.scheme = state.view.scheme;
  $('deflectionDiagram').dataset.scheme = state.view.scheme;
  $('schemeSelect').addEventListener('change', (event) => {
    state.view.scheme = event.target.value;
    $('diagrams').dataset.scheme = state.view.scheme;
    $('deflectionDiagram').dataset.scheme = state.view.scheme;
    storeModel();
  });
  initScaleCard();
  // Menüs „Ansicht“ und „Bild speichern“: schliessen bei einem Klick daneben und mit Esc
  for (const menu of [$('viewMenu'), $('exportMenu')]) {
    document.addEventListener('pointerdown', (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.open) return;
      menu.open = false;
      menu.querySelector('summary').focus();
      event.stopPropagation();
    });
    // Fokus per Tab aus dem Menü hinaus: Menü schliessen
    menu.addEventListener('focusout', (event) => {
      if (menu.open && event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
    });
  }
  $('exportMenu').addEventListener('click', (event) => {
    const button = event.target.closest('[data-export]');
    if (!button) return;
    $('exportMenu').open = false;
    saveImage(button.dataset.export);
  });
  document.querySelector('.figure-tools').addEventListener('change', (event) => {
    const target = event.target;
    if (target.id === 'highlightSelect') {
      state.view.highlight = HIGHLIGHTS.includes(target.value) ? target.value : 'frame';
      storeModel();
      applyHighlight();
      return;
    }
    if (target.id === 'scaleCheck') {
      // Massstab-Modus: Karte einblenden und die Skizze nach den Massstäben zeichnen
      state.view.scaleMode = target.checked;
      storeModel();
      renderScaleCard();
      scheduleFigure();
      return;
    }
    if (target.id === 'leverCheck') {
      state.view.lever = target.checked;
      storeModel();
      drawSelectionLever();
      return;
    }
    if (target.id === 'coordCheck') {
      state.view.coords = target.checked;
      storeModel();
      if (!target.checked) hideCursorCoords();
      return;
    }
    if (target.id === 'dimCheck') {
      state.view.dim = target.checked;
      storeModel();
      applyHighlight();
      return;
    }
    if (target.id === 'snapCheck') {
      state.view.snap = target.checked;
      $('snapPointsCheck').disabled = !target.checked;
    } else if (target.id === 'snapPointsCheck') state.view.snapPoints = target.checked;
    else if (target.id === 'gridCheck') state.view.grid = target.checked;
    else if (target.id === 'gridSelect') state.view.step = Number(target.value);
    else if (target.id === 'angleCheck') state.view.angles = target.checked;
    else return;
    storeModel();
    scheduleFigure();
  });

  $('newButton').addEventListener('click', () => {
    cancelDrag();
    rememberCurrent();
    const empty = emptyModel();
    state.model = sanitizeModel({ ...empty, design: fitDesign(state.model.design, empty, null) });
    resetSteps();
    state.exampleId = '';
    clearSelection();
    resetImport();
    history.replaceState(null, '', location.pathname + location.search);
    renderInputs();
    update();
  });
  $('undoButton').addEventListener('click', () => stepHistory(true));
  $('redoButton').addEventListener('click', () => stepHistory(false));
  $('shareButton').addEventListener('click', copyShareLink);
  $('saveButton').addEventListener('click', saveFile);
  $('openButton').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (event) => {
    openFile(event.target.files[0]);
    event.target.value = '';
  });
  $('printButton').addEventListener('click', () => window.print());
  renderRecent();
  $('recentSelect').addEventListener('change', (event) => {
    if (event.target.value !== '') restoreRecent(Number(event.target.value));
    renderRecent();
  });
  // Name für die Kopfzeile im Ausdruck (bleibt im Browser gespeichert); Kopfzeile vor jedem Drucken füllen
  const NAME_KEY = 'staticulator-name';
  try { $('nameInput').value = localStorage.getItem(NAME_KEY) || ''; } catch (error) { /* ohne Speicher */ }
  $('nameInput').addEventListener('input', () => {
    try { localStorage.setItem(NAME_KEY, $('nameInput').value.trim()); } catch (error) { /* ohne Speicher */ }
  });
  window.addEventListener('beforeprint', () => {
    const name = $('nameInput').value.trim();
    $('printTitle').textContent = state.model.title || 'Träger auf zwei Auflagern';
    $('printName').textContent = name;
    $('printName').classList.toggle('blank', !name);
    $('printDate').textContent = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  });
  window.addEventListener('hashchange', () => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash.startsWith('m=')) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const linked = decodeModel(hash.slice(2));
      rememberCurrent();
      state.model = linked;
      state.exampleId = '';
      cancelDrag();
      clearSelection();
      renderInputs();
      update();
    } catch (error) {
      toast('Der Link enthält kein gültiges System.');
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
