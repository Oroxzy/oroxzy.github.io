// Lösungsweg im Stil der Musterlösungen (ΣH = 0, ΣM = 0 (DP), ΣV = 0, Kontrolle).
import { fixed, measure, escapeHtml, texName, htmlName, length } from './format.js';

export function tex(source, display = false) {
  if (typeof window !== 'undefined' && window.katex) {
    return window.katex.renderToString(source, {
      throwOnError: false,
      displayMode: display,
      strict: 'ignore',
      // \htmlData markiert Glieder für den Hover (Last und Hebelarm in der Skizze)
      trust: (context) => context.command === '\\htmlData',
    });
  }
  return `<code>${escapeHtml(source)}</code>`;
}

const unit = (u) => `\\,\\text{${u}}`;
const CW_COLOR = '#1d4ed8';
const CCW_COLOR = '#c2410c';
const ROTATE_CW = `{\\color{${CW_COLOR}}\\curvearrowright}`;
const ROTATE_CCW = `{\\color{${CCW_COLOR}}\\curvearrowleft}`;
const arrowTex = { up: '\\uparrow', down: '\\downarrow', right: '\\rightarrow', left: '\\leftarrow' };

// Zahl für TeX mit echtem Minus.
function n(value, decimals) {
  return fixed(value, decimals);
}

// Glieder mit Vorzeichen zu einer Summe verbinden: [+a, -b] → "a - b".
function joinSigned(items) {
  let out = '';
  items.forEach((item, index) => {
    const negative = item.sign < 0;
    if (index === 0) out += negative ? `-${item.body}` : item.body;
    else out += negative ? ` - ${item.body}` : ` + ${item.body}`;
  });
  return out || '0';
}

function resultLine(name, value, decimals, positiveDir, negativeDir, unitText = 'kN') {
  const dir = value >= 0 ? positiveDir : negativeDir;
  const magnitude = Math.abs(value);
  const zero = Math.abs(value) < 0.5 * Math.pow(10, -decimals);
  if (zero) return `\\underline{\\underline{${texName(name)} = 0${unit(unitText)}}}`;
  if (value >= 0) return `\\underline{\\underline{${texName(name)} = ${n(magnitude, decimals)}${unit(unitText)}\\ ${arrowTex[dir]}}}`;
  return `${texName(name)} = ${n(value, decimals)}${unit(unitText)}\\ \\Rightarrow\\ \\underline{\\underline{${n(magnitude, decimals)}${unit(unitText)}\\ ${arrowTex[dir]}}}`;
}

export function step(number, title, hint, bodyHtml) {
  return `<section class="sol-step"><h3><span class="sol-num">${number}</span>${title}${hint ? `<span class="sol-hint">${hint}</span>` : ''}</h3>${bodyHtml}</section>`;
}

// Resultierende einer Streckenlast als Produkt: Rechteck (q · l), Dreieck einer Trapezlast (½ · Δq · l)
function qProduct(term, decimals) {
  return term.half
    ? `\\tfrac{1}{2} \\cdot ${n(term.q, decimals)} \\cdot ${n(term.length, decimals)}`
    : `${n(term.q, decimals)} \\cdot ${n(term.length, decimals)}`;
}

// Teil einer Trapezlast als Text: „q1 (Rechteck)“ bzw. „q1 (Dreieck)“
function qLabel(term) {
  return term.part ? `${htmlName(term.label)} (${term.part === 'tri' ? 'Dreieck' : 'Rechteck'})` : htmlName(term.label);
}

function forceBody(term, decimals) {
  if (term.kind === 'q') return `(${qProduct(term, decimals)})`;
  return n(term.force, decimals);
}

// Glied für den Hover markieren: data-term="…" (siehe app.js)
const mark = (key, body) => `\\htmlData{term=${key}}{${body}}`;

// ---------- Erklärmodus: „Warum?“-Boxen mit den Werten der Aufgabe ----------

export function why(summary, paragraphs) {
  return `<details class="why"><summary><span class="why-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z"/><rect x="9" y="19.2" width="6" height="1.6" rx="0.8"/><rect x="10" y="21.6" width="4" height="1.4" rx="0.7"/></svg></span><span>${summary}</span></summary>`
    + `${paragraphs.filter(Boolean).map((p) => `<p>${p}</p>`).join('')}</details>`;
}

function explainH(result, decimals) {
  const h = result.steps.h;
  const fixedSupports = result.reactions.filter((r) => r.type === 'fest');
  const rollers = result.reactions.filter((r) => r.type !== 'fest');
  const sumH = h.terms.reduce((sum, t) => sum + t.value, 0);
  const paragraphs = [];
  if (h.unknown) {
    const roller = rollers[0];
    paragraphs.push(roller
      ? `Waagrecht kann nur das Gelenklager <b>${escapeHtml(h.supportName)}</b> eine Kraft aufnehmen (${htmlName(h.unknown)}). Das Rollenlager <b>${escapeHtml(roller.name)}</b> rollt waagrecht weg und überträgt nur senkrechte Kräfte.`
      : `Hier sind beide Lager Gelenklager: Waagrecht könnten beide eine Kraft aufnehmen, das ist mit den drei Gleichgewichtsbedingungen nicht eindeutig. Vereinfachend wird die ganze Horizontalkraft dem Lager <b>${escapeHtml(h.supportName)}</b> zugewiesen (${htmlName(h.unknown)}).`);
    paragraphs.push(`Darum steht in ΣH = 0 nur <b>eine</b> Unbekannte – diese Gleichung löst man zuerst. `
      + (h.terms.length
        ? `Die Horizontallasten ergeben zusammen ${fixed(sumH, decimals)} kN (nach rechts positiv), also muss ${htmlName(h.unknown)} = ${fixed(Math.abs(h.result), decimals)} kN ${h.result >= 0 ? 'nach rechts' : 'nach links'} wirken.`
        : 'Ohne Horizontallasten ist sie sofort 0.'));
  } else if (h.terms.length) {
    paragraphs.push(`Kein Lager nimmt waagrechte Kräfte auf (${rollers.length} Rollenlager). Das geht nur, weil sich die Horizontallasten gegenseitig aufheben.`);
  } else {
    paragraphs.push(`Es wirken keine waagrechten Lasten${fixedSupports.length ? `, das Gelenklager ${escapeHtml(fixedSupports[0].name)} muss also waagrecht nichts aufnehmen` : ''}.`);
  }
  paragraphs.push('<i>Warum nicht mit ΣV anfangen?</i> In ΣV stehen beide senkrechten Reaktionen – zwei Unbekannte in einer Gleichung lassen sich nicht lösen.');
  return why('Warum zuerst ΣH?', paragraphs);
}

function explainM(result, decimals) {
  const m = result.steps.m;
  const other = m.unknown.split('_')[0];
  const qTerms = m.terms.filter((t) => t.kind === 'q');
  return why(`Warum um Lager ${escapeHtml(m.pivot)}?`, [
    `Um den Drehpunkt <b>${escapeHtml(m.pivot)}</b> dreht die Reaktion in ${escapeHtml(m.pivot)} nicht – ihr Hebelarm ist 0. So bleibt in ΣM = 0 nur <b>${htmlName(m.unknown)}</b> als Unbekannte.`,
    `Hebelarm = senkrechter Abstand der Wirkungslinie zum Drehpunkt: bei senkrechten Kräften der waagrechte Abstand, bei waagrechten Kräften der Höhenunterschied. ${htmlName(m.unknown)} hat hier den Hebelarm ${length(m.unknownLever, decimals)} m.`,
    qTerms.length
      ? `Eine Streckenlast ersetzt man durch ihre Resultierende R = q · l in ihrer Mitte${qTerms.some((t) => t.part) ? '; eine Trapezlast teilt man in ein Rechteck (kleinerer Wert, R in der Mitte) und ein Dreieck (Differenz Δq, R = ½ · Δq · l im Drittelspunkt auf der Seite des grösseren Werts)' : ''}: ${qTerms.map((t) => `${qLabel(t)}: ${t.half ? '½ · ' : ''}${fixed(t.q, decimals)} kN/m · ${length(t.length, decimals)} m = ${fixed(t.force, decimals)} kN bei x = ${measure(t.x)} m`).join('; ')}.`
      : '',
    'Vorzeichen: im Uhrzeigersinn <span class="cw">↷</span> positiv, dagegen <span class="ccw">↶</span> negativ. <b>Fahre mit der Maus über ein Glied</b> (auf dem Handy: antippen) – die Skizze zeigt dann die Kraft und ihren Hebelarm.',
    `<i>Warum nicht um ${escapeHtml(other)}?</i> Geht genauso – dann rechnet man zuerst ${escapeHtml(m.pivot)}<sub>z</sub> aus. Man wählt einen Punkt, durch den möglichst viele unbekannte Kräfte gehen. `
      + '<i>Typische Fehler:</i> Streckenlast am Rand statt in ihrer Mitte angesetzt, Hebelarm vom falschen Punkt aus gemessen.',
  ]);
}

function explainV(result, decimals) {
  const v = result.steps.v;
  return why('Warum jetzt ΣV?', [
    `Nach ΣM ist ${htmlName(v.knownName)} = ${fixed(v.known, decimals)} kN bekannt. In ΣV = 0 fehlt jetzt nur noch <b>${htmlName(v.unknown)}</b>.`,
    `Nach oben positiv, Lasten nach unten also negativ. Die senkrechten Lasten ergeben zusammen ${fixed(Math.abs(v.downward), decimals)} kN ${v.downward >= 0 ? 'nach unten' : 'nach oben'}.`,
    'Kommt eine Reaktion negativ heraus, zeigt sie nach unten: Das Lager hält den Träger fest, zum Beispiel bei einem langen Kragarm.',
  ]);
}

function explainCheck(result, decimals) {
  const c = result.steps.check;
  const ok = Math.abs(c.residual) < 1e-6;
  return why('Wozu die Kontrolle?', [
    `Zur Kontrolle bildet man ΣM um den <b>anderen</b> Punkt ${escapeHtml(c.pivot)} – jetzt mit allen Lasten und beiden Reaktionen. Diese Gleichung wurde zum Rechnen nicht benutzt, sie prüft also wirklich.`,
    ok
      ? `Hier kommt ${fixed(c.residual, Math.max(decimals, 2))} kNm heraus: Die Reaktionen stimmen.`
      : 'Hier kommt nicht 0 heraus – dann steckt ein Fehler in einem Vorzeichen oder Hebelarm.',
  ]);
}

function explainForces(forces, zeros, decimals, supportsX = []) {
  // Kragarm: Träger ragt über ein Lager hinaus; Einzelmomente (Stiel, Horizontalkraft mit Hebelarm) lassen M springen
  const cantilever = supportsX.length > 0 && (forces.xmin < Math.min(...supportsX) - 1e-9 || forces.xmax > Math.max(...supportsX) + 1e-9);
  const couples = forces.couples && forces.couples.length > 0;
  return why('Wie liest man V und M?', [
    'V springt bei Einzellasten und Lagerkräften um deren Betrag. Unter einer Streckenlast steigt oder fällt V gleichmässig (Steigung = −q).',
    zeros.length
      ? `Wo V das Vorzeichen wechselt – hier bei x = ${zeros.map((z) => measure(z.x)).join(' m und ')} m –, hat M ein Extremum, denn die Steigung von M ist V (dM/dx = V).`
      : 'V wechselt innerhalb eines Feldes nicht das Vorzeichen; das grösste Moment liegt dann an einer Last oder einem Lager.',
    `M<sub>max</sub> = ${fixed(forces.mMax.m, decimals)} kNm bei x = ${measure(forces.mMax.x)} m`
      + (Math.abs(forces.mMin.m) > 1e-9 ? `, M<sub>min</sub> = ${fixed(forces.mMin.m, decimals)} kNm bei x = ${measure(forces.mMin.x)} m${cantilever ? ' (beim Kragarm meist das Stützmoment über dem Lager)' : ''}.` : '.'),
    couples
      ? 'An einem freien Trägerende ist M = 0. Wo ein Einzelmoment angreift (Stiel, Horizontalkraft mit Hebelarm), springt M um diesen Betrag – auch am Trägerende.'
      : 'An einem freien Trägerende und an einem Lager am Trägerende ist M = 0: Dort kann kein Moment aufgenommen werden.',
  ]);
}

export function renderSolution(result, forces, decimals = 2, options = {}) {
  const explain = !!options.explain;
  if (!result) return '';
  const blocks = [];

  if (!result.ok) {
    return `<div class="sol-error">${escapeHtml(result.error)}</div>`;
  }

  const { steps } = result;
  const reactionsByName = Object.fromEntries(result.reactions.map((r) => [r.name, r]));

  // 1) ΣH = 0
  {
    const h = steps.h;
    let body = '';
    if (!h.unknown && h.terms.length) {
      // kein Lager nimmt H auf, die Horizontalkräfte heben sich aber auf
      const terms = h.terms.map((t) => ({ sign: Math.sign(t.value) || 1, body: n(Math.abs(t.value), decimals) }));
      body = `<div class="sol-eq">${tex(`\\sum H = ${joinSigned(terms)} = 0\\ \\checkmark`)}</div><p class="sol-note">Die Horizontalkräfte heben sich gegenseitig auf.</p>`;
    } else if (!h.unknown) {
      body = `<div class="sol-eq">${tex('\\sum H = 0:\\quad \\text{keine Horizontalkräfte}')}</div>`;
    } else {
      const terms = [{ sign: 1, body: mark('hu', texName(h.unknown)) }, ...h.terms.map((t, i) => ({ sign: Math.sign(t.value) || 1, body: mark(`h:${i}`, n(Math.abs(t.value), decimals)) }))];
      body += `<div class="sol-eq">${tex(`\\sum H = 0:\\quad ${joinSigned(terms)} = 0`)}</div>`;
      if (!h.terms.length) body += '<p class="sol-note">Keine Horizontalkräfte vorhanden.</p>';
      body += `<div class="sol-res">${tex(resultLine(h.unknown, h.result, decimals, 'right', 'left'))}</div>`;
    }
    if (explain) body += explainH(result, decimals);
    blocks.push(step(1, 'Σ H = 0', 'Kräfte nach rechts positiv', body));
  }

  // 2) ΣM = 0 um den Drehpunkt
  {
    const m = steps.m;
    const zeroLever = m.terms.filter((t) => t.lever < 1e-9);
    const active = m.terms.filter((t) => t.lever >= 1e-9 && Math.abs(t.moment) > 1e-12);
    // Jedes Glied mit gut sichtbarem Drehpfeil davor und in der Farbe seines Drehsinns:
    // blau ↷ im Uhrzeigersinn, orange ↶ dagegen.
    const turn = (sign, body) => `{\\color{${sign > 0 ? CW_COLOR : CCW_COLOR}}${sign > 0 ? '\\curvearrowright' : '\\curvearrowleft'}\\, ${body}}`;
    const unknownItem = { sign: m.unknownSense, body: mark('mu', turn(m.unknownSense, `${texName(m.unknown)} \\cdot ${length(m.unknownLever, decimals)}`)) };
    const items = [unknownItem, ...m.terms
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => active.includes(t))
      .map(({ t, i }) => ({ sign: Math.sign(t.moment), body: mark(`m:${i}`, turn(Math.sign(t.moment), `${forceBody(t, decimals)} \\cdot ${length(t.lever, decimals)}`)) }))];
    // Drehpunkt direkt hier umschalten; die Rechnung folgt sofort.
    const pivotButtons = (result.reactions || [])
      .map((r) => `<button type="button" data-pivot="${escapeHtml(r.name)}" class="${r.name === m.pivot ? 'on' : ''}" aria-pressed="${r.name === m.pivot}">Lager ${escapeHtml(r.name)}</button>`)
      .join('');
    let body = `<div class="pivot-switch" role="group" aria-label="Drehpunkt wählen">Drehpunkt:${pivotButtons}</div>`;
    body += `<div class="sol-eq">${tex(`\\sum M_{(${m.pivot})} = 0:\\quad ${joinSigned(items)} = 0`)}</div>`;
    if (Math.abs(m.known) > 1e-9) {
      const knownTurn = m.known > 0 ? ROTATE_CW : ROTATE_CCW;
      const knownText = m.known > 0 ? 'im Uhrzeigersinn' : 'gegen den Uhrzeigersinn';
      body += `<p class="sol-note">Resultierendes Moment der bekannten Kräfte um ${escapeHtml(m.pivot)}: ${tex(`${n(Math.abs(m.known), decimals)}${unit('kNm')}\\ ${knownTurn}`)} (${knownText}). ${htmlName(m.unknown)} muss es mit Gegendrehung ausgleichen.</p>`;
    }
    const rhs = -m.known * m.unknownSense;
    body += `<div class="sol-eq">${tex(`${texName(m.unknown)} \\cdot ${length(m.unknownLever, decimals)} = ${n(rhs, decimals)}${unit('kNm')}`)}</div>`;
    body += `<div class="sol-res">${tex(resultLine(m.unknown, m.result, decimals, 'up', 'down'))}</div>`;

    // Gliedertabelle
    const rows = m.terms.map((t, i) => {
      const dirArrow = { up: '↑', down: '↓', right: '→', left: '←' }[t.dir] || '';
      const what = t.kind === 'q' ? `${qLabel(t)} = ${t.half ? '½ · ' : ''}${fixed(t.q, decimals)} kN/m · ${length(t.length, decimals)} m` : htmlName(t.label);
      const sense = t.lever < 1e-9 || Math.abs(t.moment) < 1e-12 ? '–' : t.moment > 0 ? '<span class="cw">↷</span>' : '<span class="ccw">↶</span>';
      return `<tr data-term="m:${i}"><td>${what}</td><td class="num">${fixed(t.force, decimals)} kN ${dirArrow}</td><td class="num">${length(t.lever, decimals)} m</td><td class="c">${sense}</td><td class="num">${fixed(t.moment, decimals)}</td></tr>`;
    });
    const unknownRow = `<tr class="unknown" data-term="mu"><td>${htmlName(m.unknown)} (gesucht)</td><td class="num">?</td><td class="num">${length(m.unknownLever, decimals)} m</td><td class="c">${m.unknownSense > 0 ? '<span class="cw">↷</span>' : '<span class="ccw">↶</span>'}</td><td class="num">${m.unknownSense > 0 ? '+' : '−'}${length(m.unknownLever, decimals)} · ${htmlName(m.unknown)}</td></tr>`;
    body += `<details class="sol-details"><summary>Glieder der Momentensumme (Kraft · Hebelarm)</summary><table class="sol-table"><thead><tr><th>Kraft</th><th class="num">Betrag</th><th class="num">Hebelarm</th><th class="c">Drehsinn</th><th class="num">Moment [kNm]</th></tr></thead><tbody>${unknownRow}${rows.join('')}<tr class="sum"><td colspan="4">Summe der bekannten Glieder</td><td class="num">${fixed(m.known, decimals)}</td></tr></tbody></table></details>`;
    if (zeroLever.length) {
      body += `<p class="sol-note">Hebelarm 0 (Wirkungslinie durch den Drehpunkt): ${zeroLever.map((t) => htmlName(t.label)).join(', ')}.</p>`;
    }
    if (explain) body += explainM(result, decimals);
    blocks.push(step(2, `Σ M = 0 (DP: ${escapeHtml(m.pivot)})`, '<span class="cw">↷</span> im Uhrzeigersinn positiv · <span class="ccw">↶</span> gegen den Uhrzeigersinn negativ', body));
  }

  // 3) ΣV = 0
  {
    const v = steps.v;
    const items = [
      { sign: 1, body: mark('vu', texName(v.unknown)) },
      { sign: 1, body: mark('vk', texName(v.knownName)) },
      ...v.terms.map((t, i) => ({ sign: Math.sign(t.value) || 1, body: mark(`v:${i}`, t.q !== undefined ? qProduct(t, decimals) : n(Math.abs(t.value), decimals)) })),
    ];
    let body = `<div class="sol-eq">${tex(`\\sum V = 0:\\quad ${joinSigned(items)} = 0`)}</div>`;
    const known = v.known;
    body += `<div class="sol-eq">${tex(`${texName(v.unknown)} = ${n(v.downward, decimals)} ${known >= 0 ? '-' : '+'} ${n(Math.abs(known), decimals)} = ${n(v.result, decimals)}${unit('kN')}`)}</div>`;
    body += `<div class="sol-res">${tex(resultLine(v.unknown, v.result, decimals, 'up', 'down'))}</div>`;
    if (explain) body += explainV(result, decimals);
    blocks.push(step(3, 'Σ V = 0', 'Kräfte nach oben positiv', body));
  }

  // 4) Kontrolle
  {
    const c = steps.check;
    const ok = Math.abs(c.residual) < 1e-6;
    let body = `<div class="sol-eq">${tex(`\\sum M_{(${c.pivot})} = ${n(c.residual, Math.max(decimals, 2))}${unit('kNm')}\\ ${ok ? '\\checkmark' : '\\times'}`)}</div><p class="sol-note">Momentensumme aller Kräfte und Reaktionen um das andere Lager.</p>`;
    if (explain) body += explainCheck(result, decimals);
    blocks.push(step(4, `Kontrolle: Σ M = 0 (DP: ${escapeHtml(c.pivot)})`, '', body));
  }

  // 5) Schnittgrössen
  if (forces && forces.ok) {
    const rows = forces.events.map((e) => {
      const jumpV = Math.abs(e.vLeft - e.vRight) > 1e-9;
      const jumpM = Math.abs(e.mLeft - e.mRight) > 1e-9;
      const vText = jumpV ? `${fixed(e.vLeft, decimals)} / ${fixed(e.vRight, decimals)}` : fixed(e.vRight, decimals);
      const mText = jumpM ? `${fixed(e.mLeft, decimals)} / ${fixed(e.mRight, decimals)}` : fixed(e.mLeft, decimals);
      return `<tr><td class="num">${measure(e.x)}</td><td class="num">${vText}</td><td class="num">${mText}</td></tr>`;
    });
    const firstSupport = result.reactions.reduce((a, b) => (a.x <= b.x ? a : b));
    let body = '';
    const zeros = forces.zeroCrossings.filter((z) => z.inSegment || Math.abs(z.m) > 1e-9);
    if (zeros.length) {
      body += '<ul class="sol-list">';
      for (const z of zeros) {
        const fromSupport = z.x - firstSupport.x;
        const where = Math.abs(fromSupport) < 1e-7
          ? `bei Lager ${escapeHtml(firstSupport.name)}`
          : fromSupport > 0
            ? `${measure(fromSupport)} m rechts von ${escapeHtml(firstSupport.name)}`
            : `${measure(-fromSupport)} m links von ${escapeHtml(firstSupport.name)}`;
        const what = z.inSegment ? tex('V = 0') : z.signChange ? 'V wechselt das Vorzeichen' : 'V springt auf 0';
        body += `<li>${what} bei x = ${measure(z.x)} m (${where}), ${tex(`M = ${n(z.m, decimals)}${unit('kNm')}`)}</li>`;
      }
      body += '</ul>';
    }
    body += `<div class="sol-res">${tex(`M_{\\max} = ${n(forces.mMax.m, decimals)}${unit('kNm')}\\ \\ (x = ${measure(forces.mMax.x)}\\,\\text{m}),\\qquad M_{\\min} = ${n(forces.mMin.m, decimals)}${unit('kNm')}\\ \\ (x = ${measure(forces.mMin.x)}\\,\\text{m})`)}</div>`;
    body += `<div class="sol-res">${tex(`V_{\\max} = ${n(forces.vMax.v, decimals)}${unit('kN')},\\qquad V_{\\min} = ${n(forces.vMin.v, decimals)}${unit('kN')}`)}</div>`;
    if (forces.couples.length) {
      body += `<p class="sol-note">Kräfte neben der Trägerachse (Stiel, Konsole, Stütze) wirken auf den Träger als Einzelmoment Kraft · Abstand: ${forces.couples.map((c) => `${htmlName(c.label)}: ${fixed(c.c, decimals)} kNm bei x = ${measure(c.x)} m`).join('; ')}.</p>`;
    }
    body += `<details class="sol-details"><summary>Werte an allen Stellen (links / rechts der Stelle)</summary><table class="sol-table"><thead><tr><th class="num">x [m]</th><th class="num">V [kN]</th><th class="num">M [kNm]</th></tr></thead><tbody>${rows.join('')}</tbody></table></details>`;
    if (explain) body += explainForces(forces, zeros, decimals, result.reactions.map((r) => r.x));
    blocks.push(step(5, 'Schnittgrössen', 'V positiv: Kräfte links vom Schnitt nach oben · M positiv: Zug unten', body));
  } else if (forces && !forces.ok) {
    blocks.push(step(5, 'Schnittgrössen', '', `<p class="sol-note">${escapeHtml(forces.reason)}</p>`));
  }

  const summary = result.reactions.map((r) => {
    const pieces = [];
    if (r.hasRx) pieces.push(`${r.name}x = ${fixed(Math.abs(r.Rx), decimals)} kN ${Math.abs(r.Rx) < 1e-9 ? '' : r.Rx > 0 ? '→' : '←'}`);
    pieces.push(`${r.name}z = ${fixed(Math.abs(r.Rz), decimals)} kN ${Math.abs(r.Rz) < 1e-9 ? '' : r.Rz > 0 ? '↑' : '↓'}`);
    return `<div class="chip"><span class="chip-name">${escapeHtml(r.name)}</span><span>${escapeHtml(r.type === 'fest' ? 'Gelenklager (fest)' : 'Rollenlager')}</span><strong>${pieces.map(escapeHtml).join(' · ')}</strong></div>`;
  });

  return `<div class="sol-summary">${summary.join('')}</div>${blocks.join('')}`;
}

export function renderMessages(result) {
  if (!result) return '';
  const items = [];
  for (const w of result.warnings || []) items.push(`<li class="warn">${escapeHtml(w)}</li>`);
  for (const note of result.notes || []) items.push(`<li class="note">${escapeHtml(note)}</li>`);
  return items.length ? `<ul class="messages">${items.join('')}</ul>` : '';
}

// Für die Reaktionen in der Kopfzeile (ohne KaTeX).
export function reactionText(result, decimals = 2) {
  if (!result || !result.ok) return '';
  return result.reactions
    .map((r) => {
      const parts = [];
      if (r.hasRx && Math.abs(r.Rx) > 1e-9) parts.push(`${r.name}x ${fixed(Math.abs(r.Rx), decimals)} kN ${r.Rx > 0 ? '→' : '←'}`);
      parts.push(`${r.name}z ${fixed(Math.abs(r.Rz), decimals)} kN ${Math.abs(r.Rz) < 1e-9 ? '' : r.Rz > 0 ? '↑' : '↓'}`);
      return parts.join(', ');
    })
    .join(' | ');
}
