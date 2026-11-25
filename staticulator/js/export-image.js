// Skizze (auf Wunsch mit V-, M- und w-Fläche) als Bild speichern: PNG für Word und Abgaben, SVG als Vektor.
// Die Zeichnungen werden geklont, ihre berechneten Stile direkt eingetragen (das Bild braucht kein CSS)
// und alles Interaktive entfernt (Griffe, Trefferflächen, Markierungen, Raster, Mauszeiger).

const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity',
  'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'paint-order',
  'display', 'visibility', 'shape-rendering', 'stop-color', 'stop-opacity'];
const REMOVE = '.hit-layer, .hl-layer, .lever-layer, .drag-ghost, .diagram-cursor, .grip, .vertex, .pivot-toggle, .grid, #sc-grid-dots';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function xml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineClone(live) {
  const copy = live.cloneNode(true);
  const from = [live, ...live.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((element, i) => {
    const style = getComputedStyle(element);
    // Verweise wie url("http://…#id") auf url(#id) kürzen, sonst findet das Bild die Muster nicht
    to[i].setAttribute('style', PROPS.map((p) => `${p}:${style.getPropertyValue(p)}`).join(';').replace(/url\("?[^#")]*#([^")]+)"?\)/g, 'url(#$1)'));
  });
  copy.querySelectorAll(REMOVE).forEach((element) => element.remove());
  const box = live.getBoundingClientRect();
  return { svg: copy, width: box.width, height: box.height };
}

function download(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// svgs: die Zeichnungen in der gewünschten Reihenfolge (sichtbar im Dokument), title: Überschrift im Bild
export async function exportImage(format, svgs, title, fileName) {
  const parts = svgs.filter(Boolean).map(inlineClone).filter((part) => part.width > 0 && part.height > 0);
  if (!parts.length) throw new Error('Keine Zeichnung zum Speichern.');
  const pad = 16;
  const gap = 14;
  const titleHeight = title ? 30 : 0;
  const width = Math.round(Math.max(...parts.map((part) => part.width)) + 2 * pad);
  let y = pad + titleHeight;
  const body = parts.map((part) => {
    part.svg.setAttribute('x', pad);
    part.svg.setAttribute('y', Math.round(y));
    part.svg.setAttribute('width', part.width);
    part.svg.setAttribute('height', part.height);
    y += part.height + gap;
    return new XMLSerializer().serializeToString(part.svg);
  }).join('');
  const height = Math.round(y - gap + pad);
  const header = title ? `<text x="${pad}" y="${pad + 17}" font-family="${FONT}" font-size="16" font-weight="700" fill="#1f2933">${xml(title)}</text>` : '';
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${header}${body}</svg>`;
  if (format === 'svg') {
    download(new Blob([doc], { type: 'image/svg+xml;charset=utf-8' }), `${fileName}.svg`);
    return;
  }
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Das Bild liess sich nicht erzeugen.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`;
  });
  const scale = 2; // doppelte Auflösung: scharf auch im Druck
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  download(blob, `${fileName}.png`);
}
