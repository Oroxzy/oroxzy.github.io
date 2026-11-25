// Querschnittsskizzen für die Bemessung: I-, U- und Hohlprofil, Holz-Rechteck und Rundholz,
// massstäblich aus den Profilmassen, mit Achsen y/z, Massen und optionaler Markierung
// (Schubfläche A_v oder Knickachse). Farben über CSS-Klassen (auch Dark Mode).
import { fixed } from './format.js';

const BOX = 132; // grösste Abmessung des Querschnitts in px
const W = 250;
const H = 228;
const CX = 128; // Mitte des Querschnitts
const CY = 116;

const r1 = (v) => Math.round(v * 10) / 10;
const mmText = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : fixed(v, 1));

function dimV(x, y1, y2, label) {
  const tick = (y) => `<line class="sec-dim" x1="${r1(x - 4)}" y1="${r1(y + 4)}" x2="${r1(x + 4)}" y2="${r1(y - 4)}"/>`;
  return `<line class="sec-dim" x1="${r1(x)}" y1="${r1(y1 - 5)}" x2="${r1(x)}" y2="${r1(y2 + 5)}"/>${tick(y1)}${tick(y2)}`
    + `<text class="sec-text" x="${r1(x - 6)}" y="${r1((y1 + y2) / 2)}" text-anchor="middle" transform="rotate(-90 ${r1(x - 6)} ${r1((y1 + y2) / 2)})">${label}</text>`;
}

function dimH(y, x1, x2, label) {
  const tick = (x) => `<line class="sec-dim" x1="${r1(x - 4)}" y1="${r1(y + 4)}" x2="${r1(x + 4)}" y2="${r1(y - 4)}"/>`;
  return `<line class="sec-dim" x1="${r1(x1 - 5)}" y1="${r1(y)}" x2="${r1(x2 + 5)}" y2="${r1(y)}"/>${tick(x1)}${tick(x2)}`
    + `<text class="sec-text" x="${r1((x1 + x2) / 2)}" y="${r1(y - 6)}" text-anchor="middle">${label}</text>`;
}

// Achsen durch den Schwerpunkt (sx, sy); die massgebende Knickachse rot und kräftig
function axes(sx, sy, halfW, halfH, buckling) {
  const yCls = buckling === 'y' ? 'sec-axis sec-buckle' : 'sec-axis';
  const zCls = buckling === 'z' ? 'sec-axis sec-buckle' : 'sec-axis';
  let s = `<line class="${yCls}" x1="${r1(sx - halfW - 16)}" y1="${r1(sy)}" x2="${r1(sx + halfW + 16)}" y2="${r1(sy)}"/>`
    + `<text class="sec-axis-label${buckling === 'y' ? ' sec-buckle-text' : ''}" x="${r1(sx + halfW + 20)}" y="${r1(sy + 4)}">y</text>`
    + `<line class="${zCls}" x1="${r1(sx)}" y1="${r1(sy - halfH - 14)}" x2="${r1(sx)}" y2="${r1(sy + halfH + 14)}"/>`
    + `<text class="sec-axis-label${buckling === 'z' ? ' sec-buckle-text' : ''}" x="${r1(sx + 4)}" y="${r1(sy + halfH + 24)}">z</text>`;
  // Knicken um z: Ausweichen in y-Richtung (und umgekehrt) – kleine Pfeile wie in der Systemskizze
  if (buckling === 'z') s += arrow(sx + halfW + 5, sy - 22, sx + halfW + 17, sy - 22) + arrow(sx - halfW - 5, sy - 22, sx - halfW - 17, sy - 22);
  // Knicken um y: Ausweichen in z-Richtung – Pfeile links neben dem Querschnitt (frei von Breitenmass und t_f)
  if (buckling === 'y') s += arrow(CX - halfW - 7, sy - halfH + 5, CX - halfW - 7, sy - halfH - 8) + arrow(CX - halfW - 7, sy + halfH - 5, CX - halfW - 7, sy + halfH + 8);
  return s;
}

// Kleiner Pfeil: Schaft bis zum Fuss der gefüllten, schlanken Spitze
function arrow(x1, y1, x2, y2, head = 6) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const half = head * 0.36;
  const bx = x2 - head * Math.cos(angle);
  const by = y2 - head * Math.sin(angle);
  const px = -Math.sin(angle) * half;
  const py = Math.cos(angle) * half;
  return `<line class="sec-buckle-arrow" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(bx + 0.4 * Math.cos(angle))}" y2="${r1(by + 0.4 * Math.sin(angle))}"/>`
    + `<path class="sec-buckle-head" d="M${r1(x2)},${r1(y2)} L${r1(bx + px)},${r1(by + py)} L${r1(bx - px)},${r1(by - py)} Z"/>`;
}

// Profil aus der Profiltabelle: I/H, U, Hohlprofil. options.highlight: 'shear' | null, options.buckling: 'y' | 'z' | null
export function steelSectionSvg(p, options = {}) {
  const h = p.h;
  const b = p.b;
  const s = BOX / Math.max(h, b);
  const hh = (h * s) / 2;
  const hb = (b * s) / 2;
  const top = CY - hh;
  const bottom = CY + hh;
  const left = CX - hb;
  const right = CX + hb;
  let shape = '';
  let highlight = '';
  let extra = '';
  let sx = CX;
  if (['IPE', 'HEA', 'HEB', 'HEM'].includes(p.f)) {
    const tw = Math.max(1.2, p.tw * s) / 2;
    const tf = Math.max(1.2, p.tf * s);
    const r = Math.min((p.r || 0) * s, hb - tw - 0.5);
    const d = `M${r1(left)},${r1(top)} H${r1(right)} V${r1(top + tf)} H${r1(CX + tw + r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(CX + tw)},${r1(top + tf + r)}`
      + ` V${r1(bottom - tf - r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(CX + tw + r)},${r1(bottom - tf)} H${r1(right)} V${r1(bottom)} H${r1(left)} V${r1(bottom - tf)}`
      + ` H${r1(CX - tw - r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(CX - tw)},${r1(bottom - tf - r)} V${r1(top + tf + r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(CX - tw - r)},${r1(top + tf)} H${r1(left)} Z`;
    shape = `<path class="sec-steel" d="${d}"/>`;
    if (options.highlight === 'shear') {
      highlight = `<rect class="sec-hl" x="${r1(CX - tw - r * 0.6)}" y="${r1(top + tf * 0.5)}" width="${r1(2 * tw + r * 1.2)}" height="${r1(bottom - top - tf)}"/>`
        + `<text class="sec-hl-text" x="${r1(CX + tw + 6)}" y="${r1(CY + 4)}">A<tspan dy="3" font-size="9">v</tspan></text>`;
    }
    extra = `<text class="sec-text sec-small" x="${r1(right + 4)}" y="${r1(top + tf / 2 + 4)}">t<tspan dy="3" font-size="8">f</tspan><tspan dy="-3"> = ${mmText(p.tf)}</tspan></text>`
      + (options.highlight === 'shear' ? '' : `<text class="sec-text sec-small" x="${r1(CX + tw + 5)}" y="${r1(CY + 16)}">t<tspan dy="3" font-size="8">w</tspan><tspan dy="-3"> = ${mmText(p.tw)}</tspan></text>`);
  } else if (p.f === 'UPE' || p.f === 'UPN') {
    const tw = Math.max(1.2, p.tw * s);
    const tf = Math.max(1.2, p.tf * s);
    const r = Math.min((p.r || 0) * s, 2 * hb - tw - 0.5);
    const d = `M${r1(left)},${r1(top)} H${r1(right)} V${r1(top + tf)} H${r1(left + tw + r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(left + tw)},${r1(top + tf + r)}`
      + ` V${r1(bottom - tf - r)} A${r1(r)},${r1(r)} 0 0 0 ${r1(left + tw + r)},${r1(bottom - tf)} H${r1(right)} V${r1(bottom)} H${r1(left)} Z`;
    shape = `<path class="sec-steel" d="${d}"/>`;
    // Schwerpunkt näherungsweise aus Flanschen und Steg
    const aF = 2 * p.b * p.tf;
    const aW = (p.h - 2 * p.tf) * p.tw;
    const e = (aF * (p.b / 2) + aW * (p.tw / 2)) / (aF + aW);
    sx = left + e * s;
    if (options.highlight === 'shear') {
      highlight = `<rect class="sec-hl" x="${r1(left)}" y="${r1(top + tf * 0.5)}" width="${r1(tw + r * 0.6)}" height="${r1(bottom - top - tf)}"/>`
        + `<text class="sec-hl-text" x="${r1(left + tw + 6)}" y="${r1(CY + 16)}">A<tspan dy="3" font-size="9">v</tspan></text>`;
    }
  } else {
    // Hohlprofil (RRW warmgefertigt: kleine Ecken, RRK kaltgefertigt: grössere Ecken)
    const t = Math.max(1.2, (p.t || 4) * s);
    const ro = Math.min(hb, hh, (p.f === 'RRK' ? 2.2 : 1.5) * t);
    const ri = Math.max(0, ro - t);
    const outer = `M${r1(left + ro)},${r1(top)} H${r1(right - ro)} A${r1(ro)},${r1(ro)} 0 0 1 ${r1(right)},${r1(top + ro)} V${r1(bottom - ro)} A${r1(ro)},${r1(ro)} 0 0 1 ${r1(right - ro)},${r1(bottom)} H${r1(left + ro)} A${r1(ro)},${r1(ro)} 0 0 1 ${r1(left)},${r1(bottom - ro)} V${r1(top + ro)} A${r1(ro)},${r1(ro)} 0 0 1 ${r1(left + ro)},${r1(top)} Z`;
    const l2 = left + t;
    const r2 = right - t;
    const t2 = top + t;
    const b2 = bottom - t;
    const inner = `M${r1(l2 + ri)},${r1(t2)} H${r1(r2 - ri)} A${r1(ri)},${r1(ri)} 0 0 1 ${r1(r2)},${r1(t2 + ri)} V${r1(b2 - ri)} A${r1(ri)},${r1(ri)} 0 0 1 ${r1(r2 - ri)},${r1(b2)} H${r1(l2 + ri)} A${r1(ri)},${r1(ri)} 0 0 1 ${r1(l2)},${r1(b2 - ri)} V${r1(t2 + ri)} A${r1(ri)},${r1(ri)} 0 0 1 ${r1(l2 + ri)},${r1(t2)} Z`;
    shape = `<path class="sec-steel" fill-rule="evenodd" d="${outer} ${inner}"/>`;
    if (options.highlight === 'shear') {
      highlight = `<rect class="sec-hl" x="${r1(left)}" y="${r1(top)}" width="${r1(t)}" height="${r1(bottom - top)}"/><rect class="sec-hl" x="${r1(right - t)}" y="${r1(top)}" width="${r1(t)}" height="${r1(bottom - top)}"/>`
        + `<text class="sec-hl-text" x="${r1(CX - 8)}" y="${r1(CY + 4)}">A<tspan dy="3" font-size="9">v</tspan></text>`;
    }
    extra = `<text class="sec-text sec-small" x="${r1(right + 4)}" y="${r1(top + 10)}">t = ${mmText(p.t || 0)}</text>`;
  }
  const body = shape + highlight + axes(sx, CY, hb, hh, options.buckling) + dimV(left - 18, top, bottom, `h = ${mmText(h)}`) + dimH(top - 14, left, right, `b = ${mmText(b)}`) + extra;
  return wrap(body, options.title || p.n);
}

// Holz: Rechteck b × h oder Rundholz Ø d (mm), mit Jahrringen angedeutet
export function timberSectionSvg(spec, options = {}) {
  let body = '';
  if (spec.shape === 'round') {
    const R = BOX / 2;
    body += `<circle class="sec-wood" cx="${CX}" cy="${CY}" r="${R}"/>`;
    for (const f of [0.25, 0.5, 0.75]) body += `<circle class="sec-ring" cx="${r1(CX + 3)}" cy="${r1(CY + 2)}" r="${r1(R * f)}"/>`;
    body += axes(CX, CY, R, R, options.buckling);
    body += dimH(CY - R - 14, CX - R, CX + R, `Ø ${mmText(spec.d)}`);
  } else {
    const s = BOX / Math.max(spec.b, spec.h);
    const hb = (spec.b * s) / 2;
    const hh = (spec.h * s) / 2;
    body += `<rect class="sec-wood" x="${r1(CX - hb)}" y="${r1(CY - hh)}" width="${r1(2 * hb)}" height="${r1(2 * hh)}"/>`;
    // Jahrringe: Kreisbögen um einen Kern ausserhalb der Mitte, auf den Querschnitt beschnitten
    const clip = `sec-clip-${Math.round(spec.b)}-${Math.round(spec.h)}`;
    body += `<clipPath id="${clip}"><rect x="${r1(CX - hb)}" y="${r1(CY - hh)}" width="${r1(2 * hb)}" height="${r1(2 * hh)}"/></clipPath><g clip-path="url(#${clip})">`;
    for (const f of [0.35, 0.7, 1.05, 1.4]) body += `<circle class="sec-ring" cx="${r1(CX - hb * 0.4)}" cy="${r1(CY + hh * 1.1)}" r="${r1(Math.max(hb, hh) * f)}"/>`;
    body += '</g>';
    body += axes(CX, CY, hb, hh, options.buckling);
    body += dimV(CX - hb - 18, CY - hh, CY + hh, `h = ${mmText(spec.h)}`) + dimH(CY - hh - 14, CX - hb, CX + hb, `b = ${mmText(spec.b)}`);
  }
  return wrap(body, options.title || '');
}

function wrap(body, title) {
  return `<svg class="sec-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Querschnitt ${title}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${body}</svg>`;
}
