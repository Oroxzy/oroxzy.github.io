// Systemskizze als SVG: Trägerachse, Stützen/Stiele, Lager, Lasten, Reaktionen, Masse.
//
// Ablauf: Zuerst werden alle Formen gezeichnet und als Hindernisse registriert
// (Linien, Pfeile, Lastblöcke, Lagersymbole, Masse). Danach bekommt jede Beschriftung
// die erste Position aus einer Kandidatenliste, die nichts überdeckt.
// Ziehbare Elemente tragen data-drag="art:index" (siehe app.js).
import { axisZAt, isNum } from './statik.js';
import { label, measure, escapeHtml } from './format.js';
import { DIM_STYLE, dimSlash, dimLine, extLine } from './dimension.js';

export const COLORS = {
  axis: '#1f2933',
  member: '#52606d',
  load: '#d0312d',
  q: '#b8329e',
  qFill: 'rgba(184, 50, 158, 0.08)',
  reaction: '#15803d',
  dim: '#64748b',
  text: '#1f2933',
  muted: '#64748b',
  pivot: '#2563eb',
};

const WIDTH = 1000;
const SIDE = 96;
const Q_GAP = 6;
// Streckenlasten: Blockhöhe nach dem Betrag, im Verhältnis zur grössten im Bild (gleiche Lasten gleich hoch);
// zwischen Q_MIN und Q_MAX, damit kleine sichtbar bleiben und grosse nicht ausufern. Q_STEP: Abstand der Ebenen,
// wenn sich Streckenlasten überlappen.
const Q_MIN = 10;
const Q_MAX = 30;
const Q_STEP = Q_MAX + 8;
const ARROW = 50;
const H_ARROW = 58;
const REACTION = 48;

// Gemeinsamer Massstab für Skizze und Diagramme.
export function computeLayout(resolved, width = WIDTH) {
  const xs = [];
  const zs = [];
  for (const p of resolved.axis) { xs.push(p.x); zs.push(p.z); }
  for (const s of resolved.supports) if (isNum(s.x)) { xs.push(s.x); zs.push(s.z); }
  for (const p of resolved.points) { xs.push(p.x); zs.push(p.z); }
  for (const q of resolved.qloads) { xs.push(q.x1, q.x2); }
  if (!xs.length) { xs.push(0, 1); zs.push(0); }
  if (!zs.length) zs.push(0);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const spanX = Math.max(xmax - xmin, 1e-6);
  const spanZ = zmax - zmin;
  // rechts Platz für das Höhenmass, wenn es mehrere Ebenen gibt
  // Seitenränder für Beschriftungen; auf schmalen Bildschirmen etwas knapper
  const side = Math.round(Math.min(SIDE, Math.max(60, width * 0.1)));
  // Horizontallast am Trägerende, die nach aussen ragt: Pfeil (58 px) und Beschriftung brauchen Platz
  const outward = (end, dir) => resolved.points.some((p) => p.horizontal && p.dir === dir && Math.abs(p.x - end) < 0.75);
  const left = outward(xmin, 'right') ? Math.max(side, 112) : side;
  const right = (outward(xmax, 'left') ? Math.max(side, 112) : side) + (spanZ > 1e-9 ? 40 : 0);
  let scale = (width - left - right) / spanX;
  if (spanZ * scale > 300) scale = 300 / spanZ;
  const offsetX = left + (width - left - right - spanX * scale) / 2;
  return {
    width,
    xmin, xmax, zmin, zmax, scale, offsetX,
    X: (x) => offsetX + (x - xmin) * scale,
  };
}

function r(v) {
  return Math.round(v * 10) / 10;
}

// Pfeil wie in der Technischen Zeichnung: schlankes, gefülltes Dreieck (Länge head, Breite ≈ 0.7 · head),
// der Schaft endet an dessen Fuss und sticht nicht durch die Spitze.
export function arrowHeadPath(x, y, angle, head = 9) {
  const half = head * 0.36;
  const bx = x - head * Math.cos(angle);
  const by = y - head * Math.sin(angle);
  const px = -Math.sin(angle) * half;
  const py = Math.cos(angle) * half;
  return `M${r(x)},${r(y)} L${r(bx + px)},${r(by + py)} L${r(bx - px)},${r(by - py)} Z`;
}

function arrowSvg(x1, y1, x2, y2, color, width = 1.7, head = 9) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  // Schaft bis knapp in den Fuss der Spitze (0.5 px Überlappung gegen Lücken beim Kantenglätten)
  const ex = x2 - (head - 0.5) * Math.cos(angle);
  const ey = y2 - (head - 0.5) * Math.sin(angle);
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(ex)}" y2="${r(ey)}" stroke="${color}" stroke-width="${width}" stroke-linecap="butt"/>`
    + `<path d="${arrowHeadPath(x2, y2, angle, head)}" fill="${color}" stroke="${color}" stroke-width="0.5" stroke-linejoin="miter"/>`;
}

function textSvg(x, y, content, options = {}) {
  const anchor = options.anchor || 'middle';
  const size = options.size || 13;
  const color = options.color || COLORS.text;
  const weight = options.weight ? ` font-weight="${options.weight}"` : '';
  const extra = options.attrs || '';
  return `<text x="${r(x)}" y="${r(y)}" text-anchor="${anchor}" font-size="${size}" fill="${color}"${weight}${extra} paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${richText(content, size)}</text>`;
}

// Name mit Index tiefgestellt: „F_A = 85.00 kN“ → F mit kleinem A.
function richText(content, size) {
  const match = String(content).match(/^([^\s_=]+)_([^\s=]+)(.*)$/);
  if (!match) return escapeHtml(content);
  const shift = r(size * 0.28);
  return `${escapeHtml(match[1])}<tspan dy="${shift}" font-size="${r(size * 0.78)}">${escapeHtml(match[2])}</tspan>`
    + `<tspan dy="${-shift}">${escapeHtml(match[3])}</tspan>`;
}

// ---------- Kollisionsfreie Beschriftung ----------

function segmentHitsRect(s, rect) {
  // Liang–Barsky: schneidet die Strecke das Rechteck?
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const p = [-dx, dx, -dy, dy];
  const q = [s.x1 - rect.x1, rect.x2 - s.x1, s.y1 - rect.y1, rect.y2 - s.y1];
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

// Genaue Textbreite (Canvas), ausserhalb des Browsers eine Schätzung
let measureContext = null;
function textWidth(content, size, weight) {
  if (typeof document !== 'undefined') {
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    if (measureContext) {
      measureContext.font = `${weight || 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      return measureContext.measureText(String(content).replace('_', '')).width;
    }
  }
  return String(content).length * size * (weight ? 0.6 : 0.56);
}

function createPlacer(width, height, minY = 0) {
  const boxes = [];
  const segments = [];
  const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

  const textRect = (c, w, size) => {
    const x1 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2;
    return { x1, y1: c.y - size * 0.92, x2: x1 + w, y2: c.y + size * 0.3 }; // voller Schriftkasten (Ober- und Unterlängen)
  };
  const cost = (rect) => {
    let total = 0;
    if (rect.x1 < 2 || rect.x2 > width - 2 || rect.y1 < minY + 2 || rect.y2 > height - 2) total += 100000;
    for (const b of boxes) total += overlap(rect, b) * b.weight;
    for (const s of segments) {
      const padded = { x1: rect.x1 - s.pad, y1: rect.y1 - s.pad, x2: rect.x2 + s.pad, y2: rect.y2 + s.pad };
      if (segmentHitsRect(s, padded)) total += 600 * s.weight;
    }
    return total;
  };

  return {
    box(x1, y1, x2, y2, weight = 1, pad = 0, text = false) {
      boxes.push({ x1: Math.min(x1, x2) - pad, y1: Math.min(y1, y2) - pad, x2: Math.max(x1, x2) + pad, y2: Math.max(y1, y2) + pad, weight, text });
    },
    segment(x1, y1, x2, y2, weight = 1, pad = 3) {
      segments.push({ x1, y1, x2, y2, weight, pad });
    },
    // Ist das Rechteck frei (nichts überdeckt, keine Linie geschnitten)?
    free(x1, y1, x2, y2) {
      return cost({ x1, y1, x2, y2 }) === 0;
    },
    // Rechter Rand aller Elemente in einem waagrechten Band (für das Höhenmass).
    extentRight(y1, y2) {
      let right = -Infinity;
      for (const b of boxes) if (b.y2 >= y1 && b.y1 <= y2 && b.x2 > right) right = b.x2;
      for (const s of segments) {
        if (Math.max(s.y1, s.y2) >= y1 && Math.min(s.y1, s.y2) <= y2) right = Math.max(right, s.x1, s.x2);
      }
      return right;
    },
    // Wählt die erste freie Kandidatenposition, sonst die mit der kleinsten Überdeckung.
    // Sicherheitsnetz: Text liegt nie auf Text. Überdeckt die beste Stelle noch eine andere Beschriftung,
    // wird rund um die Kandidaten nach einer Stelle ohne Textüberdeckung gesucht.
    place(content, candidates, options = {}) {
      const size = options.size || 13;
      const w = textWidth(content, size, options.weight) + 6;
      const textHit = (rect) => boxes.reduce((sum, b) => sum + (b.text ? overlap(rect, b) : 0), 0);
      const outside = (rect) => rect.x1 < 2 || rect.x2 > width - 2 || rect.y1 < minY + 2 || rect.y2 > height - 2;
      let best = null;
      for (const c of candidates) {
        const rect = textRect(c, w, size);
        const c0 = cost(rect);
        if (!best || c0 < best.cost - 1e-9) best = { c, rect, cost: c0 };
        if (c0 === 0) break;
      }
      if (!best) return '';
      if (best.cost > 0 && textHit(best.rect) > 0) {
        let found = null;
        for (const base of [best.c, ...candidates]) {
          for (const dy of [0, -14, 14, -28, 28, -42, 42, -56, 56, -70, 70]) {
            for (const dx of [0, 24, -24, 48, -48, 72, -72, 100, -100, 130, -130, 160, -160]) {
              const c = { ...base, x: base.x + dx, y: base.y + dy };
              const rect = textRect(c, w, size);
              if (outside(rect) || textHit(rect) > 0) continue;
              const c0 = cost(rect);
              if (!found || c0 < found.cost) found = { c, rect, cost: c0 };
            }
          }
          if (found) break;
        }
        if (found) best = found;
      }
      boxes.push({ ...best.rect, x1: best.rect.x1 - 3, x2: best.rect.x2 + 3, y1: best.rect.y1 - 2, y2: best.rect.y2 + 2, weight: 1, text: true });
      const text = textSvg(best.c.x, best.c.y, content, { ...options, anchor: best.c.anchor || 'middle' });
      return options.ref ? `<g class="lbl" data-ref="${options.ref}">${text}</g>` : text;
    },
  };
}

// ---------- Hilfen für Streckenlasten ----------

// Unter der Achse belegt das Symbol eines Lagers auf der Achse die erste Ebene; aufwärts wirkende
// Streckenlasten, die es überdecken würden, rücken eine Ebene weiter nach unten.
function supportSlots(supports, tolerance) {
  return supports
    .filter((s) => isNum(s.x) && Math.abs(s.z - s.axisZ) <= 1e-9)
    .map((s) => ({ level: 0, x1: s.x - tolerance, x2: s.x + tolerance, bottom: s.type === 'rolle' ? 34 : 28 }));
}

function assignQLevels(qloads, reservedBelow = []) {
  const placed = { down: [], up: [...reservedBelow] };
  return qloads.map((q) => {
    const side = q.dir === 'up' ? 'up' : 'down';
    let level = 0;
    while (placed[side].some((p) => p.level === level && p.x1 < q.x2 - 1e-9 && q.x1 < p.x2 - 1e-9)) level += 1;
    placed[side].push({ level, x1: q.x1, x2: q.x2 });
    return level;
  });
}

function axisExtremeZ(axis, x1, x2, wantMax) {
  const zs = [];
  for (const x of [x1, x2, (x1 + x2) / 2]) {
    const z = axisZAt(axis, x);
    if (isNum(z)) zs.push(z);
  }
  for (const p of axis) if (p.x > x1 && p.x < x2) zs.push(p.z);
  if (!zs.length) return 0;
  return wantMax ? Math.max(...zs) : Math.min(...zs);
}

// ---------- Zeichnung ----------

export function renderFigure(result, resolved, options = {}) {
  // Beim Ziehen bleibt der Massstab fest (options.layout), sonst folgt ein Achspunkt nicht dem Zeiger
  const layout = options.layout || computeLayout(resolved, options.width);
  const { X } = layout;
  const decimals = options.decimals ?? 2;
  // Halbe Breite eines Lagersymbols in Metern: so nah gilt etwas als „am Lager“.
  const nearSupport = 22 / layout.scale;
  const slots = supportSlots(resolved.supports, nearSupport);
  const qLevels = assignQLevels(resolved.qloads, slots);
  const qMax = Math.max(0, ...resolved.qloads.map((q) => Math.abs(q.value) || 0));
  const qHeight = (q) => (qMax > 0 ? Math.min(Q_MAX, Math.max(Q_MIN, (Q_MAX * Math.abs(q.value || 0)) / qMax)) : Q_MAX);
  const reactionsReady = !!(result && result.ok);
  // Zeichnen im Massstab (Haken „Massstab“): Pfeillängen nach dem Kräftemassstab, Masse in cm auf dem Blatt
  const paper = options.paper && options.paper.length > 0 && options.paper.force > 0 ? options.paper : null;
  const pxPerCm = paper ? layout.scale * paper.length : 0;
  const paperCm = (value) => (paper ? Math.abs(value) / paper.force : 0);
  // Ohne Massstab: Pfeillänge nach dem Betrag, im Verhältnis zur grössten Last bzw. Lagerkraft im Bild (gleiche
  // Kräfte gleich lang); mindestens 45 %, damit auch kleine Kräfte lesbar bleiben
  const pointMax = Math.max(0, ...resolved.points.map((p) => Math.abs(p.value) || 0));
  const reactionMax = result && result.ok ? Math.max(0, ...result.reactions.flatMap((s) => [Math.abs(s.Rz || 0), Math.abs(s.Rx || 0)])) : 0;
  const relative = (value, max) => (max > 0 ? Math.min(1, Math.max(0.45, Math.abs(value) / max)) : 1);
  const forceLength = (value, fallback, max = pointMax) => (paper ? Math.min(420, Math.max(8, paperCm(value) * pxPerCm)) : fallback * relative(value, max));
  const cmText = (value) => (paper ? `  ·  ${label(paperCm(value), 2)} cm` : '');
  const reactionOf = (s) => (reactionsReady ? result.reactions.find((item) => item.name === s.name) : null);

  // Unterkante des Stapels an einer Stelle (Pixel ab der Achse): Lastblöcke und, unter der
  // Achse, Lagersymbole. side 'down' = über der Achse, 'up' = unter der Achse.
  const stackBottom = (x, side, tolerance = 1e-9) => {
    let bottom = 0;
    resolved.qloads.forEach((q, i) => {
      const qSide = q.dir === 'up' ? 'up' : 'down';
      if (qSide === side && x >= q.x1 - tolerance && x <= q.x2 + tolerance) bottom = Math.max(bottom, Q_GAP + qLevels[i] * Q_STEP + qHeight(q));
    });
    if (side === 'up') for (const slot of slots) if (x >= slot.x1 && x <= slot.x2) bottom = Math.max(bottom, slot.bottom);
    return bottom;
  };
  // Abstand eines Lastpfeils von der Achse: er beginnt unter bzw. über dem Stapel an seiner Stelle.
  const pointClearance = (p) => {
    if (p.dir !== 'down' && p.dir !== 'up') return 0;
    if (Math.abs(p.z - p.axisZ) > 1e-9) return 0;
    return stackBottom(p.x, p.dir === 'down' ? 'down' : 'up');
  };
  // Abstand vom Lagerpunkt bis unter alles, was unter dem Lager liegt (Symbol, Lastblöcke,
  // aufwärts wirkende Lastpfeile): dort beginnt der Stapel der Auflagerreaktionen.
  const supportBase = (s) => {
    const hanging = s.z > s.axisZ + 1e-9;
    const onAxis = Math.abs(s.z - s.axisZ) <= 1e-9;
    if (hanging || !onAxis) return 38;
    let bottom = stackBottom(s.x, 'up', nearSupport);
    for (const p of resolved.points) {
      if (p.dir === 'up' && Math.abs(p.z - p.axisZ) <= 1e-9 && Math.abs(p.x - s.x) <= nearSupport) {
        bottom = Math.max(bottom, 3 + pointClearance(p) + forceLength(p.value, ARROW));
      }
    }
    return Math.max(38, bottom + 8);
  };

  // Platzbedarf über der obersten und unter der untersten Ebene: nur so viel Rand wie nötig.
  let needAbove = 10;
  let needBelow = 16;
  const fromTop = (z) => (layout.zmax - z) * layout.scale;
  const fromBottom = (z) => (z - layout.zmin) * layout.scale;
  const needUp = (z, extent) => { needAbove = Math.max(needAbove, extent - fromTop(z)); };
  const needDown = (z, extent) => { needBelow = Math.max(needBelow, extent - fromBottom(z)); };
  for (const p of resolved.points) {
    if (p.dir === 'down') needUp(p.z, 3 + pointClearance(p) + forceLength(p.value, ARROW) + 20);
    else if (p.dir === 'up') needDown(p.z, 3 + pointClearance(p) + forceLength(p.value, ARROW) + 22);
    else { needUp(p.z, 30); needDown(p.z, 34); }
  }
  resolved.qloads.forEach((q, i) => {
    const down = q.dir !== 'up';
    const z = axisExtremeZ(resolved.axis, q.x1, q.x2, down);
    const extent = Q_GAP + qLevels[i] * Q_STEP + qHeight(q) + 22;
    if (down) needUp(z, extent);
    else needDown(z, extent);
  });
  for (const s of resolved.supports) {
    if (!isNum(s.x)) continue;
    const hanging = s.z > s.axisZ + 1e-9;
    const extent = supportBase(s) + (reactionsReady ? forceLength((reactionOf(s) || {}).Rz || 0, REACTION, reactionMax) + 30 : 0);
    if (hanging) needUp(s.z, extent);
    else needDown(s.z, extent);
  }
  const naturalTop = 44 + needAbove;
  const top = Number.isFinite(options.top) ? options.top : naturalTop;
  // Beim Ziehen bleibt die Lage fest (options.top). Braucht der Inhalt oben mehr Platz, wächst die
  // Fläche über y = 0 hinaus nach oben (viewTop < 0); app.js gleicht das mit der Bildlaufposition aus.
  const viewTop = Math.min(0, top - naturalTop);
  const Y = (z) => top + (layout.zmax - z) * layout.scale;
  const height = Y(layout.zmin) + needBelow + 66;

  const shapes = [];
  const handles = [];
  const labels = [];
  const placer = createPlacer(layout.width, height, viewTop);
  const reactions = result && result.ok ? result.reactions : null;
  const pivotName = result && result.ok ? result.pivotName : null;

  // Koordinatenrichtung und Legende
  shapes.push(arrowSvg(18, 34, 50, 34, COLORS.muted, 1.4, 7), textSvg(56, 38, 'x', { anchor: 'start', size: 12, color: COLORS.muted }));
  shapes.push(arrowSvg(18, 34, 18, 6, COLORS.muted, 1.4, 7), textSvg(26, 14, 'z', { anchor: 'start', size: 12, color: COLORS.muted }));
  placer.box(8, 0, 70, 44);
  if (pivotName) {
    // Klick auf die Legende wechselt den Drehpunkt (siehe app.js)
    shapes.push(`<g class="pivot-toggle" data-pivot-toggle="1"><title>Klicken: Drehpunkt wechseln</title>`
      + `<rect x="82" y="18" width="250" height="24" rx="6" fill="transparent"/>`
      + `<circle cx="92" cy="30" r="5" fill="#ffffff" stroke="${COLORS.pivot}" stroke-width="2"/>`
      + textSvg(102, 34, `Drehpunkt (DP): Lager ${pivotName}  ⇄`, { anchor: 'start', size: 12, color: COLORS.pivot, weight: 600 })
      + '</g>');
    placer.box(84, 18, 300, 42, 1, 0, true);
  }
  if (paper) {
    const ratio = Math.round(paper.length * 100 * 1000) / 1000;
    const legend = `Massstab 1:${ratio}  ·  1 cm ≙ ${paper.force} kN`;
    const legendX = pivotName ? 300 : 84;
    shapes.push(textSvg(legendX, 34, legend, { anchor: 'start', size: 12, color: COLORS.text, weight: 600 }));
    placer.box(legendX - 4, 18, legendX + 260, 42, 1, 0, true);
  }

  // Feines Raster im Hintergrund (Häkchen „Raster anzeigen“)
  const gridParts = [];
  const grid = options.grid;
  if (grid && grid.show && grid.step > 0) {
    let step = grid.step;
    while (step * layout.scale < 7) step *= 2;
    const xFrom = layout.xmin - layout.offsetX / layout.scale;
    const xTo = layout.xmin + (layout.width - layout.offsetX) / layout.scale;
    const zFrom = layout.zmax - (height - top) / layout.scale;
    const zTo = layout.zmax + (top - viewTop) / layout.scale;
    const isMajor = (v) => Math.abs(v - Math.round(v)) < 1e-7;
    const lines = [];
    for (let k = Math.ceil(xFrom / step); k * step <= xTo && lines.length < 900; k++) {
      const v = k * step;
      lines.push(`<line x1="${r(X(v))}" y1="${r(viewTop)}" x2="${r(X(v))}" y2="${r(height)}" class="${isMajor(v) ? 'grid-major' : 'grid-minor'}"/>`);
    }
    for (let k = Math.ceil(zFrom / step); k * step <= zTo && lines.length < 1800; k++) {
      const v = k * step;
      lines.push(`<line x1="0" y1="${r(Y(v))}" x2="${layout.width}" y2="${r(Y(v))}" class="${isMajor(v) ? 'grid-major' : 'grid-minor'}"/>`);
    }
    gridParts.push(`<g class="grid" stroke-width="1" shape-rendering="crispEdges">${lines.join('')}</g>`);
  }

  // Trägerachse
  const angleMarks = [];
  if (resolved.axis.length >= 2) {
    const d = resolved.axis.map((p, i) => `${i ? 'L' : 'M'}${r(X(p.x))},${r(Y(p.z))}`).join(' ');
    shapes.push(`<path class="axis-base" d="${d}" fill="none" stroke="${COLORS.axis}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`);
    for (let i = 1; i < resolved.axis.length; i++) {
      const a = resolved.axis[i - 1];
      const b = resolved.axis[i];
      placer.segment(X(a.x), Y(a.z), X(b.x), Y(b.z), 1, 4);
      // Abschnitt anwählbar: markiert seine beiden Endpunkte (Griffe zum Ziehen)
      const ends = `x1="${r(X(a.x))}" y1="${r(Y(a.z))}" x2="${r(X(b.x))}" y2="${r(Y(b.z))}"`;
      shapes.push(`<g class="seg" data-ref="A:${a.source}" data-ends="P:${a.source},P:${b.source}">`
        + `<line ${ends} stroke="${COLORS.axis}" stroke-width="2.6" stroke-linecap="round"/>`
        + `<line ${ends} stroke="transparent" stroke-width="14"/></g>`);
      // Neigungswinkel schräger Abschnitte gegen die Waagrechte
      const dxModel = b.x - a.x;
      const dzModel = b.z - a.z;
      if (options.showAngles !== false && Math.abs(dxModel) > 1e-9 && Math.abs(dzModel) > 1e-9) {
        const px = X(a.x);
        const py = Y(a.z);
        const a0 = dxModel > 0 ? 0 : Math.PI;
        const a1 = Math.atan2(Y(b.z) - py, X(b.x) - px);
        const radius = 30;
        const sweep = Math.cos(a0) * Math.sin(a1) - Math.sin(a0) * Math.cos(a1) > 0 ? 1 : 0;
        const sx = px + radius * Math.cos(a0);
        const sy = py + radius * Math.sin(a0);
        const ex = px + radius * Math.cos(a1);
        const ey = py + radius * Math.sin(a1);
        shapes.push(`<line x1="${r(px)}" y1="${r(py)}" x2="${r(px + 46 * Math.cos(a0))}" y2="${r(py)}" stroke="${COLORS.dim}" stroke-width="0.9" stroke-dasharray="3 3"/>`);
        shapes.push(`<path d="M${r(sx)},${r(sy)} A${radius},${radius} 0 0 ${sweep} ${r(ex)},${r(ey)}" fill="none" stroke="${COLORS.pivot}" stroke-width="1.2"/>`);
        placer.box(Math.min(sx, ex) - 2, Math.min(sy, ey) - 2, Math.max(sx, ex) + 2, Math.max(sy, ey) + 2, 1);
        const degrees = (Math.atan2(Math.abs(dzModel), Math.abs(dxModel)) * 180) / Math.PI;
        const mid = (a0 + (a1 < 0 && a0 === Math.PI ? a1 + 2 * Math.PI : a1)) / 2;
        angleMarks.push({ px, py, mid, text: `${degrees.toFixed(1)}°` });
      }
    }
  }

  // Stützen und Hänger zu Lagern neben der Achse
  resolved.supports.forEach((s, i) => {
    if (!isNum(s.x) || Math.abs(s.z - s.axisZ) <= 1e-9) return;
    shapes.push(`<line data-ref="S:${i}" x1="${r(X(s.x))}" y1="${r(Y(s.axisZ))}" x2="${r(X(s.x))}" y2="${r(Y(s.z))}" stroke="${COLORS.member}" stroke-width="3.6" stroke-linecap="round"/>`);
    placer.segment(X(s.x), Y(s.axisZ), X(s.x), Y(s.z), 1, 4);
  });
  // Stiele/Konsolen zu Lasten neben der Achse
  resolved.points.forEach((p, i) => {
    if (Math.abs(p.z - p.axisZ) <= 1e-9) return;
    shapes.push(`<g data-ref="L:${p.source ?? i}"><line x1="${r(X(p.x))}" y1="${r(Y(p.axisZ))}" x2="${r(X(p.x))}" y2="${r(Y(p.z))}" stroke="${COLORS.member}" stroke-width="2.4" stroke-linecap="round"/>`
      + `<circle cx="${r(X(p.x))}" cy="${r(Y(p.z))}" r="3.5" fill="${COLORS.member}"/></g>`);
    placer.segment(X(p.x), Y(p.axisZ), X(p.x), Y(p.z), 1, 3);
  });

  // Streckenlasten
  const qBlocks = [];
  resolved.qloads.forEach((q, i) => {
    const down = q.dir !== 'up';
    const level = qLevels[i];
    const x1 = X(q.x1);
    const x2 = X(q.x2);
    const zEdge = axisExtremeZ(resolved.axis, q.x1, q.x2, down);
    const yAxis = Y(zEdge);
    const qh = qHeight(q);
    const yNear = down ? yAxis - Q_GAP - level * Q_STEP : yAxis + Q_GAP + level * Q_STEP;
    const yFar = down ? yNear - qh : yNear + qh;
    const yTop = Math.min(yNear, yFar);
    const source = q.source ?? i;
    shapes.push(`<g class="drag" data-drag="q:${source}" data-ref="L:${source}"><rect x="${r(x1)}" y="${r(yTop)}" width="${r(x2 - x1)}" height="${r(qh)}" fill="${COLORS.qFill}" stroke="${COLORS.q}" stroke-width="1"/>`);
    const count = Math.max(2, Math.round((x2 - x1) / 34));
    for (let k = 0; k <= count; k++) {
      const x = x1 + ((x2 - x1) * k) / count;
      shapes.push(arrowSvg(x, yFar, x, yNear, COLORS.q, 1, 5.5));
    }
    shapes.push('</g>');
    // Griffe an beiden Enden: unsichtbar, beim Überfahren oder Anwählen der Streckenlast sichtbar
    const grip = (kind, x) => `<g class="drag edge" data-drag="${kind}:${source}" data-ref="L:${source}">`
      + `<rect x="${r(x - 6)}" y="${r(yTop - 3)}" width="12" height="${r(qh + 6)}" fill="transparent"/>`
      + `<rect class="grip" x="${r(x - 3.5)}" y="${r(yTop + qh / 2 - 8)}" width="7" height="16" rx="2.5"/></g>`;
    handles.push(grip('q1', x1), grip('q2', x2));
    placer.box(x1, yTop, x2, yTop + qh, 1.5, 4);
    qBlocks.push({ q, x1, x2, yTop, down, h: qh });
  });

  // Einzellasten (Pfeile)
  const pointArrows = [];
  resolved.points.forEach((p, i) => {
    const x = X(p.x);
    const y = Y(p.z);
    const source = p.source ?? i;
    let tail;
    let tip;
    if (p.dir === 'down' || p.dir === 'up') {
      const clearance = pointClearance(p);
      const sign = p.dir === 'down' ? -1 : 1;
      tip = { x, y: y + sign * (3 + clearance) };
      tail = { x, y: tip.y + sign * forceLength(p.value, ARROW) };
    } else {
      const toRight = p.dir === 'right';
      tip = { x: toRight ? x - 4 : x + 4, y };
      const hLength = forceLength(p.value, H_ARROW);
      tail = { x: toRight ? x - hLength : x + hLength, y };
    }
    shapes.push(`<g class="drag" data-drag="F:${source}" data-ref="L:${source}">${arrowSvg(tail.x, tail.y, tip.x, tip.y, COLORS.load, 1.6, 9.5)}<line x1="${r(tail.x)}" y1="${r(tail.y)}" x2="${r(tip.x)}" y2="${r(tip.y)}" stroke="transparent" stroke-width="14"/></g>`);
    placer.segment(tail.x, tail.y, tip.x, tip.y, 1, 3);
    pointArrows.push({ p, tail, tip });
  });

  // Lager
  const supportGeometry = [];
  resolved.supports.forEach((s, i) => {
    if (!isNum(s.x)) return;
    const x = X(s.x);
    const y = Y(s.z);
    const hanging = s.z > s.axisZ + 1e-9;
    const dirSign = hanging ? -1 : 1;
    const groundY = y + dirSign * (s.type === 'rolle' ? 28 : 22);
    const parts = [];
    // Nur die beiden Seiten des Dreiecks: Die Grundseite liegt immer auf einer waagrechten Linie (Boden bzw.
    // Rollenlinie), und die wird pixelgenau (crispEdges) gezeichnet, sonst verschmiert sie über zwei Pixelreihen.
    const baseY = y + dirSign * 22;
    parts.push(`<path d="M${r(x - 13)},${r(baseY)} L${r(x)},${r(y)} L${r(x + 13)},${r(baseY)}" fill="#ffffff" stroke="${COLORS.axis}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (s.type === 'rolle') {
      parts.push(`<line x1="${r(x - 15)}" y1="${r(baseY)}" x2="${r(x + 15)}" y2="${r(baseY)}" stroke="${COLORS.axis}" stroke-width="1.5" shape-rendering="crispEdges"/>`);
    }
    parts.push(`<line x1="${r(x - 19)}" y1="${r(groundY)}" x2="${r(x + 19)}" y2="${r(groundY)}" stroke="${COLORS.axis}" stroke-width="1.5" shape-rendering="crispEdges"/>`);
    for (let k = -3; k <= 2; k++) {
      const hx = x + k * 6.5;
      parts.push(`<line x1="${r(hx)}" y1="${r(groundY)}" x2="${r(hx + 6)}" y2="${r(groundY + dirSign * 6)}" stroke="${COLORS.member}" stroke-width="1.1"/>`);
    }
    if (pivotName === s.name) parts.push(`<circle cx="${r(x)}" cy="${r(y)}" r="5" fill="#ffffff" stroke="${COLORS.pivot}" stroke-width="2"/>`);
    parts.push(`<rect x="${r(x - 20)}" y="${r(Math.min(y, groundY + dirSign * 6))}" width="40" height="${r(Math.abs(groundY + dirSign * 6 - y))}" fill="transparent"/>`);
    shapes.push(`<g class="drag" data-drag="S:${i}" data-ref="S:${i}">${parts.join('')}</g>`);
    placer.box(x - 20, y, x + 20, groundY + dirSign * 7, 1, 1);
    supportGeometry.push({ s, index: i, x, y, hanging, dirSign });
  });

  // Auflagerreaktionen als Stapel unter dem Lager: Vertikal- und Horizontalkomponente
  // gehen vom selben Punkt aus (Ecke), die Horizontalkomponente zur Aussenseite.
  const reactionArrows = [];
  if (reactions) {
    const xsOfSupports = resolved.supports.filter((s) => isNum(s.x)).map((s) => s.x);
    const leftMost = Math.min(...xsOfSupports);
    for (const geometry of supportGeometry) {
      const { s, index, x, y, hanging, dirSign } = geometry;
      const ref = `S:${index}`;
      const rx = reactions.find((item) => item.name === s.name);
      if (!rx) continue;
      const corner = y + dirSign * supportBase(s);
      const outerSide = Math.abs(s.x - leftMost) < 1e-9 && xsOfSupports.length > 1 ? -1 : 1;
      const hasZ = Math.abs(rx.Rz) > 1e-9;
      const hasX = rx.hasRx && Math.abs(rx.Rx) > 1e-9;
      if (hasZ) {
        // positiv = nach oben; der Pfeil zeigt in die tatsächliche Richtung
        const towardSupport = (rx.Rz > 0) !== hanging;
        const far = corner + dirSign * forceLength(rx.Rz, REACTION, reactionMax);
        const tail = towardSupport ? far : corner;
        const tip = towardSupport ? corner : far;
        shapes.push(`<g data-ref="${ref}">${arrowSvg(x, tail, x, tip, COLORS.reaction, 1.9, 10)}</g>`);
        placer.segment(x, tail, x, tip, 1, 3);
        reactionArrows.push({ kind: 'z', rx, ref, x, y1: corner, y2: far, dirSign, outerSide });
      }
      if (hasX) {
        // auf Höhe der Ecke, wenn es keine Vertikalkomponente gibt, sonst gleich daneben
        const yh = hasZ ? corner + dirSign * 6 : corner;
        const outerX = x + outerSide * forceLength(rx.Rx, 66, reactionMax);
        const pointsOutward = (rx.Rx > 0) === (outerSide > 0);
        const tail = pointsOutward ? x : outerX;
        const tip = pointsOutward ? outerX : x;
        shapes.push(`<g data-ref="${ref}">${arrowSvg(tail, yh, tip, yh, COLORS.reaction, 1.9, 10)}</g>`);
        placer.segment(tail, yh, tip, yh, 1, 3);
        reactionArrows.push({ kind: 'x', rx, ref, x1: Math.min(tail, tip), x2: Math.max(tail, tip), y: yh, dirSign, outerSide });
      }
    }
  }

  // Griffe am gewählten Stab (Stütze, Hänger, Stiel, Achsabschnitt):
  // Endgriff (Quadrat) = Stablänge bzw. Knoten verschieben, Mittelgriff (Kreis) = ganzen Stab verschieben.
  const chosen = new Set(Array.isArray(options.focus) ? options.focus : []);
  const orientOf = (ddx, ddy) => (Math.abs(ddy) < Math.abs(ddx) * 0.25 ? 'ew' : Math.abs(ddx) < Math.abs(ddy) * 0.25 ? 'ns' : 'free');
  const gripNode = (x, y, key, ref, orient) => `<rect class="grip-node ${orient} drag" data-drag="${key}" data-ref="${ref}" x="${r(x - 5)}" y="${r(y - 5)}" width="10" height="10" rx="2"/>`;
  const gripMid = (x, y, key, ref) => `<circle class="grip-mid drag" data-drag="${key}" data-ref="${ref}" cx="${r(x)}" cy="${r(y)}" r="5.5"/>`;
  const vertexOrient = new Map();
  for (let i = 1; i < resolved.axis.length; i++) {
    const a = resolved.axis[i - 1];
    const b = resolved.axis[i];
    if (!chosen.has(`A:${a.source}`)) continue;
    const orient = orientOf(X(b.x) - X(a.x), Y(b.z) - Y(a.z));
    vertexOrient.set(a.source, orient);
    vertexOrient.set(b.source, orient);
    handles.push(gripMid((X(a.x) + X(b.x)) / 2, (Y(a.z) + Y(b.z)) / 2, `Am:${a.source}:${b.source}`, `A:${a.source}`));
  }
  resolved.supports.forEach((s, i) => {
    if (!chosen.has(`S:${i}`) || !isNum(s.x)) return;
    handles.push(gripNode(X(s.x), Y(s.z), `Sn:${i}`, `S:${i}`, 'ns'));
    if (Math.abs(s.z - s.axisZ) > 1e-9) handles.push(gripMid(X(s.x), (Y(s.z) + Y(s.axisZ)) / 2, `Sm:${i}`, `S:${i}`));
  });
  resolved.points.forEach((p) => {
    const ref = `L:${p.source}`;
    if (!chosen.has(ref)) return;
    const stiel = Math.abs(p.z - p.axisZ) > 1e-9;
    if (stiel || p.horizontal) handles.push(gripNode(X(p.x), Y(p.z), `Fn:${p.source}`, ref, 'ns'));
    if (stiel) handles.push(gripMid(X(p.x), (Y(p.z) + Y(p.axisZ)) / 2, `Fm:${p.source}`, ref));
  });

  // Ziehpunkte an den Achsecken (bei gewähltem Abschnitt mit dessen Richtung für den Zeiger)
  resolved.axis.forEach((p, i) => {
    const source = p.source ?? i;
    const orient = vertexOrient.get(source) || '';
    handles.push(`<circle class="drag vertex ${orient}" data-drag="P:${source}" data-ref="P:${source}" cx="${r(X(p.x))}" cy="${r(Y(p.z))}" r="7"/>`);
  });

  // Ausgewählte Elemente (Klick in der Skizze oder Zeile in der Eingabe): Masse nur für diese.
  const focus = new Set(Array.isArray(options.focus) ? options.focus : []);
  // Ein angewählter Achsabschnitt steht für seine beiden Endpunkte.
  const direct = new Set(focus);
  for (let i = 1; i < resolved.axis.length; i++) {
    if (focus.has(`A:${resolved.axis[i - 1].source}`)) {
      focus.add(`P:${resolved.axis[i - 1].source}`);
      focus.add(`P:${resolved.axis[i].source}`);
    }
  }
  const focused = focus.size > 0;
  const isFocused = (kind, item, i) => focus.has(`${kind}:${item.source ?? i}`);
  // Masszahlen: dunkelgrau wie im Bauplan, die Masse der Auswahl blau
  const dimColor = focused ? COLORS.pivot : DIM_STYLE.text;
  const dimClass = focused ? '' : ' class="dim-text"';

  // Masskette in x (unten): Achsenden und alle Punkte bzw. nur die Auswahl
  const dimXs = [];
  // Zu wem gehört eine Massstelle? Damit lässt sich ein blaues Mass anklicken und ändern (app.js).
  const xOwners = [];
  const addX = (x, owner) => {
    if (!isNum(x)) return;
    if (!dimXs.some((v) => Math.abs(v - x) < 1e-7)) dimXs.push(x);
    if (owner) xOwners.push({ value: x, owner });
  };
  const ownerAt = (owners, value) => (owners.find((o) => Math.abs(o.value - value) < 1e-7) || {}).owner || '';
  if (focused) {
    const axisXs = resolved.axis.map((p) => p.x).filter(isNum);
    if (axisXs.length) { addX(Math.min(...axisXs)); addX(Math.max(...axisXs)); }
    resolved.supports.forEach((s, i) => { if (focus.has(`S:${i}`)) addX(s.x, `S:${i}`); });
    resolved.points.forEach((p, i) => { if (isFocused('L', p, i)) addX(p.x, `L:${p.source ?? i}`); });
    resolved.qloads.forEach((q, i) => { if (isFocused('L', q, i)) { addX(q.x1, `L:${q.source ?? i}`); addX(q.x2, `L:${q.source ?? i}`); } });
    resolved.axis.forEach((p, i) => { if (isFocused('P', p, i)) addX(p.x, `P:${p.source ?? i}`); });
  } else {
    for (const p of resolved.axis) addX(p.x);
    for (const s of resolved.supports) addX(s.x);
    for (const p of resolved.points) addX(p.x);
    for (const q of resolved.qloads) { addX(q.x1); addX(q.x2); }
  }
  dimXs.sort((a, b) => a - b);
  const dimY = height - 50;
  // Im Massstab-Modus Längen in cm auf dem Blatt
  const dimText = (d) => (paper ? `${measure(d / paper.length)} cm` : measure(d));
  const dimTexts = [];
  // Bauplan-Stil (dimension.js, überall gleich): Masshilfslinien vom Bauteil (mit Abstand) bis über die
  // Masslinie, kräftige Schrägstriche, Masslinie überstehend, Masszahl über der Linie.
  const DIM_GAP = DIM_STYLE.gap;
  const DIM_OVER = DIM_STYLE.lineOver;
  const EXT_OVER = DIM_STYLE.extOver;
  const tick = (x, y, vertical = false) => dimSlash(x, y, vertical);
  const extension = (x1, y1, x2, y2) => extLine(x1, y1, x2, y2);
  // Unterkante dessen, was an der Stelle x gezeichnet ist: Achse, Lager samt Reaktionspfeil,
  // Lastpfeile, Lastblöcke. Dort beginnt die Masshilfslinie.
  const lowestAt = (xm) => {
    const px = X(xm);
    const near = (v) => Math.abs(v - px) < 1.5;
    let y = null;
    const take = (v) => { if (Number.isFinite(v) && (y === null || v > y)) y = v; };
    const az = axisZAt(resolved.axis, xm);
    if (isNum(az)) take(Y(az) + 2);
    for (const g of supportGeometry) if (near(g.x)) take(g.hanging ? g.y + 2 : g.y + (g.s.type === 'rolle' ? 34 : 28));
    for (const a of reactionArrows) {
      if (a.kind === 'z' && near(a.x)) take(Math.max(a.y1, a.y2));
      if (a.kind === 'x' && (near(a.x1) || near(a.x2))) take(a.y + 2);
    }
    for (const a of pointArrows) if (near(a.tip.x) || near(a.tail.x)) take(Math.max(a.tail.y, a.tip.y));
    for (const q of qBlocks) if (near(q.x1) || near(q.x2)) take(q.yTop + q.h);
    return y;
  };
  if (dimXs.length >= 2) {
    const a = X(dimXs[0]);
    const b = X(dimXs[dimXs.length - 1]);
    // Gesamtmass nur, wenn die Kette aus mehreren Stücken besteht (sonst stünde dasselbe Mass zweimal da)
    const withTotal = dimXs.length > 2;
    const totalY = dimY + DIM_STYLE.chainGap;
    shapes.push(dimLine(a - DIM_OVER, dimY, b + DIM_OVER, dimY));
    placer.segment(a, dimY, b, dimY, 1, 2);
    dimXs.forEach((xm, i) => {
      const px = X(xm);
      const low = lowestAt(xm);
      const outer = withTotal && (i === 0 || i === dimXs.length - 1);
      const from = low === null ? dimY - 12 : Math.min(low + DIM_GAP, dimY - 6);
      shapes.push(extension(px, from, px, (outer ? totalY : dimY) + EXT_OVER));
      placer.segment(px, from, px, dimY, 0.4, 1);
      shapes.push(tick(px, dimY));
    });
    for (let i = 1; i < dimXs.length; i++) {
      const xa = X(dimXs[i - 1]);
      const xb = X(dimXs[i]);
      const first = i === 1;
      const last = i === dimXs.length - 1;
      // Zu kurzes Stück: Zahl wie im Bauplan ausserhalb neben die Masslinie (am Kettenende) oder
      // eine Zeile höher. Ohne Auswahl nur an den Kettenenden, damit die Kette ruhig bleibt.
      const narrow = xb - xa < 26;
      if (narrow && !focused && !first && !last) continue;
      const candidates = narrow
        ? [
          first ? { x: xa - 8, y: dimY - 5, anchor: 'end' } : null,
          last ? { x: xb + 8, y: dimY - 5, anchor: 'start' } : null,
          { x: (xa + xb) / 2, y: dimY - 18 },
          { x: xb + 8, y: dimY - 5, anchor: 'start' },
          { x: xa - 8, y: dimY - 5, anchor: 'end' },
        ].filter(Boolean)
        : [{ x: (xa + xb) / 2, y: dimY - 5 }];
      // Blaue Masse (Auswahl) sind anklickbar: Enden und Werte stehen als data-Attribute dabei
      const attrs = focused && !paper
        ? ` data-dim="x" data-a="${ownerAt(xOwners, dimXs[i - 1])}" data-b="${ownerAt(xOwners, dimXs[i])}" data-va="${dimXs[i - 1]}" data-vb="${dimXs[i]}"`
        : '';
      dimTexts.push({ candidates, text: dimText(dimXs[i] - dimXs[i - 1]), size: xb - xa < 42 ? 11 : DIM_STYLE.size, color: focused ? dimColor : null, attrs });
    }
    if (withTotal) {
      shapes.push(dimLine(a - DIM_OVER, totalY, b + DIM_OVER, totalY));
      for (const x of [a, b]) shapes.push(tick(x, totalY));
      dimTexts.push({ x: (a + b) / 2, y: totalY - DIM_STYLE.textGap, text: dimText(dimXs[dimXs.length - 1] - dimXs[0]), size: DIM_STYLE.size });
    }
  }

  for (const t of dimTexts) {
    // Masse der Auswahl blau und fett
    const candidates = t.candidates || [{ x: t.x, y: t.y, anchor: t.anchor || 'middle' }];
    labels.push(placer.place(t.text, candidates, { size: t.color ? t.size + 0.5 : t.size, color: t.color || DIM_STYLE.text, weight: t.color ? 700 : undefined, attrs: `${t.attrs || ''}${t.color ? '' : ' class="dim-text"'}` }));
  }

  // ---------- Beschriftungen ----------

  // Lagernamen
  for (const { s, index, x, y, dirSign } of supportGeometry) {
    const base = y + dirSign * 16 + 5;
    labels.push(placer.place(s.name, [
      { x: x - 24, y: base, anchor: 'end' },
      { x: x + 24, y: base, anchor: 'start' },
      { x: x - 12, y: y - dirSign * 10, anchor: 'end' },
      { x: x + 12, y: y - dirSign * 10, anchor: 'start' },
      { x: x - 24, y: base + dirSign * 18, anchor: 'end' },
    ], { size: 14, weight: 700, ref: `S:${index}` }));
  }

  // Neigungswinkel
  for (const m of angleMarks) {
    const candidates = [44, 56, 70].map((radius) => ({ x: m.px + radius * Math.cos(m.mid), y: m.py + radius * Math.sin(m.mid) + 4 }));
    labels.push(placer.place(m.text, candidates, { size: 11.5, color: COLORS.pivot, weight: 600 }));
  }

  // Reaktionen: Horizontalkomponente zuerst (neben ihrem Pfeil), dann die Vertikalkomponente
  // auf der Innenseite des senkrechten Pfeils, so bleibt der Stapel am Lager kompakt.
  const reactionSize = { size: 12, color: COLORS.reaction, weight: 600 };
  for (const a of reactionArrows.filter((item) => item.kind === 'x')) {
    const content = `${a.rx.name}x = ${label(Math.abs(a.rx.Rx), decimals)} kN${cmText(a.rx.Rx)}`;
    const midX = (a.x1 + a.x2) / 2;
    const outerEnd = a.outerSide > 0 ? a.x2 : a.x1;
    // bündig neben dem senkrechten Reaktionspfeil am Lager, damit die Zahl ihn nicht überdeckt
    const besideShaft = a.outerSide > 0 ? { x: a.x1 + 6, anchor: 'start' } : { x: a.x2 - 6, anchor: 'end' };
    const below = a.y + a.dirSign * 16 + (a.dirSign < 0 ? 9 : 0);
    const above = a.y - a.dirSign * 7 + (a.dirSign < 0 ? 9 : 0);
    const further = a.y + a.dirSign * 32 + (a.dirSign < 0 ? 9 : 0);
    labels.push(placer.place(content, [
      { x: midX, y: below },
      { ...besideShaft, y: below },
      { x: outerEnd + a.outerSide * 6, y: a.y + 4, anchor: a.outerSide > 0 ? 'start' : 'end' },
      { x: midX, y: above },
      { ...besideShaft, y: above },
      { x: midX, y: further },
      { ...besideShaft, y: further },
    ], { ...reactionSize, ref: a.ref }));
  }
  for (const a of reactionArrows.filter((item) => item.kind === 'z')) {
    const content = `${a.rx.name}z = ${label(Math.abs(a.rx.Rz), decimals)} kN${cmText(a.rx.Rz)}`;
    const mid = (a.y1 + a.y2) / 2 + 4;
    const end = a.y2 + a.dirSign * 16 + (a.dirSign < 0 ? 8 : 0);
    const inner = -a.outerSide;
    labels.push(placer.place(content, [
      { x: a.x + inner * 8, y: mid, anchor: inner > 0 ? 'start' : 'end' },
      { x: a.x - inner * 8, y: mid + 12, anchor: inner > 0 ? 'end' : 'start' },
      { x: a.x, y: end, anchor: 'middle' },
      { x: a.x + inner * 8, y: a.y2, anchor: inner > 0 ? 'start' : 'end' },
    ], { ...reactionSize, ref: a.ref }));
  }

  // Streckenlasten
  for (const b of qBlocks) {
    const content = `${b.q.label} = ${label(b.q.value, decimals)} kN/m`;
    const center = (b.x1 + b.x2) / 2;
    const above = b.yTop - 6;
    const belowY = b.yTop + b.h + 15;
    const inside = b.yTop + b.h / 2 + 4;
    // mehrere Stellen entlang des Blocks, damit die Beschriftung zwischen Lastpfeilen Platz findet
    const along = [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6].map((f) => b.x1 + (b.x2 - b.x1) * f);
    const rowY = b.down ? above : belowY;
    const outer = [
      ...along.map((x) => ({ x, y: rowY })),
      { x: b.x1, y: rowY, anchor: 'start' },
      { x: b.x2, y: rowY, anchor: 'end' },
      ...along.slice(0, 3).map((x) => ({ x, y: b.down ? above - 16 : belowY + 16 })),
    ];
    labels.push(placer.place(content, [
      ...outer,
      { x: b.x1 - 6, y: inside, anchor: 'end' },
      { x: b.x2 + 6, y: inside, anchor: 'start' },
      { x: b.x1 + 6, y: inside, anchor: 'start' },
    ], { size: 12, color: COLORS.q, weight: 500, ref: `L:${b.q.source}` }));
  }

  // Einzellasten
  for (const { p, tail, tip } of pointArrows) {
    const content = `${p.label} = ${label(p.value, decimals)} kN${cmText(p.value)}`;
    let candidates;
    if (p.dir === 'down') {
      candidates = [
        { x: tail.x, y: tail.y - 6 },
        { x: tail.x + 6, y: tail.y + 10, anchor: 'start' },
        { x: tail.x - 6, y: tail.y + 10, anchor: 'end' },
        { x: tail.x + 6, y: tail.y + 26, anchor: 'start' },
        { x: tail.x - 6, y: tail.y + 26, anchor: 'end' },
        { x: tail.x, y: tail.y - 22 },
        { x: tail.x + 6, y: tail.y - 6, anchor: 'start' },
        { x: tail.x - 6, y: tail.y - 6, anchor: 'end' },
      ];
    } else if (p.dir === 'up') {
      candidates = [
        { x: tail.x, y: tail.y + 15 },
        { x: tail.x + 6, y: tail.y - 2, anchor: 'start' },
        { x: tail.x - 6, y: tail.y - 2, anchor: 'end' },
        { x: tail.x + 6, y: tail.y - 18, anchor: 'start' },
        { x: tail.x - 6, y: tail.y - 18, anchor: 'end' },
        { x: tail.x, y: tail.y + 31 },
        { x: tail.x + 6, y: tail.y + 15, anchor: 'start' },
        { x: tail.x - 6, y: tail.y + 15, anchor: 'end' },
      ];
    } else {
      const midX = (tail.x + tip.x) / 2;
      const left = Math.min(tail.x, tip.x);
      const right = Math.max(tail.x, tip.x);
      const outward = tail.x < tip.x ? { x: tail.x - 6, y: tail.y + 4, anchor: 'end' } : { x: tail.x + 6, y: tail.y + 4, anchor: 'start' };
      // Mitte über bzw. unter dem Pfeil, sonst bündig an einem Pfeilende – so weicht die Zahl einem
      // senkrechten Pfeil am selben Punkt aus (z. B. F und H am Trägerende).
      candidates = [
        { x: midX, y: tail.y - 8 },
        { x: left + 4, y: tail.y - 8, anchor: 'start' },
        { x: right - 4, y: tail.y - 8, anchor: 'end' },
        { x: midX, y: tail.y + 18 },
        { x: left + 4, y: tail.y + 18, anchor: 'start' },
        { x: right - 4, y: tail.y + 18, anchor: 'end' },
        outward,
        { x: midX, y: tail.y - 24 },
        { x: left + 4, y: tail.y - 24, anchor: 'start' },
        { x: right - 4, y: tail.y - 24, anchor: 'end' },
        { x: midX, y: tail.y + 34 },
      ];
    }
    labels.push(placer.place(content, candidates, { size: 12, color: COLORS.load, weight: 500, ref: `L:${p.source}` }));
  }

  // Höhenmass rechts hinter allen Pfeilen, Lasten und Beschriftungen (deshalb zuletzt)
  const dimZs = [];
  const zOwners = [];
  const addZ = (z, owner) => {
    if (!isNum(z)) return;
    if (!dimZs.some((v) => Math.abs(v - z) < 1e-7)) dimZs.push(z);
    if (owner) zOwners.push({ value: z, owner });
  };
  if (focused) {
    // Lager: Lagerpunkt und Achse (Stützen- bzw. Hängerlänge); Last: Angriffspunkt und Achse (Hebel);
    // Achspunkt: seine Höhe und die der Nachbarpunkte (Stufe, Neigung).
    // Änderbar sind nur Höhen neben der Achse (Lager an Stütze/Hänger, Last an Stiel) und Achspunkte.
    const offAxis = (item) => Math.abs(item.z - item.axisZ) > 1e-9;
    resolved.supports.forEach((s, i) => { if (focus.has(`S:${i}`)) { addZ(s.z, offAxis(s) ? `S:${i}` : ''); addZ(s.axisZ); } });
    resolved.points.forEach((p, i) => { if (isFocused('L', p, i)) { addZ(p.z, offAxis(p) ? `L:${p.source ?? i}` : ''); addZ(p.axisZ); } });
    resolved.axis.forEach((p, i) => {
      if (!isFocused('P', p, i)) return;
      addZ(p.z, `P:${p.source ?? i}`);
      if (!direct.has(`P:${p.source ?? i}`)) return;
      if (resolved.axis[i - 1]) addZ(resolved.axis[i - 1].z);
      if (resolved.axis[i + 1]) addZ(resolved.axis[i + 1].z);
    });
  } else {
    for (const p of resolved.axis) addZ(p.z);
    for (const s of resolved.supports) addZ(s.z);
    for (const p of resolved.points) if (p.horizontal) addZ(p.z);
  }
  dimZs.sort((a, b) => b - a);
  if (dimZs.length >= 2) {
    const zTop = Y(dimZs[0]);
    const zBottom = Y(dimZs[dimZs.length - 1]);
    // Bei einer Auswahl direkt rechts neben das gewählte Element, wenn dort Platz ist, sonst ganz
    // aussen rechts. Die Masszahl steht links der Linie (gedreht), deshalb etwas Abstand zum Bauteil.
    let dx;
    if (focused) {
      const anchors = [];
      resolved.supports.forEach((s, i) => { if (focus.has(`S:${i}`) && isNum(s.x)) anchors.push(X(s.x) + (Math.abs(s.z - s.axisZ) > 1e-9 ? 0 : 20)); });
      resolved.points.forEach((p, i) => { if (isFocused('L', p, i)) anchors.push(X(p.x)); });
      resolved.axis.forEach((p, i) => { if (isFocused('P', p, i)) anchors.push(X(p.x)); });
      if (anchors.length) {
        const right = Math.max(...anchors);
        dx = [right + 26, right + 40, right + 58, right + 80]
          .find((c) => c < layout.width - 12 && placer.free(c - 17, zTop + 6, c + 7, zBottom - 6));
      }
    }
    if (dx === undefined) {
      const rightExtent = Math.max(X(layout.xmax) + 20, placer.extentRight(zTop - 12, zBottom + 12));
      dx = Math.min(layout.width - 20, rightExtent + 26);
    }
    // Rechte Kante dessen, was auf der Höhe z gezeichnet ist: dort beginnt die Masshilfslinie
    const rightmostAt = (zm) => {
      let x = null;
      const take = (v) => { if (Number.isFinite(v) && (x === null || v > x)) x = v; };
      const same = (v) => Math.abs(v - zm) < 1e-7;
      for (const p of resolved.axis) if (same(p.z)) take(X(p.x));
      for (const g of supportGeometry) {
        if (same(g.s.z)) take(g.x + 20);
        if (same(g.s.axisZ)) take(g.x);
      }
      for (const a of pointArrows) {
        if (same(a.p.z)) take(Math.max(a.tail.x, a.tip.x));
        if (same(a.p.axisZ)) take(a.tip.x);
      }
      return x;
    };
    shapes.push(dimLine(dx, zTop - DIM_OVER, dx, zBottom + DIM_OVER));
    placer.segment(dx, zTop, dx, zBottom, 1, 2);
    for (const z of dimZs) {
      const right = rightmostAt(z);
      const from = right === null ? dx - 12 : Math.min(right + DIM_GAP, dx - 6);
      shapes.push(extension(from, Y(z), dx + EXT_OVER, Y(z)));
      shapes.push(tick(dx, Y(z), true));
      // Masshilfslinie für die Platzierung der Masszahlen merken (nichts darf sie überdecken)
      placer.segment(from, Y(z), dx + EXT_OVER, Y(z), 1, 1);
    }
    const shortDims = [];
    for (let i = 1; i < dimZs.length; i++) {
      const ya = Y(dimZs[i - 1]);
      const yb = Y(dimZs[i]);
      const tx = dx - DIM_STYLE.textGap;
      const ty = (ya + yb) / 2;
      const editAttrs = (focused && !paper
        ? ` data-dim="z" data-a="${ownerAt(zOwners, dimZs[i - 1])}" data-b="${ownerAt(zOwners, dimZs[i])}" data-va="${dimZs[i - 1]}" data-vb="${dimZs[i]}"`
        : '') + dimClass;
      const content = dimText(dimZs[i - 1] - dimZs[i]);
      const size = focused ? DIM_STYLE.size + 0.5 : DIM_STYLE.size;
      const weight = focused ? 700 : undefined;
      if (yb - ya < 26) {
        shortDims.push({ ya, yb, ty, content, size, weight, editAttrs });
        continue;
      }
      // gedrehte Zahl belegt einen schmalen, hohen Streifen links der Masslinie; ist dort schon eine
      // Beschriftung, rechts der Linie; ist beides belegt, waagrecht mit Ausweichen (wie kurze Masse)
      const half = textWidth(content, size, weight) / 2 + 2;
      const sides = [tx, dx + DIM_STYLE.textGap + size].map((x) => ({ x, box: [x - size, ty - half, x + 2, ty + half] }));
      const side = sides.find((sd) => placer.free(...sd.box));
      if (!side) {
        shortDims.push({ ya, yb, ty, content, size, weight, editAttrs });
        continue;
      }
      const attrs = `${editAttrs} transform="rotate(-90 ${r(side.x)} ${r(ty)})"`;
      labels.push(textSvg(side.x, ty, content, { anchor: 'middle', size, color: dimColor, weight, attrs }));
      placer.box(...side.box, 1, 0, true);
    }
    // Zu kurz für die gedrehte Zahl zwischen den Masshilfslinien: wie im Bauplan waagrecht daneben,
    // zuerst rechts auf halber Höhe, sonst links oder über bzw. unter dem Mass.
    for (const s of shortDims) {
      labels.push(placer.place(s.content, [
        { x: dx + 10, y: s.ty + 4, anchor: 'start' },
        { x: dx - 7, y: s.ty + 4, anchor: 'end' },
        { x: dx + 10, y: s.ya - 5, anchor: 'start' },
        { x: dx + 10, y: s.yb + 13, anchor: 'start' },
        { x: dx - 7, y: s.ya - 5, anchor: 'end' },
        { x: dx - 7, y: s.yb + 13, anchor: 'end' },
      ], { size: s.size, color: dimColor, weight: s.weight, attrs: s.editAttrs }));
    }
  }

  // Hilfslinie beim Einrasten an einem Punkt (während des Ziehens)
  const guides = [];
  if (options.guide && isNum(options.guide.x)) {
    guides.push(`<line x1="${r(X(options.guide.x))}" y1="${r(viewTop)}" x2="${r(X(options.guide.x))}" y2="${r(height)}" stroke="${COLORS.pivot}" stroke-width="1" stroke-dasharray="5 4" shape-rendering="crispEdges"/>`);
  }
  if (options.guide && isNum(options.guide.z)) {
    guides.push(`<line x1="0" y1="${r(Y(options.guide.z))}" x2="${layout.width}" y2="${r(Y(options.guide.z))}" stroke="${COLORS.pivot}" stroke-width="1" stroke-dasharray="5 4" shape-rendering="crispEdges"/>`);
  }

  // Markierung (Hover/Auswahl): blauer Saum um die Form, per CSS-Klasse eingeschaltet
  const halo = (id, opacity) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="${r(viewTop)}" width="${layout.width}" height="${r(height - viewTop)}">`
    + '<feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="d"/><feGaussianBlur in="d" stdDeviation="1.3" result="b"/>'
    + `<feFlood flood-color="${COLORS.pivot}" flood-opacity="${opacity}"/><feComposite in2="b" operator="in" result="h"/>`
    + '<feMerge><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  const defs = `<defs>${halo('sc-hl-hover', 0.32)}${halo('sc-hl-sel', 0.6)}</defs>`;

  return {
    layout,
    top,
    height,
    viewTop,
    // für den Hebelarm (app.js): Höhe der Masskette und Unterkante des Gezeichneten an einer Stelle x [m]
    dimY,
    lowestAt,
    svg: `<svg class="figure" viewBox="0 ${r(viewTop)} ${layout.width} ${r(height - viewTop)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Systemskizze mit Lasten und Auflagerreaktionen" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${defs}${gridParts.join('')}${shapes.join('')}${guides.join('')}${labels.join('')}${handles.join('')}</svg>`,
  };
}
