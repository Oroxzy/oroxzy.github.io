// Lösungsweg als Übersicht: pro Schritt eine Zeile mit Titel links und Ergebnis rechts; die Rechnung
// klappt per Klick auf. Ohne Erklärmodus sind alle Schritte zu (alle Ergebnisse auf einen Blick), mit
// Erklärmodus offen. Was man selbst auf- oder zuklappt, bleibt beim Neuaufbau erhalten, bis der
// Erklärmodus wechselt.
//
// enhanceSteps() ordnet jede <section class="sol-step"> nach dem Rendern um:
//   h3 (klickbar)  ·  div.sol-key (Ergebnis: .sol-res und Prüfzeilen; ohne Ergebnis die Formeln)  ·  div.sol-body (Rechnung)

const chosen = new Map(); // Schlüssel (Container:Schritt) → vom Nutzer gewählt: offen oder zu
let lastExplain = null;
let onToggle = null;

function setOpen(section, open) {
  section.classList.toggle('is-open', open);
  const head = section.querySelector(':scope > h3');
  if (head) head.setAttribute('aria-expanded', String(open));
}

function toggle(section) {
  const open = !section.classList.contains('is-open');
  chosen.set(section.dataset.stepKey, open);
  setOpen(section, open);
  if (onToggle) onToggle();
}

function buildStep(section, key, explain) {
  const head = section.querySelector(':scope > h3');
  if (!head) return;
  section.classList.add('sol-acc');
  section.dataset.stepKey = key;
  const keyBox = document.createElement('div');
  keyBox.className = 'sol-key';
  const results = section.querySelectorAll('.sol-res, .d-check-line');
  if (results.length) keyBox.append(...results);
  else {
    // ohne eigenes Ergebnis: kurze Schritte zeigen ihre Formeln, lange die letzte Zeile
    const eqs = [...section.querySelectorAll(':scope > .sol-eq')];
    if (eqs.length <= 2) keyBox.append(...eqs);
    else {
      // Kopie der letzten Zeile: nur im zugeklappten Zustand (aufgeklappt steht sie in der Rechnung)
      const copy = eqs[eqs.length - 1].cloneNode(true);
      copy.classList.add('sol-key-clone');
      keyBox.append(copy);
    }
  }
  const body = document.createElement('div');
  body.className = 'sol-body';
  body.append(...[...section.childNodes].filter((node) => node !== head));
  section.append(keyBox, body);
  if (!body.children.length) {
    section.classList.add('sol-flat');
    body.remove();
    return;
  }
  const chev = document.createElement('span');
  chev.className = 'sol-chev';
  chev.setAttribute('aria-hidden', 'true');
  head.prepend(chev);
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.title = 'Rechnung auf- oder zuklappen';
  head.addEventListener('click', (event) => {
    // Knöpfe im Kopf (z. B. Drehpunkt) nicht als Aufklappen werten
    if (event.target.closest('button, a, input, select')) return;
    toggle(section);
  });
  head.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle(section);
    }
  });
  setOpen(section, chosen.has(key) ? chosen.get(key) : explain);
}

// root: #solution oder #designSteps. Nach jedem Neuaufbau aufrufen; schon umgebaute Schritte bleiben.
export function enhanceSteps(root, { explain, changed } = {}) {
  if (!root) return;
  if (lastExplain !== null && lastExplain !== explain) chosen.clear();
  lastExplain = explain;
  onToggle = changed || onToggle;
  [...root.querySelectorAll('section.sol-step')].forEach((section, i) => {
    if (!section.classList.contains('sol-acc')) buildStep(section, `${root.id}:${i}`, explain);
  });
  if (onToggle) onToggle();
}

// Neues System (Beispiel, Neu, Öffnen, Rückgängig): selbst Auf- und Zugeklapptes vergessen
export function resetSteps() {
  chosen.clear();
}

function allSteps() {
  return [...document.querySelectorAll('section.sol-step.sol-acc:not(.sol-flat)')];
}

// Zustand für den Knopf „Alle aufklappen / Alle zuklappen“
export function anyClosed() {
  return allSteps().some((s) => !s.classList.contains('is-open'));
}

export function setAllSteps(open) {
  for (const s of allSteps()) {
    chosen.set(s.dataset.stepKey, open);
    setOpen(s, open);
  }
  if (onToggle) onToggle();
}
