// Beispiele aus den Baustatik-Unterlagen (Bauschule) mit Sollwerten für die Tests.
// Koordinaten in m (x nach rechts, z nach oben), Kräfte in kN bzw. kN/m.
// expect: Reaktionen (Rx positiv nach rechts, Rz positiv nach oben) und optional Momente.

const F = (dir, value, x, z = null, name = '') => ({ kind: 'F', dir, value, x, z, name });
const Q = (dir, value, x1, x2, name = '') => ({ kind: 'q', dir, value, x1, x2, name });
const beam = (length) => [{ x: 0, z: 0 }, { x: length, z: 0 }];

export const EXAMPLES = [
  {
    id: 'uebung1',
    title: 'Übung 1 – Träger mit Kragarm',
    source: 'Übungen 1–3, Aufgabe 1 (Lösung mit Statikprogramm und von Hand)',
    model: {
      axis: beam(8.5),
      supports: [{ name: 'A', type: 'fest', x: 2 }, { name: 'B', type: 'rolle', x: 8.5 }],
      loads: [F('down', 10, 0), F('down', 30, 4), F('down', 50, 6), F('down', 20, 8.5), Q('down', 10, 0, 8.5)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 108.65 }, B: { z: 86.35 }, moments: [[2, -40], [4, 97.31], [6, 134.62]], mMax: 134.62, mMin: -40 },
  },
  {
    id: 'uebung2',
    title: 'Übung 2 – Auf- und abwärts gerichtete Lasten',
    source: 'Übungen 1–3, Aufgabe 2',
    model: {
      axis: beam(8.5),
      supports: [{ name: 'A', type: 'fest', x: 2 }, { name: 'B', type: 'rolle', x: 7 }],
      loads: [F('up', 10, 0), F('down', 20, 1), F('down', 50, 4.5), F('up', 20, 8.5)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 41 }, B: { z: -1 }, moments: [[1, 10], [4.5, 77.5], [7, 30]], mMax: 77.5 },
  },
  {
    id: 'uebung3',
    title: 'Übung 3 – Horizontalkraft auf einem Stiel',
    source: 'Übungen 1–3, Aufgabe 3',
    model: {
      axis: beam(6),
      supports: [{ name: 'A', type: 'rolle', x: 2 }, { name: 'B', type: 'fest', x: 6 }],
      loads: [F('right', 10, 0, 1)],
      pivot: 'B',
    },
    expect: { A: { z: -2.5 }, B: { x: -10, z: 2.5 }, moments: [[1, 10], [2, 10], [4, 5]] },
  },
  {
    id: 'uebung4',
    title: 'Übung 4 – Einfeldträger mit vier Einzellasten',
    source: 'Übungen 4–6, Aufgabe 4',
    model: {
      axis: beam(7.5),
      supports: [{ name: 'A', type: 'fest', x: 0 }, { name: 'B', type: 'rolle', x: 7.5 }],
      loads: [F('down', 37.5, 1.2), F('down', 15, 2.7), F('down', 15, 4.2), F('down', 45, 5.4)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 60.3 }, B: { z: 52.2 }, moments: [[1.2, 72.36], [2.7, 106.56], [4.2, 118.26], [5.4, 109.62]], mMax: 118.26 },
  },
  {
    id: 'uebung5',
    title: 'Übung 5 – Gleichlast und zwei Einzellasten',
    source: 'Übungen 4–6, Aufgabe 5',
    model: {
      axis: beam(5),
      supports: [{ name: 'A', type: 'fest', x: 0 }, { name: 'B', type: 'rolle', x: 5 }],
      loads: [Q('down', 20, 0, 5), F('down', 12.5, 1.5), F('down', 37.5, 3.5)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 70 }, B: { z: 80 }, moments: [[1.5, 82.5], [3.5, 97.5]], mMax: 101.4 },
  },
  {
    id: 'uebung6',
    title: 'Übung 6 – Aufwärtslast im Feld',
    source: 'Übungen 4–6, Aufgabe 6',
    model: {
      axis: beam(6),
      supports: [{ name: 'A', type: 'fest', x: 0 }, { name: 'B', type: 'rolle', x: 6 }],
      loads: [F('down', 110, 1), F('up', 30, 3), F('down', 80, 4.5)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 96.67 }, B: { z: 63.33 }, moments: [[1, 96.67], [3, 70], [4.5, 95]], mMax: 96.67 },
  },
  {
    id: 'la1a1',
    title: 'Lernaufgabe 1, Aufgabe 1 – Kragträger mit Horizontalkraft am Stiel',
    source: 'Lernaufgabe 1 (Sommersemester 2024), Aufgabe 1',
    model: {
      axis: beam(8),
      supports: [{ name: 'A', type: 'fest', x: 2 }, { name: 'B', type: 'rolle', x: 8 }],
      loads: [F('down', 42, 0, null, 'F'), Q('down', 15, 2, 8, 'q'), F('right', 450, 8, 1.5, 'F1')],
      pivot: 'B',
    },
    expect: { A: { x: -450, z: -11.5 }, B: { z: 143.5 } },
  },
  {
    id: 'la1a3',
    title: 'Lernaufgabe 1, Aufgabe 3 – Kragträger am Hänger',
    source: 'Lernaufgabe 1 (Sommersemester 2024), Aufgabe 3 (Nutzlast 45 kN/m + Eigengewicht 3 kN/m)',
    model: {
      axis: beam(8.6),
      supports: [{ name: 'A', type: 'fest', x: 2 }, { name: 'B', type: 'rolle', x: 8.6, z: 3 }],
      loads: [F('down', 50, 0), Q('down', 48, 0, 8.6)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 334.1 }, B: { z: 128.7 } },
  },
  {
    id: 'la2a3',
    title: 'Lernaufgabe 2, Aufgabe 3 – Streckenlasten und Einzellasten',
    source: 'Lernaufgabe 2 (Sommersemester 2024), Aufgabe 3',
    model: {
      axis: beam(9.8),
      supports: [{ name: 'A', type: 'fest', x: 1.5 }, { name: 'B', type: 'rolle', x: 9 }],
      loads: [F('up', 50, 0), F('down', 25, 3), F('down', 50, 5.5), Q('down', 30, 3, 5.5), Q('down', 75, 5.5, 8)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 87.08 }, B: { z: 200.42 } },
  },
  {
    id: 'la2a4',
    title: 'Lernaufgabe 2, Aufgabe 4 – Kragarme auf beiden Seiten',
    source: 'Lernaufgabe 2 (Sommersemester 2024), Aufgabe 4',
    model: {
      axis: beam(10.65),
      supports: [{ name: 'A', type: 'fest', x: 2.5 }, { name: 'B', type: 'rolle', x: 10 }],
      loads: [F('down', 85, 0), Q('up', 25, 0, 2.5), Q('down', 50, 2.5, 10), F('up', 13, 6.575), F('down', 120, 10.65)],
      pivot: 'B',
    },
    // Die Handlösung nennt Mmax = 222.94 bei x = 3.782 m ab A. Nachgerechnet ergibt sich
    // −134.375 + 189.08 · 3.782 − 50 · 3.782² / 2 = 223.14 kNm (Rundung in der Handlösung).
    expect: { A: { x: 0, z: 211.58 }, B: { z: 292.92 }, mMax: 223.14, mMin: -134.38 },
  },
  {
    id: 'la3a2',
    title: 'Lernaufgabe 3, Aufgabe 2 – Gleichlast mit zwei Kragarmen',
    source: 'Lernaufgabe 3 (Sommersemester 2024), Aufgabe 2',
    model: {
      axis: beam(17),
      supports: [{ name: 'A', type: 'fest', x: 3.5 }, { name: 'B', type: 'rolle', x: 14.25 }],
      loads: [Q('down', 75, 0, 17)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 681.98 }, B: { z: 593.02 }, moments: [[3.5, -459.38]], mMax: 713.6 },
  },
  {
    id: 'la4a2',
    title: 'Lernaufgabe 4, Aufgabe 2 – Riegel auf zwei Stützen ungleicher Höhe',
    source: 'Lernaufgabe 4, Aufgabe 2',
    model: {
      axis: beam(15),
      supports: [{ name: 'A', type: 'fest', x: 3, z: -6 }, { name: 'B', type: 'fest', x: 13, z: -5 }],
      loads: [Q('down', 95, 0, 15)],
      pivot: 'B',
    },
    expect: { A: { x: 0, z: 783.75 }, B: { x: 0, z: 641.25 } },
  },
  {
    id: 'ss24a2',
    title: 'Semesterprüfung 2024, Aufgabe 2 – Abgestufter Träger',
    source: 'Semesterprüfung Baustatik, Mai 2024, Aufgabe 2 (Stufenhöhe 2 m aus der Skizze gemessen)',
    model: {
      axis: [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 9, z: -2 }, { x: 13, z: -2 }],
      supports: [{ name: 'A', type: 'rolle', x: 3 }, { name: 'B', type: 'fest', x: 11 }],
      loads: [F('right', 60, 0), Q('down', 100, 0, 6), F('right', 60, 9), Q('up', 100, 9, 13), F('left', 150, 13)],
      pivot: 'B',
    },
    expect: { A: { z: 585 }, B: { x: 30, z: -385 } },
  },
  {
    id: 'ss24a3',
    title: 'Semesterprüfung 2024, Aufgabe 3 – Träger auf Holzstütze',
    source: 'Semesterprüfung Baustatik, Mai 2024, Aufgabe 3 (ohne Musterlösung)',
    model: {
      axis: [{ x: -2, z: 3 }, { x: 8.6, z: 3 }],
      supports: [{ name: 'A', type: 'fest', x: 0, z: 0 }, { name: 'B', type: 'rolle', x: 6.6 }],
      loads: [Q('down', 150, -2, 0), Q('down', 100, 0, 3.3), F('down', 300, 3.3), Q('up', 100, 3.3, 6.6), F('up', 150, 8.6)],
      pivot: 'B',
    },
    // Die Aufgabe fragt nach der Holzstütze unter A: Bemessung direkt dort öffnen
    design: { tab: 'column', material: 'timber' },
    expect: null,
  },
  {
    id: 'ss23a2',
    title: 'Semesterprüfung 2023, Aufgabe 2 – Träger mit Schräge',
    source: 'Semesterprüfung Baustatik, Sommersemester 2023, Aufgabe 2 (ohne Musterlösung)',
    model: {
      axis: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 8, z: 1 }, { x: 11.5, z: 1 }],
      supports: [{ name: 'A', type: 'rolle', x: 2 }, { name: 'B', type: 'fest', x: 10 }],
      loads: [F('down', 150, 0), F('right', 50, 0), Q('down', 100, 2, 5), Q('up', 100, 8, 10), F('left', 100, 11.5), F('up', 100, 11.5)],
      pivot: 'B',
    },
    expect: null,
  },
];

export function exampleById(id) {
  return EXAMPLES.find((e) => e.id === id) || null;
}

export function emptyModel() {
  return {
    title: '',
    axis: beam(6),
    supports: [{ name: 'A', type: 'fest', x: 0 }, { name: 'B', type: 'rolle', x: 6 }],
    loads: [F('down', 10, 3)],
    pivot: 'B',
  };
}
