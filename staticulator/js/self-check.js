// „Eigene Lösung prüfen“: Lagerkräfte und Momente aus der Handrechnung eintragen und mit der Rechnung der App
// vergleichen. Rückmeldung pro Wert: stimmt, fast (Rundung), Richtung falsch oder daneben (mit Abweichung).
import { parseNumber, fixed, escapeHtml, htmlName } from './format.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { getLast, getDecimals }
let values = {}; // Eingaben je Feld (bleiben beim Neuzeichnen stehen)
let shown = false; // Lösung eingeblendet
let checked = false; // schon einmal geprüft: dann bei jeder Änderung neu bewerten
let lastKeys = '';

export function initSelfCheck(context) {
  ctx = context;
  const fields = $('selfCheckFields');
  fields.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-key]');
    if (!input) return;
    values[input.dataset.key] = input.value;
    if (checked) evaluate();
  });
  fields.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.closest('input[data-key]')) {
      event.preventDefault();
      checked = true;
      evaluate();
    }
  });
  $('selfCheckRun').addEventListener('click', () => {
    checked = true;
    evaluate();
  });
  $('selfCheckShow').addEventListener('click', () => {
    shown = !shown;
    evaluate();
  });
  $('selfCheckClear').addEventListener('click', clearSelfCheck);
}

// anderes System geladen: Eingaben gehören nicht mehr dazu
export function clearSelfCheck() {
  values = {};
  shown = false;
  checked = false;
  if (ctx) updateSelfCheck(true);
}

// Felder aus dem aktuellen Ergebnis: Lagerkräfte (x nur beim festen Lager) und, wo vorhanden, M_max und M_min
function targets() {
  const { result, forces } = ctx.getLast() || {};
  if (!result || !result.ok) return [];
  const list = [];
  for (const r of result.reactions || []) {
    if (r.hasRx) list.push({ key: `${r.name}x`, label: htmlName(`${r.name}_x`), unit: 'kN', value: r.Rx });
    list.push({ key: `${r.name}z`, label: htmlName(`${r.name}_z`), unit: 'kN', value: r.Rz });
  }
  if (forces && forces.ok) {
    if (forces.mMax && forces.mMax.m > 1e-9) list.push({ key: 'Mmax', label: 'M<sub>max</sub>', unit: 'kNm', value: forces.mMax.m, hint: `bei x = ${fixed(forces.mMax.x, 2)} m` });
    if (forces.mMin && forces.mMin.m < -1e-9) list.push({ key: 'Mmin', label: 'M<sub>min</sub>', unit: 'kNm', value: forces.mMin.m, hint: `bei x = ${fixed(forces.mMin.x, 2)} m` });
  }
  return list;
}

export function updateSelfCheck(force = false) {
  if (!ctx) return;
  const list = targets();
  $('selfCheck').hidden = !list.length;
  const keys = list.map((t) => t.key).join('|');
  if (force || keys !== lastKeys) {
    lastKeys = keys;
    $('selfCheckFields').innerHTML = list.map((t) => `<label class="self-check-row"><span class="self-check-name">${t.label}</span>`
      + `<input type="text" inputmode="decimal" data-key="${t.key}" value="${escapeHtml(values[t.key] || '')}" placeholder="?" autocomplete="off">`
      + `<span class="self-check-unit">${t.unit}</span><span class="self-check-verdict" data-verdict="${t.key}"></span></label>`).join('');
  }
  evaluate(list);
}

function evaluate(list = targets()) {
  const decimals = Math.max(2, ctx.getDecimals());
  let filled = 0;
  let right = 0;
  for (const t of list) {
    const cell = document.querySelector(`[data-verdict="${t.key}"]`);
    const input = document.querySelector(`input[data-key="${t.key}"]`);
    if (!cell || !input) continue;
    const solution = `${fixed(t.value, decimals)} ${t.unit}${t.hint ? ` ${t.hint}` : ''}`;
    const entered = parseNumber(values[t.key] ?? '');
    let html = '';
    let state = '';
    if (entered === null || !checked) {
      html = shown ? `<span class="sc-solution">${escapeHtml(solution)}</span>` : '';
    } else if (Number.isNaN(entered)) {
      html = 'keine Zahl';
      state = 'bad';
    } else {
      filled++;
      const diff = entered - t.value;
      const tol = Math.max(0.01, Math.abs(t.value) * 0.005);
      const near = Math.max(0.05, Math.abs(t.value) * 0.02);
      if (Math.abs(diff) <= tol) {
        html = '✓ stimmt';
        state = 'good';
        right++;
      } else if (Math.abs(diff) <= near) {
        html = '≈ fast – Rundung?';
        state = 'near';
        right++;
      } else if (Math.abs(entered + t.value) <= Math.max(tol, near) && Math.abs(t.value) > 1e-9) {
        html = '✕ Betrag stimmt, Richtung bzw. Vorzeichen falsch';
        state = 'bad';
      } else {
        html = `✕ daneben um ${diff > 0 ? '+' : '−'}${fixed(Math.abs(diff), decimals)} ${t.unit}`;
        state = 'bad';
      }
      if (shown) html += ` <span class="sc-solution">richtig: ${escapeHtml(solution)}</span>`;
    }
    cell.innerHTML = html;
    cell.className = `self-check-verdict${state ? ` ${state}` : ''}`;
    input.classList.toggle('sc-good', state === 'good' || state === 'near');
    input.classList.toggle('sc-bad', state === 'bad');
  }
  $('selfCheckShow').textContent = shown ? 'Lösung verbergen' : 'Lösung zeigen';
  $('selfCheckSummary').textContent = checked && filled
    ? `${right} von ${filled} ${filled === 1 ? 'Wert stimmt' : 'Werten stimmen'}${right === filled ? ' – sauber gerechnet!' : '.'}`
    : '';
}
