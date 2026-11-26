// Herleitung am Mauszeiger in den Flächen (Haken „Herleitung“): wie V und M an der Stelle x zustande kommen.
// V nach dem Schnittprinzip: Summe aller Vertikalkräfte links vom Schnitt (nach oben positiv).
// M als Summe der Querkraftflächen vom Trägeranfang bis zum Schnitt (dM/dx = V), dazu die Momentensumme
// links vom Schnitt als Kontrolle. Reine Rechnung und HTML, das Zeichnen macht app.js.
import { tex as renderTex } from './solution.js';
import { fixed, texName, htmlName, length } from './format.js';

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
    if (b - a > 1e-9 && Math.abs(q.qz) > EPS) items.push({ kind: 'q', name: q.label, q: q.qz, len: b - a, fz: q.qz * (b - a), x: (a + b) / 2 });
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
    const vAt = (t) => s.v0 + s.q * (t - s.a);
    const cuts = [s.a];
    if (Math.abs(s.q) > EPS) {
      const zero = s.a - s.v0 / s.q;
      if (zero > s.a + 1e-7 && zero < end - 1e-7) cuts.push(zero);
    }
    cuts.push(end);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1];
      const b = cuts[i];
      const va = vAt(a);
      const vb = vAt(b);
      const area = ((va + vb) / 2) * (b - a);
      if (Math.abs(area) < minArea) continue;
      const shape = Math.abs(va - vb) < 1e-9 ? 'rect' : Math.abs(va) < 1e-9 || Math.abs(vb) < 1e-9 ? 'tri' : 'trap';
      pieces.push({ a, b, va, vb, area, shape });
    }
  }
  return pieces.map((p, i) => ({ ...p, n: i + 1 }));
}

const line = (source) => `<div class="dp-line">${tex(source)}</div>`;
// Einzelmoment aus einer Kraft neben der Achse: ΔM mit dem Namen der Kraft
const coupleName = (c) => `\\Delta M_{${texName(c.label)}}`;

// V links vom Schnitt als Summe (Namen, dann Zahlen)
function shearSum(items, decimals) {
  const len = (v) => length(v, decimals);
  const names = joinSigned(items.map((i) => ({ sign: Math.sign(i.fz), body: i.kind === 'q' ? `${texName(i.name)} \\cdot ${len(i.len)}` : texName(i.name) })));
  const numbers = joinSigned(items.map((i) => ({ sign: Math.sign(i.fz), body: i.kind === 'q' ? `${fixed(Math.abs(i.q), decimals)} \\cdot ${len(i.len)}` : fixed(Math.abs(i.fz), decimals) })));
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
  html += '<p class="dp-note">Alle senkrechten Kräfte links vom Schnitt, nach oben positiv; von einer Streckenlast nur das Stück links vom Schnitt (q · Länge).</p>';
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
      const formula = p.shape === 'rect'
        ? `${value(p.va)} \\cdot ${w}`
        : p.shape === 'tri'
          ? `\\tfrac{1}{2} \\cdot ${value(Math.abs(p.va) > Math.abs(p.vb) ? p.va : p.vb)} \\cdot ${w}`
          : `\\tfrac{${value(p.va)} + ${value(p.vb)}}{2} \\cdot ${w}`;
      const shape = { rect: 'Rechteck', tri: 'Dreieck', trap: 'Trapez' }[p.shape];
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
        name: i.kind === 'q' ? `${texName(i.name)} \\cdot ${len(i.len)} \\cdot ${arm}` : `${texName(i.name)} \\cdot ${arm}`,
        number: i.kind === 'q' ? `${value(i.q)} \\cdot ${len(i.len)} \\cdot ${arm}` : `${value(i.fz)} \\cdot ${arm}`,
        v: i.fz * (x - i.x),
      };
    });
    for (const c of couples) terms.push({ sign: Math.sign(c.c), name: coupleName(c), number: value(c.c), v: c.c });
    const total = terms.reduce((s, t) => s + t.v, 0);
    html += '<div class="dp-control"><p class="dp-sub">Kontrolle: Momente der Kräfte links vom Schnitt um den Schnitt (Streckenlast: Resultierende in ihrer Mitte)</p>'
      + line(`M = ${joinSigned(terms.map((t) => ({ sign: t.sign, body: t.name })))}`)
      + line(`\\phantom{M} = ${joinSigned(terms.map((t) => ({ sign: t.sign, body: t.number })))} = ${fixed(total, decimals)}${unit('kNm')}`)
      + '</div>';
  }
  // Steigung: die gestrichelte Tangente an der M-Linie hat die Steigung V
  if (slopes && slopes.length) {
    html += slopes.length === 2
      ? `<p class="dp-note">Gestrichelte Tangente: Die M-Linie knickt hier, weil V springt. Steigung links ${tex(`V = ${fixed(slopes[0], decimals)}`)}, rechts ${tex(`V = ${fixed(slopes[1], decimals)}`)}.</p>`
      : `<p class="dp-note">Gestrichelte Tangente: Steigung der M-Linie ${tex(`\\tfrac{dM}{dx} = V = ${fixed(slopes[0], decimals)}`)} kNm pro m. ${Math.abs(slopes[0]) < 1e-6 ? 'V = 0: Hier hat M einen Extremwert.' : 'Wo V = 0 ist, wird die Tangente waagrecht: dort liegt M<sub>max</sub> bzw. M<sub>min</sub>.'}</p>`;
  }
  return { html, pieces };
}
