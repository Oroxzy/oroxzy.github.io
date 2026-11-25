// Begriffe der Bemessung in einfachen Worten (Erklärmodus „Schritt für Schritt“).
// Die Formelzeichen werden aus dem TeX-Quelltext der gerenderten Formeln (KaTeX-Annotation) erkannt;
// jeder Begriff erscheint nur beim ersten Schritt, in dem er vorkommt.

const TERMS = [
  // Einwirkungen
  { re: /(^|[^A-Za-z\\])M_d(?![A-Za-z{])/, sym: 'M<sub>d</sub>', text: 'Bemessungsmoment: das grösste Biegemoment aus den Lasten, schon mit Lastfaktoren. Index d = „design“, Bemessungswert.' },
  { re: /(^|[^A-Za-z\\])V_d(?![A-Za-z{])/, sym: 'V<sub>d</sub>', text: 'Bemessungsquerkraft: die grösste Querkraft mit Lastfaktoren, meist direkt am Auflager.' },
  { re: /(^|[^A-Za-z\\])N_d(?![A-Za-z{])/, sym: 'N<sub>d</sub>', text: 'Bemessungs-Normalkraft: die Kraft längs des Stabs (Druck in der Stütze, Zug im Hänger), mit Lastfaktoren.' },
  { re: /\\gamma_F/, sym: 'γ<sub>F</sub>', text: 'Lastbeiwert: macht aus der charakteristischen Last den Bemessungswert (ständig 1.35, Nutzlast 1.5).' },
  { re: /g_k|q_k/, sym: 'g<sub>k</sub>, q<sub>k</sub>', text: 'Ständige Last (Eigengewicht, Aufbau) und Nutzlast, charakteristisch – also ohne Lastfaktor – in kN/m².' },
  { re: /A_E/, sym: 'A<sub>E</sub>', text: 'Einzugsfläche: der Teil der Decke, dessen Last die Stütze trägt.' },
  { re: /(^|[^A-Za-z\\])q_d/, sym: 'q<sub>d</sub>', text: 'Bemessungslast pro Meter Träger (mit Lastfaktoren), in kN/m.' },
  // Knicklänge
  { re: /L_\{K/, sym: 'L<sub>K</sub>', text: 'Knicklänge: so lang ist die Welle, mit der die Stütze ausknickt. Sie hängt davon ab, wie die Enden gehalten sind.' },
  { re: /\\beta(?![_a-z])|\\beta_z/, sym: 'β', text: 'Knicklängenbeiwert aus dem Eulerfall: 2 (eingespannt – frei), 1 (gelenkig – gelenkig), 0.7, 0.5 (beidseitig eingespannt).' },
  // Stahl: Biegung und Schub
  { re: /f_y(?![A-Za-z{])/, sym: 'f<sub>y</sub>', text: 'Fliessgrenze des Stahls: ab dieser Spannung beginnt er zu fliessen (S235: 235 N/mm² = 23.5 kN/cm²).' },
  { re: /\\gamma_\{M1\}/, sym: 'γ<sub>M1</sub>', text: 'Widerstandsbeiwert = 1.05 (SIA 263): die Sicherheit auf der Seite des Materials. Durch ihn wird geteilt.' },
  { re: /W_\{pl,y/, sym: 'W<sub>pl,y</sub>', text: 'Plastisches Widerstandsmoment um die starke Achse y: wie viel Biegung der Querschnitt aufnimmt, wenn er ganz durchfliessen darf. Steht in der Profiltabelle, in cm³.' },
  { re: /W_\{el,y/, sym: 'W<sub>el,y</sub>', text: 'Elastisches Widerstandsmoment um y: nur die äusserste Faser erreicht f<sub>y</sub>. Etwas kleiner als W<sub>pl,y</sub>, Profiltabelle in cm³.' },
  { re: /,erf\}|_\{v,erf\}|_\{erf\}/, sym: 'erf', text: 'Index „erforderlich“: so gross muss der Wert mindestens sein, damit der Nachweis aufgeht.' },
  { re: /M_\{Rd\}/, sym: 'M<sub>Rd</sub>', text: 'Biegewiderstand: so viel Moment hält der Querschnitt aus. R = „resistance“ (Widerstand), d = Bemessungswert. Nachweis: M<sub>d</sub> ≤ M<sub>Rd</sub>.' },
  { re: /A_\{?v/, sym: 'A<sub>v</sub>', text: 'Schubfläche: der Teil des Querschnitts, der die Querkraft trägt – beim I-Profil vor allem der Steg.' },
  { re: /V_\{Rd\}/, sym: 'V<sub>Rd</sub>', text: 'Querkraftwiderstand: so viel Querkraft hält der Querschnitt aus. Nachweis: V<sub>d</sub> ≤ V<sub>Rd</sub>.' },
  // Steifigkeit, Durchbiegung
  { re: /E \\cdot I|E_\{0,mean\}/, sym: 'E · I', text: 'Biegesteifigkeit: E-Modul (wie steif das Material ist) mal Trägheitsmoment I (wie weit das Material von der Achse weg liegt). Je grösser, desto weniger biegt sich der Träger durch.' },
  { re: /w_\{\\text|w_\{zul\}/, sym: 'w, w<sub>zul</sub>', text: 'Durchbiegung und zulässige Durchbiegung (Spannweite geteilt durch die Grenze, z. B. l/400).' },
  { re: /l_V|l_M|l_\{\\max\}/, sym: 'l<sub>V</sub>, l<sub>M</sub>', text: 'Grösste Spannweite, bei der gerade noch der Schub (V) bzw. die Biegung (M) aufgeht.' },
  // Querschnitt, Knicken (Stahl und Holz)
  // A allein (nicht als Index wie z_{A} oder A_z – das ist das Lager A)
  { re: /(^|[\s(=]|(?<!_)\{)A(?=\s|=|\}|$)/, sym: 'A', text: 'Querschnittsfläche.' },
  { re: /(^|[^A-Za-z\\])i_[yz]|(^|[^A-Za-z\\])i\s*=/, sym: 'i<sub>y</sub>, i<sub>z</sub>', text: 'Trägheitsradius i = √(I/A): wie weit das Material im Mittel von der Achse entfernt ist. Kleines i = knickt leicht.' },
  { re: /\\lambda_\{K/, sym: 'λ<sub>K</sub>', text: 'Schlankheit = L<sub>K</sub> / i: lange, dünne Stützen haben ein grosses λ und knicken eher.' },
  { re: /\\lambda_E/, sym: 'λ<sub>E</sub>', text: 'Euler-Schlankheit: bei dieser Schlankheit wäre die Knickspannung gerade gleich f<sub>y</sub> (S235: 93.9).' },
  { re: /\\bar\{\\lambda\}/, sym: 'λ̄<sub>K</sub>', text: 'Bezogene Schlankheit λ<sub>K</sub> / λ<sub>E</sub>: unter 0.2 knickt nichts, um 1 sind Knicken und Fliessen gleich wichtig.' },
  { re: /\\alpha_K/, sym: 'α<sub>K</sub>', text: 'Imperfektionsbeiwert der Knickspannungskurve (a 0.21, b 0.34, c 0.49, d 0.76): berücksichtigt, dass echte Stützen nie ganz gerade sind.' },
  { re: /\\Phi_\{K/, sym: 'Φ<sub>K</sub>', text: 'Hilfswert, um χ<sub>K</sub> auszurechnen.' },
  { re: /\\chi_\{K/, sym: 'χ<sub>K</sub>', text: 'Abminderungsfaktor fürs Knicken (zwischen 0 und 1): der Anteil der vollen Tragkraft A · f<sub>y</sub>, der wegen des Knickens übrig bleibt.' },
  { re: /N_\{t,Rd/, sym: 'N<sub>t,Rd</sub>', text: 'Zugwiderstand: so viel Zugkraft hält der Stab aus. Nachweis: N<sub>d</sub> ≤ N<sub>t,Rd</sub>.' },
  { re: /f_\{t,0,d\}/, sym: 'f<sub>t,0,d</sub>', text: 'Zugfestigkeit des Holzes längs zur Faser (Bemessungswert).' },
  { re: /N_\{K,Rd/, sym: 'N<sub>K,Rd</sub>', text: 'Knickwiderstand: so viel Druckkraft hält die Stütze, bevor sie seitlich ausknickt. Nachweis: N<sub>d</sub> ≤ N<sub>K,Rd</sub>.' },
  // Holz
  { re: /f_\{m,d\}/, sym: 'f<sub>m,d</sub>', text: 'Biegefestigkeit des Holzes (Bemessungswert aus den Holzbautabellen HBT, Sicherheit schon drin).' },
  { re: /f_\{v,d\}/, sym: 'f<sub>v,d</sub>', text: 'Schubfestigkeit des Holzes (Bemessungswert, HBT).' },
  { re: /\\eta_w/, sym: 'η<sub>w</sub>', text: 'Feuchtebeiwert: geschützt 1.0, teilweise bewittert 0.8, feucht 0.6 – nasses Holz ist schwächer.' },
  { re: /h_M|h_V/, sym: 'h<sub>M</sub>, h<sub>V</sub>', text: 'Nötige Höhe aus der Biegung (M) bzw. aus dem Schub (V). Die grössere zählt, dann aufrunden.' },
  { re: /W_y(?![A-Za-z])/, sym: 'W<sub>y</sub>', text: 'Widerstandsmoment des Rechtecks = b · h² / 6: die Höhe zählt im Quadrat, darum stellt man Balken hochkant.' },
  { re: /\\sigma_\{m,d\}/, sym: 'σ<sub>m,d</sub>', text: 'Biegespannung am oberen und unteren Rand = M<sub>d</sub> / W.' },
  { re: /\\tau_d/, sym: 'τ<sub>d</sub>', text: 'Schubspannung in der Mitte des Querschnitts (dort am grössten).' },
  { re: /\\sigma_\{c,90/, sym: 'σ<sub>c,90,d</sub>', text: 'Querdruckspannung: Druck quer zur Faser auf der Auflagerfläche b · l<sub>A</sub>.' },
  { re: /f_\{c,90,d\}/, sym: 'f<sub>c,90,d</sub>', text: 'Querdruckfestigkeit: wie viel Druck quer zur Faser das Holz aushält – viel weniger als längs zur Faser.' },
  { re: /l_\{?A/, sym: 'l<sub>A</sub>', text: 'Auflagerlänge: wie lang der Balken auf dem Auflager aufliegt.' },
  { re: /f_\{c,0,d\}/, sym: 'f<sub>c,0,d</sub>', text: 'Druckfestigkeit längs zur Faser (Bemessungswert, HBT).' },
  { re: /\\lambda(?:_[yz])?\s*=/, sym: 'λ', text: 'Schlankheit = L<sub>K</sub> / i, beide in mm. Grenze für Holzstützen: 150.' },
  { re: /\\lambda_\{rel/, sym: 'λ<sub>rel</sub>', text: 'Bezogene Schlankheit beim Holz: λ / 57 (Vollholz) bzw. λ / 60 (Brettschichtholz).' },
  { re: /\\beta_c/, sym: 'β<sub>c</sub>', text: 'Imperfektionsbeiwert Holz: 0.2 Vollholz, 0.1 Brettschichtholz (gerader gewachsen bzw. verleimt).' },
  { re: /k_\{?c/, sym: 'k<sub>c</sub>', text: 'Knickbeiwert beim Holz (zwischen 0 und 1), wie χ<sub>K</sub> beim Stahl: so viel der Druckfestigkeit bleibt wegen des Knickens.' },
];

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');

// TeX-Quelltext aller Formeln eines Schritts (KaTeX legt ihn als Annotation ab)
function texOf(html) {
  const parts = [];
  const re = /<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g;
  let m;
  while ((m = re.exec(html))) parts.push(decode(m[1]));
  // Text in \text{…} (z. B. „Lager A“, Einheiten) ist kein Formelzeichen: Inhalt weglassen
  return parts.join('\n').replace(/\\text\{[^}]*\}/g, '\\text{}');
}

// Neue Begriffe dieses Schritts (in der Reihenfolge, in der sie vorkommen); seen merkt sich die schon erklärten
export function termsBox(html, seen) {
  const source = texOf(html);
  if (!source) return '';
  const found = [];
  for (const term of TERMS) {
    if (seen.has(term.sym)) continue;
    const m = term.re.exec(source);
    if (m) found.push({ term, at: m.index });
  }
  if (!found.length) return '';
  found.sort((a, b) => a.at - b.at);
  for (const x of found) seen.add(x.term.sym);
  const items = found.map(({ term }) => `<div><dt>${term.sym}</dt><dd>${term.text}</dd></div>`).join('');
  return `<div class="d-terms"><div class="d-terms-title"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM6.5 19H18v-2H6.5a.5.5 0 0 0 0 1z" fill="currentColor"/></svg>Begriffe</div><dl>${items}</dl></div>`;
}
