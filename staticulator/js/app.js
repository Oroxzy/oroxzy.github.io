// StatiCulator Web – Oberfläche
import { solve, internalForces, resolveModel, axisZAt } from './statik.js';
import { renderFigure } from './figure.js';
import { renderDiagrams } from './diagrams.js';
import { renderSolution, renderMessages } from './solution.js';
import { EXAMPLES, exampleById, emptyModel } from './examples.js';
import { parseNumber, plain, escapeHtml, label, fixed, htmlName, length } from './format.js';
import { initDesign, updateDesign, renderDesignForm, sanitizeDesign } from './design-ui.js';

const STORAGE_KEY = 'staticulator-web-model-v1';
const DIRECTION_OPTIONS = {
  F: [['down', '↓'], ['up', '↑'], ['right', '→'], ['left', '←']],
  q: [['down', '↓'], ['up', '↑']],
};

const state = {
  model: null,
  decimals: 2,
  exampleId: '',
  view: { snap: true, snapPoints: true, grid: false, step: 0.05, angles: true, highlight: 'frame', dim: true, coords: false, scale: null, scheme: 'family', scaleMode: false, explain: false, lever: true, design: false },
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
      return { kind: 'q', dir: l.dir === 'up' ? 'up' : 'down', value: numberOrNull(l.value), x1: numberOrNull(l.x1), x2: numberOrNull(l.x2), name: typeof l.name === 'string' ? l.name.slice(0, 20) : '' };
    }
    const dir = ['down', 'up', 'right', 'left'].includes(l && l.dir) ? l.dir : 'down';
    return { kind: 'F', dir, value: numberOrNull(l && l.value), x: numberOrNull(l && l.x), z: numberOrNull(l && l.z), name: typeof (l && l.name) === 'string' ? l.name.slice(0, 20) : '' };
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
  if (Number.isInteger(stored.decimals)) state.decimals = Math.min(3, Math.max(0, stored.decimals));
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
    field.title = `Name wie in der Aufgabe, z. B. F_A, G oder Q_1 (Unterstrich = Index). Leer: ${label}`;
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
      <td><label class="cell"><span>${isQ ? 'kN/m' : 'kN'}</span>${input('value', l.value)}</label></td>
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
  storeModel();
  recordHistory();
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
    if (!num(l.value)) add('error', 'load', i, 'value', `${name}: Wert ${missing(l.value)}.`);
    else if (l.value === 0) add('warn', 'load', i, 'value', `${name}: Der Wert ist 0, die Last wirkt nicht.`);
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
  const optional = field === 'z' && table.id !== 'axisTable';
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
  // Die Einstellungen der Bemessung (Profilreihe, Stahlsorte …) bleiben beim Beispielwechsel erhalten;
  // Tab und Werkstoff passen sich dem Beispiel an
  state.model = sanitizeModel({ design: fitDesign(state.model.design, example.model, example.design), ...clone(example.model), title: example.title });
  state.exampleId = id;
  clearSelection();
  history.replaceState(null, '', location.pathname + location.search);
  renderInputs();
  update();
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

function openFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      cancelDrag();
      state.model = sanitizeModel(data.model || data);
      state.exampleId = '';
      clearSelection();
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
    ...resolved.qloads.map((q) => [`${htmlName(q.label)} (Resultierende ${fixed(q.value, 2)} kN/m · ${fixed(q.length, 2)} m)`, `${fixed(Math.abs(q.resultant), 2)} kN`, `${toCm(Math.abs(q.resultant), scales.force)} cm`]),
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
    table(`Höhen (1 cm ≙ ${plain(scales.length)} m)`, ['Niveau', 'z', 'über tiefstem'], heightRows),
    table(`Kräfte (1 cm ≙ ${plain(scales.force)} kN)`, ['Kraft', 'Wert', 'Pfeil'], rows(forceRows)),
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
    const what = t.kind === 'q'
      ? `${t.label}: ${f(t.q)} kN/m · ${length(t.length, state.decimals)} m = ${f(t.force)} kN, Resultierende in der Mitte (x = ${length(t.x, state.decimals)} m)`
      : `${name(t.label)} = ${f(t.force)} kN ${dirWord[t.dir] || ''}`;
    return {
      ref: t.ref, ...pivot, x: t.x, z: t.z, vertical: t.kind === 'v' || t.kind === 'q', lever: t.lever, sense: Math.sign(t.moment), resultant: t.kind === 'q',
      text: `${what} · Hebelarm ${length(t.lever, state.decimals)} m bis ${m.pivot} · ${senseText(t.moment)}`,
    };
  }
  if (group === 'v' && v.terms[index]) {
    const t = v.terms[index];
    const what = t.q !== undefined ? `${t.label}: ${f(t.q)} kN/m · ${length(t.length, state.decimals)} m = ${f(Math.abs(t.value))} kN` : `${name(t.label)} = ${f(Math.abs(t.value))} kN`;
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
  if (svg) svg.classList.remove('lever-focus');
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

// Wirkungslinie (gestrichelt), Hebelarm (kräftiger Doppelpfeil mit Farbband und Plakette), Drehpunkt
// (gefüllter Ring mit Hof) und bei gewählter Last der Drehsinn als Bogenpfeil mit dem Moment.
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
  const head = (x, y, angle, size = 10) => {
    const p1 = [x - size * Math.cos(angle - 0.42), y - size * Math.sin(angle - 0.42)];
    const p2 = [x - size * Math.cos(angle + 0.42), y - size * Math.sin(angle + 0.42)];
    const n = [x - size * 0.72 * Math.cos(angle), y - size * 0.72 * Math.sin(angle)];
    return `<path class="lv-fill" d="M${r1(x)},${r1(y)} L${r1(p1[0])},${r1(p1[1])} L${r1(n[0])},${r1(n[1])} L${r1(p2[0])},${r1(p2[1])} Z"/>`;
  };
  // Hebelarm: helles Band, darauf der kräftige Doppelpfeil
  const lever = (x1, y1, x2, y2) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    return line(x1, y1, x2, y2, 'lv-band') + line(x1, y1, x2, y2, 'lv-arm') + head(x2, y2, angle) + head(x1, y1, angle + Math.PI);
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
  let momentAt = null; // Stelle für die Plakette mit dem Moment
  // Hebelarm wie ein Mass knapp neben dem Drehpunkt (nicht auf dem Träger), mit Hilfslinien
  if (info.vertical) {
    const ly = py + 26;
    parts.push(line(fx, Math.min(fy, ly), fx, Math.max(fy, ly), 'lv-action'));
    if (Math.abs(fx - px) > 2) {
      parts.push(line(px, py, px, ly + 5, 'lv-help'), lever(fx, ly, px, ly), pill((fx + px) / 2, ly - 15, leverText));
    }
    momentAt = { x: (fx + px) / 2, y: ly + 18, anchor: 'middle' };
    if (info.resultant) parts.push(`<circle class="lv-fill" cx="${r1(fx)}" cy="${r1(fy)}" r="4.5"/>`, pill(fx, fy - 17, 'R'));
  } else {
    const lx = px + 28;
    parts.push(line(Math.min(fx, lx), fy, Math.max(fx, lx), fy, 'lv-action'));
    if (Math.abs(fy - py) > 2) {
      parts.push(line(px, py, lx + 5, py, 'lv-help'), lever(lx, fy, lx, py), pill(lx + 9, (fy + py) / 2, leverText, 'start'));
    }
    momentAt = { x: lx + 9, y: (fy + py) / 2 + 24, anchor: 'start' };
  }
  // Drehpunkt: Hof, Ring und Mittelpunkt
  parts.push(`<circle class="lv-halo" cx="${r1(px)}" cy="${r1(py)}" r="13"/>`, `<circle class="lv-ring" cx="${r1(px)}" cy="${r1(py)}" r="7.5"/>`, `<circle class="lv-fill" cx="${r1(px)}" cy="${r1(py)}" r="2.6"/>`);
  // Drehsinn um den Drehpunkt (bei gewählter Last): Bogenpfeil über dem Drehpunkt und Moment
  if (info.showMoment) {
    if (!(info.lever > 1e-9) || !Number.isFinite(info.moment) || Math.abs(info.moment) < 1e-9) {
      parts.push(pill(px, py - 24, 'Hebelarm 0: geht durch den Drehpunkt, kein Moment'));
    } else {
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
      const f = (value) => fixed(value, state.decimals);
      const content = `M = ${f(info.force)} · ${length(info.lever, state.decimals)} = ${f(Math.abs(info.moment))} kNm ${cw ? '↷' : '↶'}`;
      parts.push(pill(momentAt.x, momentAt.y, content, momentAt.anchor));
    }
  }
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', `lever-layer ${info.sense > 0 ? 'cw' : 'ccw'}`);
  layer.innerHTML = parts.join('');
  svg.appendChild(layer);
  // Der Rest der Skizze tritt zurück, solange der Hebelarm gezeigt wird
  svg.classList.add('lever-focus');
}

let activeTerm = null;

function showTerm(element, event) {
  const info = termInfo(element.dataset.term);
  if (!info) return;
  activeTerm = element;
  element.classList.add('term-active');
  if (info.ref) setHover(info.ref, 'solution');
  if (info.lever !== undefined) drawLever(info);
  const tip = $('termTip');
  tip.textContent = info.text;
  tip.hidden = false;
  positionTip(event);
  showFigurePeek(event);
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
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
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
  drawLever({ ...info, showMoment: true, moment: term.moment, force: term.force, sense: Math.sign(term.moment) || 1 });
}

function positionTip(event) {
  const tip = $('termTip');
  if (tip.hidden) return;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${event.clientY + 18}px`;
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
  $('scaleCheck').checked = state.view.scaleMode;
  // Erklärmodus im Lösungsweg: „Warum?“-Boxen je Schritt
  $('explainCheck').checked = state.view.explain;
  $('explainCheck').addEventListener('change', (event) => {
    state.view.explain = event.target.checked;
    storeModel();
    scheduleUpdate();
  });
  initTermHover();
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
  // Menü „Ansicht“: schliesst bei einem Klick daneben und mit Esc
  const viewMenu = $('viewMenu');
  document.addEventListener('pointerdown', (event) => {
    if (viewMenu.open && !viewMenu.contains(event.target)) viewMenu.open = false;
  });
  viewMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !viewMenu.open) return;
    viewMenu.open = false;
    viewMenu.querySelector('summary').focus();
    event.stopPropagation();
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
    const empty = emptyModel();
    state.model = sanitizeModel({ ...empty, design: fitDesign(state.model.design, empty, null) });
    state.exampleId = '';
    clearSelection();
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
  window.addEventListener('hashchange', () => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash.startsWith('m=')) return;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      state.model = decodeModel(hash.slice(2));
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
