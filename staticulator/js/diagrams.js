// Querkraft- und Momentenfläche als SVG, im gleichen x-Massstab wie die Systemskizze.
// Schulkonvention (Musterlösungen): positive Werte unterhalb der Achse.
import { label, measure, escapeHtml } from './format.js';

// Flächen wie in den Musterlösungen schraffiert, dazu ein Farbverlauf (an der Achse hell, zur
// Linie hin kräftig). Die Flächenfarben kommen aus CSS (--dg-pos, --dg-neg), auch für den Dark Mode.
const POS_LINE = '#1d4ed8';
const NEG_LINE = '#be123c';
const HEIGHT = 210;
// Unter der jeweils untersten Fläche (M, Biegelinie) ein eigener Streifen für das Mass am Mauszeiger (app.js),
// damit es nie mit den Beschriftungen der Fläche zusammenstösst
export const CURSOR_BAND = 26;
const AMPLITUDE = 72;

// Breite einer Beschriftung (fett gemessen, damit die Platzierung sicher ist; ohne Browser geschätzt)
let measureCtx = null;
function labelWidth(content, size) {
  if (typeof document !== 'undefined') {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return measureCtx.measureText(content).width;
  }
  return content.length * size * 0.62;
}

function r(v) {
  return Math.round(v * 10) / 10;
}

function text(x, y, content, options = {}) {
  const anchor = options.anchor || 'middle';
  const size = options.size || 12;
  const color = options.color || '#1f2933';
  const weight = options.weight ? ` font-weight="${options.weight}"` : '';
  const cls = options.cls ? ` class="${options.cls}"` : '';
  return `<text${cls} x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${weight} paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${escapeHtml(content)}</text>`;
}

// Liefert die Polylinie [x, Wert] eines Diagramms mit senkrechten Sprüngen.
function samples(forces, kind) {
  const pts = [];
  forces.segments.forEach((seg, index) => {
    const start = kind === 'V' ? seg.v0 : seg.m0;
    if (index === 0) pts.push([seg.a, 0]);
    pts.push([seg.a, start]);
    // V gerade (q gleichmässig) oder Parabel (Trapezlast), M Parabel bzw. kubisch: dann fein abtasten
    const slope = seg.k || 0;
    const curved = kind === 'V' ? Math.abs(slope) > 1e-12 : Math.abs(seg.q) > 1e-12 || Math.abs(slope) > 1e-12;
    if (!curved) {
      pts.push([seg.b, kind === 'V' ? seg.v1 : seg.m1]);
    } else {
      const n = 24;
      for (let k = 1; k <= n; k++) {
        const t = ((seg.b - seg.a) * k) / n;
        pts.push([seg.a + t, kind === 'V'
          ? seg.v0 + seg.q * t + (slope * t * t) / 2
          : seg.m0 + seg.v0 * t + (seg.q * t * t) / 2 + (slope * t * t * t) / 6]);
      }
    }
  });
  const last = forces.segments[forces.segments.length - 1];
  if (last) pts.push([last.b, 0]);
  return pts;
}

function hatchDefs(kind, base) {
  const pattern = (id, sign) => `<pattern id="${id}" width="6" height="12" patternUnits="userSpaceOnUse">`
    + `<line class="dg-hatch dg-${sign}" x1="0.5" y1="0" x2="0.5" y2="12" stroke-width="1" shape-rendering="crispEdges"/></pattern>`;
  // Verlauf von der Achse (base) bis zur grössten Ordinate: positiv nach unten, negativ nach oben
  const gradient = (id, sign, y2) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${r(base)}" x2="0" y2="${r(y2)}">`
    + `<stop offset="0" class="dg-stop-near dg-${sign}"/><stop offset="1" class="dg-stop-far dg-${sign}"/></linearGradient>`;
  return `<defs>${pattern(`dg-pos-${kind}`, 'pos')}${pattern(`dg-neg-${kind}`, 'neg')}`
    + `${gradient(`dg-grad-pos-${kind}`, 'pos', base + AMPLITUDE)}${gradient(`dg-grad-neg-${kind}`, 'neg', base - AMPLITUDE)}</defs>`;
}

// Liang–Barsky: schneidet die Strecke das Rechteck {left, right, top, bottom}?
function segmentHitsRect(x1, y1, x2, y2, b) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - b.left, b.right - x1, y1 - b.top, b.bottom - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

function fillPolygons(pts, X, Yv, kind) {
  // Flächenstücke zwischen Nachbarpunkten, eingefärbt nach Vorzeichen.
  const polys = [];
  for (let i = 1; i < pts.length; i++) {
    const [xa, va] = pts[i - 1];
    const [xb, vb] = pts[i];
    if (Math.abs(xb - xa) < 1e-12) continue;
    if (va * vb < 0) {
      const xm = xa + ((xb - xa) * va) / (va - vb);
      polys.push({ pts: [[xa, 0], [xa, va], [xm, 0]], positive: va > 0 });
      polys.push({ pts: [[xm, 0], [xb, vb], [xb, 0]], positive: vb > 0 });
    } else {
      polys.push({ pts: [[xa, 0], [xa, va], [xb, vb], [xb, 0]], positive: va + vb > 0 });
    }
  }
  return polys
    .map((p) => {
      const d = `${p.pts.map(([x, v], k) => `${k ? 'L' : 'M'}${r(X(x))},${r(Yv(v))}`).join(' ')} Z`;
      const sign = p.positive ? 'pos' : 'neg';
      // erst der Farbverlauf, darüber die Schraffur
      return `<path d="${d}" fill="url(#dg-grad-${sign}-${kind})" stroke="none"/><path d="${d}" fill="url(#dg-${sign}-${kind})" stroke="none"/>`;
    })
    .join('');
}

function diagram(forces, layout, kind, decimals, supportsByX, band = 0) {
  const { X } = layout;
  const pts = samples(forces, kind);
  const maxAbs = Math.max(1e-9, ...pts.map(([, v]) => Math.abs(v)));
  const base = HEIGHT / 2 + 4;
  // positive Werte nach unten (Schulkonvention)
  const Yv = (v) => base + (v / maxAbs) * AMPLITUDE;
  const parts = [];
  const unit = kind === 'V' ? 'kN' : 'kNm';
  const title = kind === 'V' ? 'V-Fläche (Querkraft)' : 'M-Fläche (Biegemoment)';

  parts.push(text(8, 16, `${title} [${unit}]`, { anchor: 'start', size: 13, weight: 700 }));
  parts.push(text(8, 32, '+ unten, − oben', { anchor: 'start', size: 11, color: '#64748b' }));

  // Hilfslinien an allen Ereignisstellen
  for (const e of forces.events) {
    parts.push(`<line x1="${r(X(e.x))}" y1="${r(base - AMPLITUDE - 14)}" x2="${r(X(e.x))}" y2="${r(base + AMPLITUDE + 14)}" stroke="#e7ebf0" stroke-width="1" shape-rendering="crispEdges"/>`);
  }

  parts.push(hatchDefs(kind, base), fillPolygons(pts, X, Yv, kind));
  const linePath = pts.map(([x, v], i) => `${i ? 'L' : 'M'}${r(X(x))},${r(Yv(v))}`).join(' ');
  parts.push(`<path d="${linePath}" fill="none" stroke="#334155" stroke-width="1.7" stroke-linejoin="round"/>`);
  parts.push(`<line x1="${r(X(forces.xmin))}" y1="${r(base)}" x2="${r(X(forces.xmax))}" y2="${r(base)}" stroke="#1f2933" stroke-width="1.3" shape-rendering="crispEdges"/>`);

  // ---------- Beschriftungen ohne Überdeckung ----------
  // Hindernisse sind alle schon gesetzten Texte und Marken sowie der Linienzug samt Achse.
  // Jede Beschriftung nimmt die erste Stelle ihrer Kandidatenliste, die weder Text noch Linie
  // berührt; sonst die erste ohne Textüberdeckung (eine Linie durch Text mit weissem Rand bleibt
  // lesbar); sonst bleibt sie weg. Text auf Text gibt es nie.
  const placed = [];
  const lines = [];
  for (let i = 1; i < pts.length; i++) lines.push([X(pts[i - 1][0]), Yv(pts[i - 1][1]), X(pts[i][0]), Yv(pts[i][1])]);
  lines.push([X(forces.xmin), base, X(forces.xmax), base]);
  const boxOf = (x, y, content, anchor, size) => {
    const width = labelWidth(content, size) + 4;
    const left = anchor === 'end' ? x - width : anchor === 'start' ? x : x - width / 2;
    return { left, right: left + width, top: y - size * 0.86, bottom: y + size * 0.32 }; // mit Unterlängen und weissem Rand
  };
  const hitsText = (b) => placed.some((p) => b.left < p.right + 3 && b.right > p.left - 3 && b.top < p.bottom + 3 && b.bottom > p.top - 3);
  const hitsLine = (b) => lines.some(([x1, y1, x2, y2]) => segmentHitsRect(x1, y1, x2, y2, b));
  const inside = (b) => b.top >= 1 && b.bottom <= HEIGHT - 1 && b.left >= 1 && b.right <= layout.width - 1;
  const tryPlace = (content, candidates, style) => {
    const size = style.size || 12;
    for (const strict of [true, false]) {
      for (const c of candidates) {
        const anchor = c.anchor || 'middle';
        const b = boxOf(c.x, c.y, content, anchor, size);
        if (!inside(b) || hitsText(b) || (strict && hitsLine(b))) continue;
        placed.push({ ...b, x: c.x, text: content });
        parts.push(text(c.x, c.y, content, { ...style, anchor }));
        return true;
      }
    }
    return false;
  };
  placed.push(boxOf(8, 16, `${title} [${unit}]`, 'start', 13), boxOf(8, 32, '+ unten, − oben', 'start', 11));

  // Lagermarken auf der Achse; der Name steht neben dem Dreieck, damit ein Sprung der
  // Linie an der Lagerstelle ihn nicht durchschneidet.
  for (const [x, name] of supportsByX) {
    parts.push(`<path d="M${r(X(x))},${r(base)} l-5.5,9 l11,0 Z" fill="#ffffff" stroke="#1f2933" stroke-width="1"/>`);
    parts.push(text(X(x) + 8, base + 12, name, { anchor: 'start', size: 10.5, weight: 700, color: '#52606d' }));
    placed.push({ left: X(x) - 7, right: X(x) + 17, top: base, bottom: base + 14 });
  }
  // Punkte für V = 0 vorab als belegt markieren
  const crossings = kind === 'V' ? forces.zeroCrossings.filter((z) => z.inSegment) : [];
  for (const z of crossings) {
    const x = X(z.x);
    parts.push(`<circle cx="${r(x)}" cy="${r(base)}" r="3" fill="#1f2933" stroke="#ffffff" stroke-width="1.2"/>`);
    placed.push({ left: x - 4, right: x + 4, top: base - 4, bottom: base + 4 });
  }

  // Werte an den Ereignisstellen. Derselbe Wert gleich daneben (konstante Strecke) nur einmal;
  // bei Platzmangel weicht die Zahl senkrecht vom Linienzug weg aus, nie seitlich zu einem
  // anderen Sprung hin.
  const place = (x, y, content, anchor, value) => {
    if (placed.some((p) => p.text === content && Math.abs(p.x - x) < 140)) return;
    const away = y > base ? 13 : -13;
    tryPlace(content, [0, 1, 2].map((k) => ({ x, y: y + k * away, anchor })), { size: 12, color: colorOf(value), weight: 600, cls: signClass(value) });
  };
  const valueY = (v) => (v > 0 ? Yv(v) + 15 : Yv(v) - 6);
  const colorOf = (v) => (v >= 0 ? POS_LINE : NEG_LINE);
  // Farbe kommt aus dem gewählten Farbschema (CSS), colorOf ist nur der Rückfall
  const signClass = (v) => (v >= 0 ? 'dg-val dg-pos' : 'dg-val dg-neg');

  // Mmax/Mmin zuerst setzen; gleiche Werte werden an der Stelle nicht noch einmal beschriftet.
  const marks = [];
  if (kind === 'M') {
    if (forces.mMax.m > 0.5 * Math.pow(10, -decimals)) marks.push({ ...forces.mMax, text: 'Mmax' });
    if (forces.mMin.m < -0.5 * Math.pow(10, -decimals)) marks.push({ ...forces.mMin, text: 'Mmin' });
    for (const mark of marks) {
      const x = X(mark.x);
      const y = Yv(mark.m);
      parts.push(`<circle cx="${r(x)}" cy="${r(y)}" r="3.5" class="dg-mark dg-${mark.m >= 0 ? 'pos' : 'neg'}" fill="${colorOf(mark.m)}" stroke="#ffffff" stroke-width="1.5"/>`);
      const ty = mark.m > 0 ? y + 17 : y - 8;
      const away = mark.m > 0 ? 13 : -13;
      const content = `${mark.text} = ${label(mark.m, decimals)} kNm`;
      const style = { size: 12, weight: 700, color: colorOf(mark.m), cls: signClass(mark.m) };
      // erst direkt an der Marke, dann seitlich weiter weg und auf der anderen Seite der Linie (nie auf Text)
      const near = [{ x, y: ty }, { x: x + 8, y: ty, anchor: 'start' }, { x: x - 8, y: ty, anchor: 'end' }, { x, y: ty + away }];
      const otherY = mark.m > 0 ? y - 8 : y + 17;
      const further = [];
      for (const row of [ty, ty + away, otherY]) {
        for (const k of [1, 2, 3, 4]) further.push({ x: x + 8 + k * 30, y: row, anchor: 'start' }, { x: x - 8 - k * 30, y: row, anchor: 'end' });
      }
      if (!tryPlace(content, [...near, { x, y: otherY }, ...further], style)) {
        placed.push({ ...boxOf(x, ty, content, 'middle', 12), x, text: content });
        parts.push(text(x, ty, content, style));
      }
    }
  }
  const isMarked = (x, v) => marks.some((m) => Math.abs(m.x - x) < 1e-7 && Math.abs(m.m - v) < 0.5 * Math.pow(10, -decimals));

  for (const e of forces.events) {
    const left = kind === 'V' ? e.vLeft : e.mLeft;
    const right = kind === 'V' ? e.vRight : e.mRight;
    const atStart = e.x <= forces.xmin + 1e-9;
    const atEnd = e.x >= forces.xmax - 1e-9;
    const jump = Math.abs(left - right) > 0.5 * Math.pow(10, -decimals);
    if (!atStart && Math.abs(left) > 0.5 * Math.pow(10, -decimals) && !isMarked(e.x, left)) {
      place(X(e.x) - 4, valueY(left), label(left, decimals), jump || atEnd ? 'end' : 'middle', left);
    }
    if (!atEnd && jump && Math.abs(right) > 0.5 * Math.pow(10, -decimals) && !isMarked(e.x, right)) {
      place(X(e.x) + 4, valueY(right), label(right, decimals), 'start', right);
    }
    if (atStart && Math.abs(right) > 0.5 * Math.pow(10, -decimals) && !isMarked(e.x, right)) {
      place(X(e.x) + 4, valueY(right), label(right, decimals), 'start', right);
    }
  }
  // Extremwert von V mitten im Abschnitt (wo q = 0 wird, z. B. Trapezlast gegen eine Gegenlast)
  if (kind === 'V') {
    for (const c of forces.vInner || []) {
      if (Math.abs(c.v) > 0.5 * Math.pow(10, -decimals)) place(X(c.x), valueY(c.v), label(c.v, decimals), 'middle', c.v);
    }
  }

  // „V = 0 bei x = …“: zuerst über der Achse auf der Seite, auf der die Linie unten verläuft,
  // dann unter der Achse auf der anderen Seite, dann weiter aussen.
  for (const z of crossings) {
    const x = X(z.x);
    const vRight = forces.valueAt(Math.min(forces.xmax, z.x + 1e-4)).v;
    const free = vRight < 0 ? -1 : 1;
    const side = (s, y) => ({ x: x + s * 6, y, anchor: s > 0 ? 'start' : 'end' });
    const candidates = [
      side(free, base - 8), side(-free, base + 17),
      side(free, base - 21), side(-free, base + 30),
      side(-free, base - 8), side(free, base + 17),
      side(free, base - 34), side(-free, base + 43),
      { x, y: base - 21 }, { x, y: base + 30 }, { x, y: base - 34 }, { x, y: base + 43 },
    ];
    tryPlace(`V = 0 bei x = ${measure(z.x)}`, candidates, { size: 11, color: '#1f2933' });
  }

  // data-*: Massstab für den Mauszeiger (app.js zeigt dort Wert und Mass an der Stelle x)
  return `<svg class="diagram dg-${kind}" viewBox="0 0 ${layout.width} ${HEIGHT + band}" data-band="${band}" data-kind="${kind}" data-base="${r(base)}" data-max="${maxAbs}" data-amp="${AMPLITUDE}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(title)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}</svg>`;
}

// Biegelinie des gewählten Trägers (aus der Bemessung), im gleichen Stil wie V- und M-Fläche:
// positive Werte (Senkung) unten, Schraffur und Verlauf, Werte an den massgebenden Stellen.
// data: { line: { points: [[x, w]] (w in m), max }, checks: [{ what, w, x, up, allowed }], name, EI }
export function renderDeflection(data, layout, supportsByX, eventXs = []) {
  const { X } = layout;
  const pts = data.line.points.map(([x, w]) => [x, w * 1000]); // mm
  const maxAbs = Math.max(1e-9, ...pts.map(([, w]) => Math.abs(w)));
  const base = HEIGHT / 2 + 4;
  const Yv = (w) => base + (w / maxAbs) * AMPLITUDE;
  const kind = 'W';
  const title = 'Biegelinie w [mm]';
  const subtitle = `+ unten, − oben · ${data.name}, E·I = ${Math.round(data.EI).toLocaleString('de-CH')} kNm²`;
  const parts = [];
  parts.push(text(8, 16, title, { anchor: 'start', size: 13, weight: 700 }));
  parts.push(text(8, 32, subtitle, { anchor: 'start', size: 11, color: '#64748b' }));
  for (const x of eventXs) {
    parts.push(`<line x1="${r(X(x))}" y1="${r(base - AMPLITUDE - 14)}" x2="${r(X(x))}" y2="${r(base + AMPLITUDE + 14)}" stroke="#e7ebf0" stroke-width="1" shape-rendering="crispEdges"/>`);
  }
  parts.push(hatchDefs(kind, base), fillPolygons(pts, X, Yv, kind));
  const linePath = pts.map(([x, w], i) => `${i ? 'L' : 'M'}${r(X(x))},${r(Yv(w))}`).join(' ');
  parts.push(`<path d="${linePath}" fill="none" stroke="#334155" stroke-width="1.7" stroke-linejoin="round"/>`);
  parts.push(`<line x1="${r(X(pts[0][0]))}" y1="${r(base)}" x2="${r(X(pts[pts.length - 1][0]))}" y2="${r(base)}" stroke="#1f2933" stroke-width="1.3" shape-rendering="crispEdges"/>`);

  const placed = [];
  const boxOf = (x, y, content, anchor, size) => {
    const width = labelWidth(content, size) + 4;
    const left = anchor === 'end' ? x - width : anchor === 'start' ? x : x - width / 2;
    return { left, right: left + width, top: y - size * 0.86, bottom: y + size * 0.32 }; // mit Unterlängen und weissem Rand
  };
  placed.push(boxOf(8, 16, title, 'start', 13), boxOf(8, 32, subtitle, 'start', 11));
  const free = (b) => b.top >= 1 && b.bottom <= HEIGHT - 1 && b.left >= 1 && b.right <= layout.width - 1
    && !placed.some((p) => b.left < p.right + 3 && b.right > p.left - 3 && b.top < p.bottom + 3 && b.bottom > p.top - 3);
  for (const [x, name] of supportsByX) {
    parts.push(`<path d="M${r(X(x))},${r(base)} l-5.5,9 l11,0 Z" fill="#ffffff" stroke="#1f2933" stroke-width="1"/>`);
    parts.push(text(X(x) + 8, base + 12, name, { anchor: 'start', size: 10.5, weight: 700, color: '#52606d' }));
    placed.push({ left: X(x) - 7, right: X(x) + 17, top: base, bottom: base + 14 });
  }
  // Massgebende Werte wie Mmax: Marke auf der Linie, Wert mit Grenzwert, über bzw. unter der Linie
  const marks = data.checks.length ? data.checks : [{ what: 'Feld', w: data.line.max.w, x: data.line.max.x, up: false, allowed: null }];
  for (const c of marks) {
    if (!(c.w > 1e-7)) continue;
    const w = (c.up ? -c.w : c.w) * 1000;
    const x = X(c.x);
    const y = Yv(w);
    const bad = Number.isFinite(c.allowed) && c.w > c.allowed + 1e-12;
    const sign = w >= 0 ? 'pos' : 'neg';
    parts.push(`<circle cx="${r(x)}" cy="${r(y)}" r="3.5" class="dg-mark dg-${sign}" fill="${w >= 0 ? POS_LINE : NEG_LINE}" stroke="#ffffff" stroke-width="1.5"/>`);
    const name = c.what === 'Feld' ? 'w' : 'w Kragarm';
    const limit = Number.isFinite(c.allowed) ? ` ${bad ? '>' : '≤'} ${(c.allowed * 1000).toFixed(1)}` : '';
    const content = `${name} = ${label(w, 1)}${limit} mm`;
    const ty = w >= 0 ? y + 17 : y - 8;
    const away = w >= 0 ? 13 : -13;
    const style = { size: 12, weight: 700, color: bad ? '#dc2626' : w >= 0 ? POS_LINE : NEG_LINE, cls: bad ? 'dg-val bad' : `dg-val dg-${sign}` };
    const candidates = [{ x, y: ty }, { x: x + 8, y: ty, anchor: 'start' }, { x: x - 8, y: ty, anchor: 'end' }, { x, y: ty + away }, { x: x + 8, y: ty + away, anchor: 'start' }, { x: x - 8, y: ty + away, anchor: 'end' }];
    for (const cand of candidates) {
      const anchor = cand.anchor || 'middle';
      const b = boxOf(cand.x, cand.y, content, anchor, 12);
      if (!free(b)) continue;
      placed.push(b);
      parts.push(text(cand.x, cand.y, content, { ...style, anchor }));
      break;
    }
  }
  return `<svg class="diagram dg-${kind}" viewBox="0 0 ${layout.width} ${HEIGHT + CURSOR_BAND}" data-band="${CURSOR_BAND}" data-kind="${kind}" data-base="${r(base)}" data-max="${maxAbs}" data-amp="${AMPLITUDE}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(title)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${parts.join('')}</svg>`;
}

export function renderDiagrams(forces, layout, result, decimals = 2) {
  const supportsByX = result.reactions.map((s) => [s.x, s.name]);
  return diagram(forces, layout, 'V', decimals, supportsByX) + diagram(forces, layout, 'M', decimals, supportsByX, CURSOR_BAND);
}
