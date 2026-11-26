// Herleitung am Mauszeiger in den Flächen (Haken „Herleitung“): wie V und M an der Stelle x zustande kommen.
// V nach dem Schnittprinzip: Summe aller Vertikalkräfte links vom Schnitt (nach oben positiv).
// M als Summe der Querkraftflächen vom Trägeranfang bis zum Schnitt (dM/dx = V), dazu die Momentensumme
// links vom Schnitt als Kontrolle. Reine Rechnung und HTML, das Zeichnen macht app.js.
import { tex as renderTex } from './solution.js';
import { fixed, texName, htmlName, length } from './format.js';
import { solve, internalForces } from './statik.js';
import { deflection } from './bemessung.js';

const EPS = 1e-9;

// KaTeX zwischenspeichern: beim Fahren mit der Maus ändern sich meist nur die letzte Fläche und die Summe
const texCache = new Map();
function tex(source) {
  let html = texCache.get(source);
  if (html === undefined) {
    if (texCache.size > 500) texCache.clear();
    html = renderTex(source);
    texCache.set(source, html);
  }
  return html;
}
const unit = (u) => `\\,\\text{${u}}`;

// Glieder mit Vorzeichen zu einer Summe verbinden: [+a, −b] → „a − b“
function joinSigned(items) {
  let out = '';
  items.forEach((item, index) => {
    const negative = item.sign < 0;
    if (index === 0) out += negative ? `-${item.body}` : item.body;
    else out += negative ? ` - ${item.body}` : ` + ${item.body}`;
  });
  return out || '0';
}

// Vertikalkräfte links vom Schnitt bei x. inclusive: Kräfte genau an der Stelle zählen mit (Wert rechts der Stelle).
export function cutForces(result, forces, x, inclusive) {
  const { points, qloads } = result.resolved;
  const left = (px) => (inclusive ? px <= x + EPS : px < x - EPS);
  const items = [];
  for (const r of result.reactions) {
    if (Math.abs(r.Rz) > EPS && left(r.x)) items.push({ kind: 'R', name: `${r.name}_z`, fz: r.Rz, x: r.x });
  }
  for (const p of points) {
    if (Math.abs(p.fz) > EPS && left(p.x)) items.push({ kind: 'F', name: p.label, fz: p.fz, x: p.x });
  }
  for (const q of qloads) {
    const a = Math.max(q.x1, forces.xmin);
    const b = Math.min(q.x2, x);
    if (b - a <= 1e-9) continue;
    // Trapezlast: q an beiden Enden des Stücks links vom Schnitt, Resultierende im Schwerpunkt des Trapezes
    const q2 = q.qz2 ?? q.qz;
    const qAt = (s) => q.qz + ((q2 - q.qz) * (s - q.x1)) / (q.x2 - q.x1);
    const qa = qAt(a);
    const qb = qAt(b);
    const len = b - a;
    const fz = ((qa + qb) / 2) * len;
    if (Math.abs(fz) <= EPS) continue;
    const centroid = Math.abs(qa + qb) > EPS ? a + (len * (qa + 2 * qb)) / (3 * (qa + qb)) : (a + b) / 2;
    items.push({ kind: 'q', name: q.label, q: qa, qb, trapez: Math.abs(qa - qb) > EPS, len, fz, x: centroid });
  }
  items.sort((u, v) => u.x - v.x);
  // Einzelmomente aus Kräften neben der Achse (Stiel, Konsole, Stütze): wirken nur auf M
  const couples = forces.couples.filter((c) => left(c.x));
  return { items, couples };
}

// Querkraftflächen vom Trägeranfang bis x, an Nullstellen von V geteilt (jedes Stück hat ein Vorzeichen).
// minArea: kleinere Stücke weglassen (für die Anzeige: was gerundet 0 ist, bekommt keine eigene Nummer)
export function shearAreas(forces, x, minArea = 1e-9) {
  const pieces = [];
  for (const s of forces.segments) {
    if (s.a >= x - EPS) break;
    const end = Math.min(s.b, x);
    const k = s.k || 0;
    // V im Abschnitt: gerade (q gleichmässig) oder Parabel (Trapezlast); F ist die Fläche ab Abschnittsanfang
    const vAt = (t) => s.v0 + s.q * (t - s.a) + (k * (t - s.a) ** 2) / 2;
    const F = (t) => s.v0 * (t - s.a) + (s.q * (t - s.a) ** 2) / 2 + (k * (t - s.a) ** 3) / 6;
    const cuts = [s.a];
    if (Math.abs(k) > EPS) {
      const disc = s.q * s.q - 2 * k * s.v0;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        for (const t of [(-s.q - root) / k, (-s.q + root) / k].sort((u, w) => u - w)) {
          if (s.a + t > s.a + 1e-7 && s.a + t < end - 1e-7) cuts.push(s.a + t);
        }
      }
    } else if (Math.abs(s.q) > EPS) {
      const zero = s.a - s.v0 / s.q;
      if (zero > s.a + 1e-7 && zero < end - 1e-7) cuts.push(zero);
    }
    cuts.push(end);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1];
      const b = cuts[i];
      const va = vAt(a);
      const vb = vAt(b);
      const vm = vAt((a + b) / 2);
      const area = F(b) - F(a);
      if (Math.abs(area) < minArea) continue;
      const shape = Math.abs(k) > EPS ? 'para' : Math.abs(va - vb) < 1e-9 ? 'rect' : Math.abs(va) < 1e-9 || Math.abs(vb) < 1e-9 ? 'tri' : 'trap';
      pieces.push({ a, b, va, vb, vm, area, shape });
    }
  }
  return pieces.map((p, i) => ({ ...p, n: i + 1 }));
}

const line = (source) => `<div class="dp-line">${tex(source)}</div>`;
// Streckenlast links vom Schnitt: gleichmässig q, beim Trapez der Mittelwert (q links + q rechts) / 2
const qName = (i) => (i.trapez ? `\\overline{${texName(i.name)}}` : texName(i.name));
// Dreieck (ein Ende 0): ½ · q statt (0 + q) / 2
const qNumber = (i, decimals) => {
  if (!i.trapez) return fixed(Math.abs(i.q), decimals);
  if (Math.abs(i.q) < EPS || Math.abs(i.qb) < EPS) return `\\tfrac{1}{2} \\cdot ${fixed(Math.max(Math.abs(i.q), Math.abs(i.qb)), decimals)}`;
  return `\\tfrac{${fixed(Math.abs(i.q), decimals)} + ${fixed(Math.abs(i.qb), decimals)}}{2}`;
};
// Einzelmoment aus einer Kraft neben der Achse: ΔM mit dem Namen der Kraft
const coupleName = (c) => `\\Delta M_{${texName(c.label)}}`;

// V links vom Schnitt als Summe (Namen, dann Zahlen)
function shearSum(items, decimals) {
  const len = (v) => length(v, decimals);
  const names = joinSigned(items.map((i) => ({ sign: Math.sign(i.fz), body: i.kind === 'q' ? `${qName(i)} \\cdot ${len(i.len)}` : texName(i.name) })));
  const numbers = joinSigned(items.map((i) => ({ sign: Math.sign(i.fz), body: i.kind === 'q' ? `${qNumber(i, decimals)} \\cdot ${len(i.len)}` : fixed(Math.abs(i.fz), decimals) })));
  const value = items.reduce((sum, i) => sum + i.fz, 0);
  return { names, numbers, value, single: items.length === 1 && items[0].kind !== 'q' };
}

// Querkraft an der Stelle x. side: 'left' | 'right' | 'both' (an einer Einzelkraft: links und Sprung)
export function shearDerivation(result, forces, x, side, decimals) {
  const at = (inclusive) => cutForces(result, forces, x, inclusive);
  const show = side === 'right' ? at(true) : at(false);
  const sum = shearSum(show.items, decimals);
  const name = side === 'both' ? 'V_{\\text{links}}' : 'V';
  let html = '';
  if (!show.items.length) {
    html += line(`${name} = 0${unit('kN')}`) + '<p class="dp-note">Links vom Schnitt greift noch keine Kraft an.</p>';
  } else {
    const tail = sum.single ? '' : ` = ${sum.numbers}`;
    html += line(`${name} = ${sum.names}${tail} = ${fixed(sum.value, decimals)}${unit('kN')}`);
  }
  if (side === 'both') {
    // Kräfte genau an der Stelle: V springt um ihren Betrag
    const jump = at(true).items.filter((i) => Math.abs(i.x - x) < 1e-7 && i.kind !== 'q');
    const right = sum.value + jump.reduce((s, i) => s + i.fz, 0);
    const jumpText = joinSigned(jump.map((i) => ({ sign: Math.sign(i.fz), body: `${fixed(Math.abs(i.fz), decimals)}` })));
    const sign = jumpText.startsWith('-') ? ` ${jumpText.replace(/^-/, '- ')}` : ` + ${jumpText}`;
    html += line(`V_{\\text{rechts}} = ${fixed(sum.value, decimals)}${sign} = ${fixed(right, decimals)}${unit('kN')}`);
    html += `<p class="dp-note">Hier greift ${jump.map((i) => `<b>${htmlName(i.name)}</b>`).join(', ')} an: V springt um diesen Betrag (Kraft nach oben: V wird grösser).</p>`;
  }
  if (side === 'both' && Math.abs(x - forces.xmax) < 1e-9) {
    html += '<p class="dp-note">Am Trägerende muss die Querkraft auf 0 zurückgehen: Das ist die Kontrolle ΣV = 0.</p>';
  }
  html += '<p class="dp-note">Alle senkrechten Kräfte links vom Schnitt, nach oben positiv; von einer Streckenlast nur das Stück links vom Schnitt (q · Länge, bei Trapez- und Dreieckslasten der Mittelwert q̄ · Länge).</p>';
  return html;
}

// Moment an der Stelle x aus den Querkraftflächen; inclusive: Einzelmomente genau an der Stelle mitnehmen
export function momentDerivation(result, forces, x, inclusive, decimals, slopes) {
  // Stücke, die gerundet 0 sind, erscheinen nicht (wie in der V-Fläche); gerechnet wird mit allen
  const pieces = shearAreas(forces, x, 0.5 / 10 ** decimals);
  const exact = shearAreas(forces, x).reduce((s, p) => s + p.area, 0);
  const { items, couples } = cutForces(result, forces, x, inclusive);
  const len = (v) => length(v, decimals);
  const value = (v) => fixed(Math.abs(v), decimals);
  let html = '';
  if (!pieces.length && !couples.length) {
    html += line(`M = 0${unit('kNm')}`) + '<p class="dp-note">Bis hier ist unter der Querkraft noch keine Fläche: M = 0.</p>';
  } else {
    // jede Teilfläche als Betrag mit Formel (Rechteck, Dreieck, Trapez); das Vorzeichen kommt in der Summe dazu
    const rows = pieces.map((p) => {
      const w = len(p.b - p.a);
      // unter einer Trapezlast ist V eine Parabel: Fläche genau mit der Simpson-Regel (Anfang, 4 · Mitte, Ende)
      const formula = p.shape === 'rect'
        ? `${value(p.va)} \\cdot ${w}`
        : p.shape === 'tri'
          ? `\\tfrac{1}{2} \\cdot ${value(Math.abs(p.va) > Math.abs(p.vb) ? p.va : p.vb)} \\cdot ${w}`
          : p.shape === 'para'
            ? `\\tfrac{${w}}{6} \\cdot (${value(p.va)} + 4 \\cdot ${value(p.vm)} + ${value(p.vb)})`
            : `\\tfrac{${value(p.va)} + ${value(p.vb)}}{2} \\cdot ${w}`;
      const shape = { rect: 'Rechteck', tri: 'Dreieck', trap: 'Trapez', para: 'Parabelfläche (Simpson-Regel, exakt)' }[p.shape];
      return `<tr><td>${tex(`A_{${p.n}}`)}</td><td>${tex(`= ${formula} = ${value(p.area)}`)}</td><td class="dp-shape">${shape}${p.area < 0 ? ', V negativ: zählt minus' : ''}</td></tr>`;
    });
    for (const c of couples) {
      rows.push(`<tr><td>${tex(coupleName(c))}</td><td>${tex(`= ${value(c.c)}`)}</td><td class="dp-shape">Einzelmoment aus ${htmlName(c.label)} (Kraft · Abstand zur Achse)${c.c < 0 ? ', zählt minus' : ''}</td></tr>`);
    }
    html += `<table class="dp-table"><tbody>${rows.join('')}</tbody></table>`;
    const parts = [...pieces.map((p) => ({ sign: Math.sign(p.area), body: `A_{${p.n}}`, v: p.area })), ...couples.map((c) => ({ sign: Math.sign(c.c), body: coupleName(c), v: c.c }))];
    const total = exact + couples.reduce((s, c) => s + c.c, 0);
    const numbers = joinSigned(parts.map((p) => ({ sign: p.sign, body: value(p.v) })));
    html += line(`M = ${joinSigned(parts)}${parts.length > 1 ? ` = ${numbers}` : ''} = ${fixed(total, decimals)}${unit('kNm')}`);
  }
  // Kontrolle: Momente aller Kräfte links vom Schnitt um den Schnitt (nur, wenn mindestens eine Kraft einen Hebelarm hat)
  const armItems = items.filter((i) => x - i.x > 1e-9);
  if (armItems.length) {
    const terms = armItems.map((i) => {
      const arm = len(x - i.x);
      return {
        sign: Math.sign(i.fz),
        name: i.kind === 'q' ? `${qName(i)} \\cdot ${len(i.len)} \\cdot ${arm}` : `${texName(i.name)} \\cdot ${arm}`,
        number: i.kind === 'q' ? `${qNumber(i, decimals)} \\cdot ${len(i.len)} \\cdot ${arm}` : `${value(i.fz)} \\cdot ${arm}`,
        v: i.fz * (x - i.x),
      };
    });
    for (const c of couples) terms.push({ sign: Math.sign(c.c), name: coupleName(c), number: value(c.c), v: c.c });
    const total = terms.reduce((s, t) => s + t.v, 0);
    html += '<div class="dp-control"><p class="dp-sub">Kontrolle: Momente der Kräfte links vom Schnitt um den Schnitt (Streckenlast: Resultierende in ihrer Mitte, beim Trapez im Schwerpunkt)</p>'
      + line(`M = ${joinSigned(terms.map((t) => ({ sign: t.sign, body: t.name })))}`)
      + line(`\\phantom{M} = ${joinSigned(terms.map((t) => ({ sign: t.sign, body: t.number })))} = ${fixed(total, decimals)}${unit('kNm')}`)
      + '</div>';
  }
  // Steigung: die gestrichelte Tangente an der M-Linie hat die Steigung V
  if (slopes && slopes.length) {
    html += slopes.length === 2
      ? `<p class="dp-note">Gestrichelte Tangente: Die Momentenlinie knickt hier, weil V springt. Steigung links ${tex(`V = ${fixed(slopes[0], decimals)}`)}, rechts ${tex(`V = ${fixed(slopes[1], decimals)}`)}.</p>`
      : `<p class="dp-note">Gestrichelte Tangente: Steigung der Momentenlinie ${tex(`\\tfrac{dM}{dx} = V = ${fixed(slopes[0], decimals)}`)} kNm pro m. ${Math.abs(slopes[0]) < 1e-6 ? 'V = 0: Hier hat M einen Extremwert.' : 'Wo V = 0 ist, wird die Tangente waagrecht: dort liegt M<sub>max</sub> bzw. M<sub>min</sub>.'}</p>`;
  }
  return { html, pieces };
}

// ---------- Biegelinie: Anteil jeder Last (Überlagerung) ----------
// Jede Last wird für sich mit ihren eigenen Lagerkräften gerechnet (alle anderen Lasten 0); die Biegelinie
// ist die Summe der Anteile (linear-elastisch). Gleiche numerische Rechnung wie die Biegelinie selbst
// (EI·w'' = −M, w an beiden Lagern 0), daher stimmt die Summe genau. Je Rechnung und EI einmal gerechnet.
const partsCache = new WeakMap();

export function deflectionParts(model, last, EI) {
  const cached = partsCache.get(last);
  if (cached && cached.EI === EI) return cached.parts;
  const parts = [];
  const resolved = last.result.resolved;
  const supportsX = last.result.reactions.map((r) => r.x);
  (model.loads || []).forEach((load, i) => {
    const point = resolved.points.find((p) => p.source === i);
    const q = resolved.qloads.find((p) => p.source === i);
    const item = point || q;
    if (!item) return;
    const single = { ...model, loads: model.loads.map((l, j) => (j === i ? l : { ...l, value: 0, value2: 0 })) };
    const result = solve(single);
    if (!result.ok) return;
    const forces = internalForces(result);
    if (!forces.ok) return;
    const line = deflection(forces, supportsX, EI);
    if (!line || !line.points.some(([, w]) => Math.abs(w) > 1e-12)) return;
    parts.push({ label: item.label, kind: q ? 'q' : 'F', item, points: line.points });
  });
  partsCache.set(last, { EI, parts });
  return parts;
}

// Wert einer Linie [[x, w], …] an der Stelle x (linear dazwischen, wie die Biegelinie am Cursor)
export function lineAt(points, x) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, w0] = points[i - 1];
    const [x1, w1] = points[i];
    if (x <= x1 + 1e-12) return x1 - x0 < 1e-12 ? w1 : w0 + ((w1 - w0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

// EI als Zahl mit schmalem Leerzeichen als Tausendertrennung (TeX)
const texInt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\\,');

// Tabellenformel (Einfeldträger ohne Kragarm): Einzellast an beliebiger Stelle, Gleichlast über die ganze
// Länge. x ab dem linken Lager, w nach unten positiv, Ergebnis in m. Sonst null (dann nur numerisch).
export function tableDeflection(part, x, forces, supportsX, EI, decimals) {
  const xmin = forces.xmin;
  const L = forces.xmax - xmin;
  const [s1, s2] = [...supportsX].sort((a, b) => a - b);
  if (Math.abs(s1 - xmin) > 1e-6 || Math.abs(s2 - forces.xmax) > 1e-6 || !(L > 0)) return null;
  const xi = x - xmin;
  const len = (v) => length(v, decimals);
  const ei = texInt(EI);
  if (part.kind === 'F') {
    const p = part.item;
    if (p.horizontal || Math.abs(p.z - p.axisZ) > 1e-9 || Math.abs(p.fz) < 1e-12) return null;
    const F = -p.fz;
    const a = p.x - xmin;
    const b = L - a;
    if (a < 1e-9 || b < 1e-9) return null;
    if (xi <= a + 1e-12) {
      return {
        value: (F * b * xi * (L * L - b * b - xi * xi)) / (6 * L * EI),
        symbolic: '\\dfrac{F\\,b\\,x\\,(L^2 - b^2 - x^2)}{6\\,L\\,EI}',
        numbers: `\\dfrac{${fixed(F, decimals)} \\cdot ${len(b)} \\cdot ${len(xi)} \\cdot (${len(L)}^2 - ${len(b)}^2 - ${len(xi)}^2)}{6 \\cdot ${len(L)} \\cdot ${ei}}`,
        where: "x links der Last",
      };
    }
    const xr = L - xi;
    return {
      value: (F * a * xr * (L * L - a * a - xr * xr)) / (6 * L * EI),
      symbolic: "\\dfrac{F\\,a\\,x'\\,(L^2 - a^2 - x'^2)}{6\\,L\\,EI},\\ x' = L - x",
      numbers: `\\dfrac{${fixed(F, decimals)} \\cdot ${len(a)} \\cdot ${len(xr)} \\cdot (${len(L)}^2 - ${len(a)}^2 - ${len(xr)}^2)}{6 \\cdot ${len(L)} \\cdot ${ei}}`,
      where: "x rechts der Last",
    };
  }
  const q = part.item;
  if (q.trapez || Math.abs(q.x1 - xmin) > 1e-6 || Math.abs(q.x2 - forces.xmax) > 1e-6) return null;
  const qv = -q.qz;
  return {
    value: (qv * xi * (L ** 3 - 2 * L * xi * xi + xi ** 3)) / (24 * EI),
    symbolic: '\\dfrac{q\\,x\\,(L^3 - 2L\\,x^2 + x^3)}{24\\,EI}',
    numbers: `\\dfrac{${fixed(qv, decimals)} \\cdot ${len(xi)} \\cdot (${len(L)}^3 - 2 \\cdot ${len(L)} \\cdot ${len(xi)}^2 + ${len(xi)}^3)}{24 \\cdot ${ei}}`,
    where: "",
  };
}

// Durchbiegung an der Stelle x als Summe der Anteile; EI in kNm², w in mm (nach unten positiv)
export function deflectionDerivation(model, last, x, EI, decimals) {
  const forces = last.forces;
  const supportsX = last.result.reactions.map((r) => r.x);
  const parts = deflectionParts(model, last, EI).map((p) => ({ ...p, w: lineAt(p.points, x) * 1000 }));
  const total = parts.reduce((s, p) => s + p.w, 0);
  // kleine Durchbiegungen mit einer Stelle mehr, damit die Summe auch gerundet aufgeht
  const wd = Math.max(Math.abs(total), ...parts.map((p) => Math.abs(p.w))) < 1 ? 3 : 2;
  const shown = parts.filter((p) => Math.abs(p.w) >= 0.5 * 10 ** -wd);
  const biggest = Math.max(1e-9, ...shown.map((p) => Math.abs(p.w)));
  const len = (v) => length(v, decimals);
  const mm = (v) => fixed(v, wd);
  let html = '';
  if (!shown.length) {
    html += line(`w = 0${unit('mm')}`);
    html += `<p class="dp-note">${supportsX.some((s) => Math.abs(s - x) < 1e-6) ? 'Am Lager ist w = 0.' : 'Hier biegt sich der Träger (gerundet) nicht durch.'}</p>`;
    return html;
  }
  // Feld zwischen den Lagern: Lasten auf der anderen Seite eines Lagers biegen den Träger nach oben
  const [s1, s2] = [...supportsX].sort((u, v) => u - v);
  const inSpan = (v) => v >= s1 - 1e-9 && v <= s2 + 1e-9;
  const outside = (p) => (p.kind === 'q' ? p.item.x2 <= s1 + 1e-9 || p.item.x1 >= s2 - 1e-9 : !inSpan(p.item.x));
  const inside = (p) => (p.kind === 'q' ? p.item.x1 >= s1 - 1e-9 && p.item.x2 <= s2 + 1e-9 : inSpan(p.item.x));
  const why = (p) => {
    if (p.w >= 0) return '';
    if (p.item.dir === 'up') return 'Last nach oben';
    if (inSpan(x) && outside(p)) return 'Last auf dem Kragarm hebt das Feld an';
    if (!inSpan(x) && inside(p)) return 'Last im Feld hebt den Kragarm an';
    return '';
  };
  const anyNumeric = { value: false };
  const rows = shown.map((p) => {
    const item = p.item;
    const what = p.kind === 'q'
      ? `Streckenlast ${item.trapez ? `${fixed(item.value, decimals)} … ${fixed(item.value2, decimals)}` : fixed(item.value, decimals)} kN/m, ${len(item.x1)}–${len(item.x2)} m`
      : `${item.horizontal ? 'Horizontallast' : 'Einzellast'} ${fixed(item.value, decimals)} kN bei x = ${len(item.x)} m`;
    const share = Math.round((Math.abs(p.w) / biggest) * 100);
    const formula = tableDeflection(p, x, forces, supportsX, EI, decimals);
    // Formel nur zeigen, wenn sie die numerische Rechnung bestätigt (Sicherheitsnetz)
    const fits = formula && Math.abs(formula.value * 1000 - p.w) <= Math.max(0.01, Math.abs(p.w) * 0.005);
    if (!fits) anyNumeric.value = true;
    const formulaHtml = fits
      ? `<tr class="dp-formula"><td></td><td colspan="3">${tex(`= ${formula.symbolic} = ${formula.numbers} \\cdot 1000`)}</td></tr>`
      : '';
    const reason = why(p);
    const down = p.w >= 0;
    return `<tr><td>${tex(`w_{${texName(p.label)}}`)}</td><td class="dp-shape">${what}${fits ? ` · nach Tabellenformel${formula.where ? ` (${formula.where})` : ''}` : ''}${reason ? `<span class="dp-why">${reason}</span>` : ''}</td>`
      + `<td><span class="dp-bar ${down ? 'down' : 'up'}"><i style="width:${Math.max(3, share)}%"></i></span></td>`
      + `<td class="dp-num"><span class="dp-arrow ${down ? 'down' : 'up'}" title="${down ? 'nach unten' : 'nach oben'}">${down ? '↓' : '↑'}</span> ${tex(`${mm(Math.abs(p.w))}${unit('mm')}`)}</td></tr>${formulaHtml}`;
  });
  html += `<table class="dp-table dp-wtable"><tbody>${rows.join('')}</tbody></table>`;
  // Summe immer mit „+“, negative Anteile in Klammern: w = w_q1 + w_F1 = 0.364 + (−0.137)
  const names = shown.map((p) => `w_{${texName(p.label)}}`).join(' + ');
  const numbers = shown.map((p, i) => (i > 0 && p.w < 0 ? `(${mm(p.w)})` : mm(p.w))).join(' + ');
  // Ergebnis aus den angezeigten (gerundeten) Anteilen, damit die Rechnung auf dem Papier aufgeht;
  // das weicht höchstens um eine halbe Einheit der letzten Stelle je Anteil vom genauen Wert ab
  const shownTotal = shown.reduce((s, p) => s + Number(fixed(p.w, wd)), 0);
  html += line(`w = ${names}${shown.length > 1 ? ` = ${numbers}` : ''} = ${mm(shown.length > 1 ? shownTotal : total)}${unit('mm')}`);
  html += `<p class="dp-note">Jede Last biegt den Träger für sich (mit ihren eigenen Auflagerkräften); die Anteile werden zusammengezählt. <span class="dp-arrow down">↓</span> blau = nach unten, <span class="dp-arrow up">↑</span> orange = nach oben. Gerechnet mit den Lasten ohne Lastbeiwert${anyNumeric.value ? '; Anteile ohne Tabellenformel numerisch aus EI · w″ = −M' : ''}.</p>`;
  return html;
}
