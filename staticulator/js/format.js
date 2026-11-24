// Zahlen lesen und formatieren.

// Liest eine Benutzereingabe: Komma oder Punkt als Dezimaltrennzeichen, ' als Tausendertrenner.
// Leere Eingabe → null, ungültige Eingabe → NaN.
export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : NaN;
  const t = String(text).trim().replace(/[’'\s]/g, '').replace(',', '.').replace('−', '-');
  if (t === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  const value = Number(t);
  return Number.isFinite(value) ? value : NaN;
}

// Fester Dezimalstellen-Text ohne „-0.00“.
export function fixed(value, decimals = 2) {
  if (!Number.isFinite(value)) return '–';
  const limit = 0.5 * Math.pow(10, -decimals);
  const v = Math.abs(value) < limit ? 0 : value;
  return v.toFixed(decimals);
}

// Für Eingabefelder: kurze Darstellung ohne überflüssige Nullen.
export function plain(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(Math.round(value * 1e6) / 1e6);
}

// Text mit echtem Minuszeichen für Grafiken.
export function label(value, decimals = 2) {
  return fixed(value, decimals).replace('-', '−');
}

// Kurzform für Masse: 2.5 statt 2.50, aber höchstens drei Nachkommastellen.
export function measure(value) {
  if (!Number.isFinite(value)) return '–';
  let rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded) < 1e-9) rounded = 0;
  const twoDecimals = Math.abs(rounded - Math.round(rounded * 100) / 100) < 1e-9;
  return rounded.toFixed(twoDecimals ? 2 : 3).replace('-', '−');
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Bezeichnung wie „F1“ → TeX „F_{1}“, „A_z“ → „A_{z}“.
export function texName(name) {
  const text = String(name);
  const underscore = text.indexOf('_');
  if (underscore > 0) return `${texText(text.slice(0, underscore))}_{${texText(text.slice(underscore + 1))}}`;
  const match = text.match(/^([A-Za-z]+)(\d+)$/);
  if (match) return `${match[1]}_{${match[2]}}`;
  return texText(text);
}

function texText(text) {
  if (/^[A-Za-z]$/.test(text)) return text;
  return `\\text{${text.replace(/[\\{}$&#^_%~]/g, '')}}`;
}

// Name mit Index als HTML: „F_A“ → F<sub>A</sub>, „B_z“ → B<sub>z</sub>.
export function htmlName(name) {
  const text = String(name);
  const i = text.indexOf('_');
  if (i <= 0 || i === text.length - 1) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, i))}<sub>${escapeHtml(text.slice(i + 1))}</sub>`;
}
