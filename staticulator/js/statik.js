// StatiCulator Web – Rechenkern
//
// Einheiten: Kräfte in kN, Streckenlasten in kN/m, Längen in m.
// Koordinaten: x nach rechts, z nach oben.
// Kräfte intern: Fx positiv nach rechts, Fz positiv nach oben.
// Momente im Lösungsweg: im Uhrzeigersinn positiv (↻), wie in den Musterlösungen.
// Schnittgrössen (gerader Träger): V positiv, wenn die Kräfte links vom Schnitt nach oben
// zeigen; M positiv bei Zug unten (Feldmoment).

export const EPS = 1e-9;

const DIRECTIONS = {
  down: { fx: 0, fz: -1, opposite: 'up' },
  up: { fx: 0, fz: 1, opposite: 'down' },
  right: { fx: 1, fz: 0, opposite: 'left' },
  left: { fx: -1, fz: 0, opposite: 'right' },
};

export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// z der Trägerachse an der Stelle x (erster nicht senkrechter Abschnitt, der x enthält).
// Höhe des nächstgelegenen Achsendes (für Lasten oder Lager knapp ausserhalb der Achse).
function nearestEndZ(axis, x) {
  if (!Array.isArray(axis) || !axis.length || !isNum(x)) return 0;
  let best = axis[0];
  for (const p of axis) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  return best.z;
}

export function axisZAt(axis, x) {
  if (!Array.isArray(axis) || axis.length === 0 || !isNum(x)) return null;
  for (let i = 1; i < axis.length; i++) {
    const p0 = axis[i - 1];
    const p1 = axis[i];
    const dx = p1.x - p0.x;
    if (Math.abs(dx) <= EPS) continue;
    const lo = Math.min(p0.x, p1.x) - 1e-7;
    const hi = Math.max(p0.x, p1.x) + 1e-7;
    if (x >= lo && x <= hi) {
      const t = (x - p0.x) / dx;
      return p0.z + (p1.z - p0.z) * Math.min(1, Math.max(0, t));
    }
  }
  for (const p of axis) {
    if (Math.abs(p.x - x) <= 1e-7) return p.z;
  }
  return null;
}

export function axisRange(axis) {
  if (!Array.isArray(axis) || axis.length === 0) return null;
  let xmin = Infinity;
  let xmax = -Infinity;
  for (const p of axis) {
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
  }
  return { xmin, xmax };
}

export function isStraightAxis(axis) {
  if (!Array.isArray(axis) || axis.length < 2) return false;
  const z0 = axis[0].z;
  if (!axis.every((p) => Math.abs(p.z - z0) <= 1e-9)) return false;
  const range = axisRange(axis);
  return range.xmax - range.xmin > EPS;
}

// Moment einer Kraft (fx, fz) im Punkt (x, z) um den Punkt (px, pz), im Uhrzeigersinn positiv.
export function momentClockwise(x, z, fx, fz, px, pz) {
  return (z - pz) * fx - (x - px) * fz;
}

function normalizeDirection(dir, value) {
  let direction = DIRECTIONS[dir] ? dir : 'down';
  let magnitude = value;
  if (magnitude < 0) {
    magnitude = -magnitude;
    direction = DIRECTIONS[direction].opposite;
  }
  return { direction, magnitude };
}

// Eingabemodell → aufgelöste Grössen (Lager mit Höhe, Punktkräfte, Streckenlasten).
export function resolveModel(model) {
  const warnings = [];
  const axis = (model.axis || []).map((p, index) => ({ x: p.x, z: p.z, source: index })).filter((p) => isNum(p.x) && isNum(p.z));
  if (axis.length < 2) warnings.push('Die Trägerachse braucht mindestens zwei Punkte.');

  const supports = (model.supports || []).map((s, index) => {
    const name = (s.name || String.fromCharCode(65 + index)).trim() || String.fromCharCode(65 + index);
    const axisZ = axisZAt(axis, s.x);
    let z = isNum(s.z) ? s.z : axisZ;
    if (!isNum(z)) {
      z = nearestEndZ(axis, s.x);
      if (isNum(s.x)) warnings.push(`Lager ${name} liegt ausserhalb der Trägerachse; angenommen wird die Höhe des nächsten Achsendes (z = ${z}).`);
    }
    return {
      name,
      type: s.type === 'rolle' ? 'rolle' : 'fest',
      x: s.x,
      z,
      axisZ: isNum(axisZ) ? axisZ : z,
      takesH: !!s.takesH,
    };
  });

  const points = [];
  const qloads = [];
  let verticalCount = 0;
  let horizontalCount = 0;
  let qCount = 0;

  (model.loads || []).forEach((load, source) => {
    if (load.kind === 'q') {
      qCount += 1;
      const label = (load.name || '').trim() || `q${qCount}`;
      if (!isNum(load.x1) || !isNum(load.x2) || !isNum(load.value)) {
        warnings.push(`${label}: Bereich oder Wert fehlt, die Last wird nicht berücksichtigt.`);
        return;
      }
      const x1 = Math.min(load.x1, load.x2);
      const x2 = Math.max(load.x1, load.x2);
      if (x2 - x1 <= EPS) {
        warnings.push(`${label}: Die Streckenlast hat keine Länge und wird nicht berücksichtigt.`);
        return;
      }
      const { direction, magnitude } = normalizeDirection(load.dir === 'up' ? 'up' : 'down', load.value);
      const qz = direction === 'up' ? magnitude : -magnitude;
      const xc = (x1 + x2) / 2;
      const zc = axisZAt(axis, xc);
      qloads.push({
        source,
        label,
        x1,
        x2,
        value: magnitude,
        dir: direction,
        qz,
        length: x2 - x1,
        resultant: qz * (x2 - x1),
        xc,
        z: isNum(zc) ? zc : 0,
      });
      return;
    }

    // Automatische Namen zählen nach Position in der Liste (wie in der Eingabetabelle),
    // unabhängig davon, ob eine Last einen eigenen Namen hat oder unvollständig ist.
    const horizontal = load.dir === 'left' || load.dir === 'right';
    let label = (load.name || '').trim();
    if (horizontal) {
      horizontalCount += 1;
      if (!label) label = `H${horizontalCount}`;
    } else {
      verticalCount += 1;
      if (!label) label = `F${verticalCount}`;
    }
    if (!isNum(load.x) || !isNum(load.value)) {
      warnings.push(`${label}: Wert oder Position fehlt, die Last wird nicht berücksichtigt.`);
      return;
    }
    const { direction, magnitude } = normalizeDirection(load.dir, load.value);
    const d = DIRECTIONS[direction];
    const axisZ = axisZAt(axis, load.x);
    let z = isNum(load.z) ? load.z : axisZ;
    if (!isNum(z)) {
      z = nearestEndZ(axis, load.x);
      warnings.push(`${label} liegt ausserhalb der Trägerachse; angenommen wird die Höhe des nächsten Achsendes (z = ${z}).`);
    }
    points.push({
      source,
      label,
      x: load.x,
      z,
      axisZ: isNum(axisZ) ? axisZ : z,
      dir: direction,
      value: magnitude,
      fx: d.fx * magnitude,
      fz: d.fz * magnitude,
      horizontal,
    });
  });

  return { axis, supports, points, qloads, warnings };
}

// Auflagerreaktionen aus ΣH = 0, ΣM = 0 (Drehpunkt) und ΣV = 0, mit allen Schritten.
export function solve(model) {
  const resolved = resolveModel(model);
  const { supports, points, qloads } = resolved;
  const warnings = [...resolved.warnings];
  const notes = [];
  const fail = (error) => ({ ok: false, error, warnings, notes, resolved });

  if (supports.length !== 2) return fail('Es braucht genau zwei Auflager.');
  if (!supports.every((s) => isNum(s.x))) return fail('Beide Auflager brauchen eine x-Position.');
  if (Math.abs(supports[0].x - supports[1].x) <= EPS) {
    return fail('Die beiden Auflager liegen senkrecht übereinander. Dann lassen sich die vertikalen Reaktionen nicht bestimmen.');
  }

  const sumFx = points.reduce((s, p) => s + p.fx, 0);
  const sumFzPoints = points.reduce((s, p) => s + p.fz, 0);
  const sumFzQ = qloads.reduce((s, q) => s + q.resultant, 0);
  const sumFz = sumFzPoints + sumFzQ;

  // Welches Lager nimmt die Horizontalkraft auf?
  const fixed = supports.filter((s) => s.type === 'fest');
  let hSupport = null;
  if (fixed.length === 0) {
    if (Math.abs(sumFx) > 1e-9) {
      return fail('Beide Auflager sind Rollenlager: Das System ist horizontal verschieblich und kann die Horizontalkräfte nicht aufnehmen. Ein Lager muss ein festes Gelenklager sein.');
    }
    notes.push('Beide Auflager sind Rollenlager. Ohne Horizontalkräfte ist das System im Gleichgewicht, horizontal aber verschieblich.');
  } else if (fixed.length === 1) {
    hSupport = fixed[0];
  } else {
    hSupport = fixed.find((s) => s.takesH) || fixed[0];
    if (Math.abs(sumFx) > 1e-9) {
      notes.push(`Beide Auflager sind feste Gelenklager. Die Horizontalkraft ist damit statisch unbestimmt und wird hier vereinfachend ganz im Lager ${hSupport.name} angesetzt.`);
    } else {
      notes.push('Beide Auflager sind feste Gelenklager. Ohne Horizontalkräfte sind beide Horizontalreaktionen null.');
    }
  }

  const reactions = supports.map((s) => ({ name: s.name, type: s.type, x: s.x, z: s.z, axisZ: s.axisZ, Rx: 0, Rz: 0, hasRx: s.type === 'fest' }));
  const hReaction = hSupport ? reactions[supports.indexOf(hSupport)] : null;
  if (hReaction) hReaction.Rx = -sumFx;

  // Drehpunkt: gewähltes Lager, sonst das Lager mit der Horizontalkraft, sonst A.
  let pivotIndex = supports.findIndex((s) => s.name === model.pivot);
  if (pivotIndex < 0) pivotIndex = hSupport ? supports.indexOf(hSupport) : 0;
  const otherIndex = pivotIndex === 0 ? 1 : 0;
  const pivot = supports[pivotIndex];
  const other = supports[otherIndex];

  // ΣM um den Drehpunkt: bekannte Glieder.
  const momentTerms = [];
  for (const p of points) {
    const lever = p.horizontal ? Math.abs(p.z - pivot.z) : Math.abs(p.x - pivot.x);
    const m = momentClockwise(p.x, p.z, p.fx, p.fz, pivot.x, pivot.z);
    momentTerms.push({ kind: p.horizontal ? 'h' : 'v', label: p.label, force: p.value, dir: p.dir, lever, moment: m, ref: `L:${p.source}`, x: p.x, z: p.z });
  }
  for (const q of qloads) {
    const lever = Math.abs(q.xc - pivot.x);
    const m = momentClockwise(q.xc, q.z, 0, q.resultant, pivot.x, pivot.z);
    momentTerms.push({ kind: 'q', label: q.label, force: Math.abs(q.resultant), q: q.value, length: q.length, dir: q.dir, lever, moment: m, ref: `L:${q.source}`, x: q.xc, z: q.z, x1: q.x1, x2: q.x2 });
  }
  const otherReaction = reactions[otherIndex];
  if (otherReaction === hReaction && Math.abs(otherReaction.Rx) > 1e-12) {
    const lever = Math.abs(other.z - pivot.z);
    const m = momentClockwise(other.x, other.z, otherReaction.Rx, 0, pivot.x, pivot.z);
    momentTerms.push({
      kind: 'rx',
      label: `${other.name}_x`,
      force: Math.abs(otherReaction.Rx),
      dir: otherReaction.Rx > 0 ? 'right' : 'left',
      lever,
      moment: m,
      ref: `S:${otherIndex}`,
      x: other.x,
      z: other.z,
    });
  }
  const knownMoment = momentTerms.reduce((s, t) => s + t.moment, 0);
  // Unbekannte vertikale Reaktion des anderen Lagers: Moment = -(xo - xp) · Rz (Uhrzeigersinn).
  const unknownFactor = -(other.x - pivot.x);
  otherReaction.Rz = -knownMoment / unknownFactor;

  // ΣV: vertikale Reaktion im Drehpunkt.
  const pivotReaction = reactions[pivotIndex];
  pivotReaction.Rz = -sumFz - otherReaction.Rz;

  // Kontrolle: ΣM um das andere Lager mit allen Kräften.
  let checkMoment = 0;
  for (const p of points) checkMoment += momentClockwise(p.x, p.z, p.fx, p.fz, other.x, other.z);
  for (const q of qloads) checkMoment += momentClockwise(q.xc, q.z, 0, q.resultant, other.x, other.z);
  for (const r of reactions) checkMoment += momentClockwise(r.x, r.z, r.Rx, r.Rz, other.x, other.z);

  for (const r of reactions) {
    if (Math.abs(r.Rx) < 1e-10) r.Rx = 0;
    if (Math.abs(r.Rz) < 1e-10) r.Rz = 0;
  }

  return {
    ok: true,
    warnings,
    notes,
    resolved,
    reactions,
    pivotName: pivot.name,
    otherName: other.name,
    sums: { fx: sumFx, fz: sumFz, downward: -sumFz },
    steps: {
      h: {
        terms: points.filter((p) => p.horizontal).map((p) => ({ label: p.label, value: p.fx, ref: `L:${p.source}` })),
        unknown: hReaction ? `${hReaction.name}_x` : null,
        result: hReaction ? hReaction.Rx : 0,
        supportName: hReaction ? hReaction.name : null,
      },
      m: {
        pivot: pivot.name,
        terms: momentTerms,
        known: knownMoment,
        unknown: `${other.name}_z`,
        unknownLever: Math.abs(other.x - pivot.x),
        unknownSense: unknownFactor > 0 ? 1 : -1,
        // Lage für die Erklärung (Hebelarm in der Skizze)
        pivotRef: `S:${pivotIndex}`,
        pivotX: pivot.x,
        pivotZ: pivot.z,
        unknownRef: `S:${otherIndex}`,
        unknownX: other.x,
        unknownZ: other.z,
        result: otherReaction.Rz,
      },
      v: {
        terms: [
          ...points.filter((p) => !p.horizontal).map((p) => ({ label: p.label, value: p.fz, ref: `L:${p.source}` })),
          ...qloads.map((q) => ({ label: q.label, value: q.resultant, q: q.value, length: q.length, ref: `L:${q.source}`, x: q.xc })),
        ],
        known: otherReaction.Rz,
        knownName: `${other.name}_z`,
        knownRef: `S:${otherIndex}`,
        unknownRef: `S:${pivotIndex}`,
        unknown: `${pivot.name}_z`,
        downward: -sumFz,
        result: pivotReaction.Rz,
      },
      check: { pivot: other.name, residual: checkMoment },
    },
  };
}

// Schnittgrössen V und M für einen geraden, waagrechten Träger.
// Kräfte ausserhalb der Achse (Stiel, Konsole, Stütze) wirken als Einzelmoment Fx · Δz.
export function internalForces(result) {
  if (!result || !result.ok) return { ok: false, reason: 'Keine gültigen Auflagerreaktionen.' };
  const { axis, points, qloads } = result.resolved;
  if (!isStraightAxis(axis)) {
    return { ok: false, reason: 'Querkraft- und Momentenfläche werden nur für gerade, waagrechte Träger gezeichnet. Bei geknickten oder abgestuften Trägern sind die Auflagerreaktionen gesucht.' };
  }
  const z0 = axis[0].z;
  const { xmin, xmax } = axisRange(axis);
  const inRange = (x) => x >= xmin - 1e-7 && x <= xmax + 1e-7;

  const forces = []; // vertikale Einzelkräfte auf dem Träger
  const couples = []; // Einzelmomente (Uhrzeigersinn positiv)
  const outside = [];
  for (const p of points) {
    if (!inRange(p.x)) { outside.push(p.label); continue; }
    if (Math.abs(p.fz) > 0) forces.push({ x: p.x, fz: p.fz, label: p.label });
    if (Math.abs(p.fx) > 0 && Math.abs(p.z - z0) > 1e-9) couples.push({ x: p.x, c: p.fx * (p.z - z0), label: p.label });
  }
  for (const r of result.reactions) {
    if (!inRange(r.x)) { outside.push(`Lager ${r.name}`); continue; }
    if (Math.abs(r.Rz) > 0) forces.push({ x: r.x, fz: r.Rz, label: `${r.name}_z`, reaction: true });
    if (Math.abs(r.Rx) > 0 && Math.abs(r.z - z0) > 1e-9) couples.push({ x: r.x, c: r.Rx * (r.z - z0), label: `${r.name}_x`, reaction: true });
  }
  const qs = [];
  for (const q of qloads) {
    const a = Math.max(q.x1, xmin);
    const b = Math.min(q.x2, xmax);
    if (b - a > EPS) qs.push({ a, b, qz: q.qz });
    if (q.x1 < xmin - 1e-7 || q.x2 > xmax + 1e-7) outside.push(q.label);
  }
  if (outside.length) {
    return { ok: false, reason: `Ausserhalb des Trägers: ${outside.join(', ')}. Bitte Positionen prüfen.` };
  }

  const shearAt = (x, inclusive) => {
    let v = 0;
    for (const f of forces) if (inclusive ? f.x <= x + 1e-9 : f.x < x - 1e-9) v += f.fz;
    for (const q of qs) {
      const len = Math.min(q.b, x) - q.a;
      if (len > 0) v += q.qz * len;
    }
    return v;
  };
  const momentAt = (x, inclusive) => {
    let m = 0;
    for (const f of forces) if (f.x < x - 1e-9) m += f.fz * (x - f.x);
    for (const c of couples) if (inclusive ? c.x <= x + 1e-9 : c.x < x - 1e-9) m += c.c;
    for (const q of qs) {
      const end = Math.min(q.b, x);
      const len = end - q.a;
      if (len > 0) m += q.qz * len * (x - (q.a + end) / 2);
    }
    return m;
  };

  const raw = [xmin, xmax];
  for (const f of forces) raw.push(f.x);
  for (const c of couples) raw.push(c.x);
  for (const q of qs) raw.push(q.a, q.b);
  raw.sort((a, b) => a - b);
  const xs = [];
  for (const x of raw) if (!xs.length || x - xs[xs.length - 1] > 1e-7) xs.push(x);

  const events = xs.map((x) => ({
    x,
    vLeft: x > xmin + 1e-9 ? shearAt(x, false) : 0,
    vRight: x < xmax - 1e-9 ? shearAt(x, true) : 0,
    mLeft: x > xmin + 1e-9 ? momentAt(x, false) : 0,
    mRight: x < xmax - 1e-9 ? momentAt(x, true) : 0,
  }));

  const segments = [];
  const zeroCrossings = [];
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    let q = 0;
    const mid = (a.x + b.x) / 2;
    for (const load of qs) if (mid > load.a && mid < load.b) q += load.qz;
    const seg = { a: a.x, b: b.x, q, v0: a.vRight, v1: b.vLeft, m0: a.mRight, m1: b.mLeft };
    segments.push(seg);
    if (Math.abs(q) > EPS && seg.v0 * seg.v1 < 0) {
      const x = a.x - seg.v0 / q;
      const t = x - a.x;
      zeroCrossings.push({ x, m: seg.m0 + seg.v0 * t + (q * t * t) / 2, inSegment: true });
    }
  }
  // Vorzeichenwechsel von V an einer Einzelkraft
  for (const e of events) {
    if (e.x <= xmin + 1e-9 || e.x >= xmax - 1e-9) continue;
    if (e.vLeft * e.vRight < 0 || (Math.abs(e.vRight) < 1e-9 && Math.abs(e.vLeft) > 1e-9)) {
      zeroCrossings.push({ x: e.x, m: e.mLeft, inSegment: false, signChange: e.vLeft * e.vRight < 0 });
    }
  }

  const candidates = [];
  for (const e of events) {
    candidates.push({ x: e.x, m: e.mLeft });
    candidates.push({ x: e.x, m: e.mRight });
  }
  for (const z of zeroCrossings) candidates.push({ x: z.x, m: z.m });
  let mMax = candidates[0];
  let mMin = candidates[0];
  for (const c of candidates) {
    if (c.m > mMax.m + 1e-9) mMax = c;
    if (c.m < mMin.m - 1e-9) mMin = c;
  }
  let vMax = { x: xmin, v: 0 };
  let vMin = { x: xmin, v: 0 };
  for (const e of events) {
    for (const v of [e.vLeft, e.vRight]) {
      if (v > vMax.v) vMax = { x: e.x, v };
      if (v < vMin.v) vMin = { x: e.x, v };
    }
  }

  const valueAt = (x) => {
    const seg = segments.find((s) => x >= s.a - 1e-9 && x <= s.b + 1e-9);
    if (!seg) return { v: 0, m: 0 };
    const t = x - seg.a;
    return { v: seg.v0 + seg.q * t, m: seg.m0 + seg.v0 * t + (seg.q * t * t) / 2 };
  };

  return {
    ok: true,
    xmin,
    xmax,
    z0,
    events,
    segments,
    zeroCrossings: zeroCrossings.sort((a, b) => a.x - b.x),
    mMax,
    mMin,
    vMax,
    vMin,
    couples,
    valueAt,
  };
}
