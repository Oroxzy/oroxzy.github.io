// Einheitliche Vermassung für alle Zeichnungen der App (Bauplan-Stil nach SIA 400 / DIN 1356):
// Masslinie mit kräftigen 45°-Schrägstrichen, hellere Masshilfslinien mit Abstand zum Bauteil und
// Überstand, Masszahl über der Linie. Gilt für Systemskizze, Mass am Mauszeiger, Hebelarm und Querschnitte.
// Farben stehen als Attribut am Element (für Export und Druck); die Klassen dim-* passen sie im Dark Mode an.

export const DIM_STYLE = {
  line: '#64748b', // Masslinie
  ext: '#94a3b8', // Masshilfslinien
  term: '#475569', // Schrägstriche
  text: '#334155', // Masszahlen
  slash: 4.5, // halbe Ausdehnung des Schrägstrichs in x und y (px)
  slashWidth: 1.7,
  lineOver: 7, // Überstand der Masslinie über die äusseren Hilfslinien
  extOver: 7, // Überstand der Hilfslinien über die Masslinie
  gap: 6, // Abstand der Hilfslinie vom Bauteil
  size: 12, // Masszahl
  textGap: 5, // Grundlinie der Masszahl über der Masslinie
  chainGap: 26, // Abstand Masskette – Gesamtmass
};

const r1 = (v) => Math.round(v * 10) / 10;
const crisp = (x1, y1, x2, y2) => (Math.abs(x1 - x2) < 1e-9 || Math.abs(y1 - y2) < 1e-9 ? ' shape-rendering="crispEdges"' : '');

// Schrägstrich an (x, y): auf einer waagrechten Masslinie „/“, auf einer senkrechten „\“ (45° zur Leserichtung).
// k vergrössert ihn (z. B. beim farbigen Hebelarm), color ersetzt die graue Farbe.
export function dimSlash(x, y, vertical = false, { k = 1, color = null } = {}) {
  const s = DIM_STYLE.slash * k;
  const [x1, y1, x2, y2] = vertical ? [x - s, y - s, x + s, y + s] : [x - s, y + s, x + s, y - s];
  return `<line class="${color ? 'dim-tick-color' : 'dim-tick'}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color || DIM_STYLE.term}" stroke-width="${r1(DIM_STYLE.slashWidth * k)}"/>`;
}

export function dimLine(x1, y1, x2, y2, { width = 1, color = null } = {}) {
  return `<line class="${color ? 'dim-line-color' : 'dim-line'}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${color || DIM_STYLE.line}" stroke-width="${width}"${crisp(x1, y1, x2, y2)}/>`;
}

export function extLine(x1, y1, x2, y2) {
  return `<line class="dim-ext" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${DIM_STYLE.ext}" stroke-width="1"${crisp(x1, y1, x2, y2)}/>`;
}
