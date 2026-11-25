// Aufgabe aus Foto: Bild verkleinern, an den Foto-Worker schicken (der Claude fragt) und das erkannte
// System übernehmen. Ohne eingerichteten Worker bleibt der Knopf ausgeblendet.

// Adresse des Cloudflare Workers (Ordner worker/ im Repository), nach dem Einrichten hier eintragen
const ENDPOINT = 'https://staticulator-foto.staticulator-foto-worker.workers.dev/';
// zum Testen überschreibbar: localStorage.setItem('staticulator-photo-endpoint', 'http://localhost:8787')
const ENDPOINT_KEY = 'staticulator-photo-endpoint';
// Bot-Schutz Cloudflare Turnstile: öffentlicher Site-Key des Widgets (der geheime Schlüssel liegt im Worker).
// Lokal (localhost) gilt der Testschlüssel von Cloudflare, der immer besteht; der hochgeladene Worker nimmt
// dessen Nachweise nicht an, lokal also gegen `wrangler dev` mit dem Test-Secret prüfen.
const TURNSTILE_SITEKEY = '0x4AAAAAAGSdZymlDoNTEDda';
const TURNSTILE_TEST_SITEKEY = '1x00000000000000000000AA';
const SITEKEY_KEY = 'staticulator-turnstile-sitekey';
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=staticulatorTurnstileReady';
const TOKEN_WAIT_MS = 120000;
const MAX_EDGE = 1568; // längere Bildseite in px: reicht für Massketten, spart Zeit und Kosten
const JPEG_QUALITY = 0.86;
const TIMEOUT_MS = 180000;

const $ = (id) => document.getElementById(id);
const PICK_TEXT = 'Foto wählen, hineinziehen oder mit Strg+V einfügen …';

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

export function photoEndpoint() {
  return stored(ENDPOINT_KEY) || ENDPOINT;
}

function turnstileSitekey() {
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return stored(SITEKEY_KEY) || (local ? TURNSTILE_TEST_SITEKEY : TURNSTILE_SITEKEY);
}

let image = null; // { base64, mediaType, url }
let running = null; // { controller, timer, timeout, started }
const turnstile = { loading: null, widget: null, token: null, waiters: [] };

// apply(task) übernimmt das erkannte System in die App (wirft bei ungültigen Daten)
export function initPhotoImport({ apply }) {
  const button = $('photoButton');
  if (!button) return;
  button.hidden = !photoEndpoint();
  const dialog = $('photoDialog');
  const open = () => {
    if (dialog.open) return;
    setStatus('');
    updateRun();
    dialog.showModal();
    // Bot-Schutz schon beim Öffnen starten: bis das Foto gewählt ist, liegt der Nachweis meist vor
    ensureTurnstile().catch(() => {});
  };
  button.addEventListener('click', open);
  $('photoInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    useFile(file);
  });
  // Bild aus der Zwischenablage (Strg+V): im Dialog direkt, sonst öffnet es den Dialog –
  // ausser beim Tippen in einem Eingabefeld der Seite
  document.addEventListener('paste', (event) => {
    if (button.hidden || running) return;
    const file = clipboardImage(event.clipboardData);
    if (!file) return;
    if (!dialog.open && event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    open();
    useFile(file);
  });
  // Bild ins Fotofeld ziehen (z. B. aus dem Explorer)
  const pick = $('photoPick');
  pick.addEventListener('dragover', (event) => {
    if (running || !event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    pick.classList.add('dragging');
  });
  pick.addEventListener('dragleave', () => pick.classList.remove('dragging'));
  pick.addEventListener('drop', (event) => {
    pick.classList.remove('dragging');
    if (running || !event.dataTransfer) return;
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) useFile(file);
    else setStatus('Bitte eine Bilddatei hineinziehen (JPG oder PNG).', 'error');
  });
  $('photoRun').addEventListener('click', () => run(apply));
  $('photoCancel').addEventListener('click', () => {
    stop();
    dialog.close();
  });
  dialog.addEventListener('close', stop);
  $('importClose').addEventListener('click', hideImportNotice);
}

async function useFile(file) {
  if (!file || running) return;
  if (file.type && !file.type.startsWith('image/')) {
    setStatus('Das ist kein Bild. Bitte ein Foto oder einen Bildschirmausschnitt (JPG oder PNG) verwenden.', 'error');
    return;
  }
  setStatus('Foto wird vorbereitet …');
  try {
    setImage(await prepareImage(file));
    setStatus('');
  } catch (error) {
    setImage(null);
    setStatus('Dieses Bild kann der Browser nicht lesen. Bitte als JPG oder PNG versuchen.', 'error');
  }
}

function clipboardImage(data) {
  if (!data) return null;
  const item = [...(data.items || [])].find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
  if (item) return item.getAsFile();
  return [...(data.files || [])].find((file) => file.type.startsWith('image/')) || null;
}

function setImage(next) {
  if (image && image.url) URL.revokeObjectURL(image.url);
  image = next;
  const preview = $('photoPreview');
  preview.hidden = !image;
  if (image) preview.src = image.url;
  else preview.removeAttribute('src');
  $('photoPickText').textContent = image ? 'Anderes Foto wählen, hineinziehen oder einfügen …' : PICK_TEXT;
  updateRun();
}

function updateRun() {
  $('photoRun').disabled = !image || !!running;
  $('photoHint').disabled = !!running;
  $('photoInput').disabled = !!running;
}

function setStatus(text, kind = '') {
  const status = $('photoStatus');
  status.hidden = !text;
  status.textContent = text;
  status.className = `photo-status${kind ? ` ${kind}` : ''}`;
}

// Bild in ein JPG mit höchstens MAX_EDGE px umwandeln; <img> dreht Handyfotos nach den EXIF-Angaben
async function prepareImage(file) {
  const source = URL.createObjectURL(file);
  try {
    // onload statt decode(): decode() wartet in Hintergrund-Tabs, bis die Seite sichtbar ist
    const picture = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Bild nicht lesbar'));
      element.src = source;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(picture.naturalWidth, picture.naturalHeight));
    const width = Math.max(1, Math.round(picture.naturalWidth * scale));
    const height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; // durchsichtige PNGs auf Weiss
    context.fillRect(0, 0, width, height);
    context.drawImage(picture, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', JPEG_QUALITY));
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg', url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function run(apply) {
  const endpoint = photoEndpoint();
  if (!image || running || !endpoint) return;
  const controller = new AbortController();
  running = { controller, started: Date.now(), timer: null, timeout: null };
  updateRun();
  // Nachweis von Turnstile holen (meist schon da; sonst erscheint im Dialog ein Kästchen zum Anklicken)
  let token = '';
  try {
    if (!turnstile.token) setStatus('Sicherheitsprüfung läuft …', 'busy');
    token = await turnstileToken(controller.signal);
  } catch (error) {
    finish();
    if (!controller.signal.aborted) setStatus(error.message, 'error');
    return;
  }
  const started = Date.now();
  const tick = () => setStatus(`Die KI liest die Aufgabe … ${Math.round((Date.now() - started) / 1000)} s (meist 20–60 s)`, 'busy');
  running.started = started;
  running.timer = setInterval(tick, 1000);
  running.timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  tick();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: image.base64, mediaType: image.mediaType, hint: $('photoHint').value.trim(), turnstile: token }),
      signal: controller.signal,
    });
    // jeder Nachweis gilt nur einmal: für den nächsten Versuch gleich einen neuen holen
    resetTurnstile();
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (!response.ok || !data || !data.ok) {
      throw new Error((data && data.error) || `Der Foto-Import antwortet nicht richtig (Fehler ${response.status}).`);
    }
    const task = data.task || {};
    const notes = Array.isArray(task.hinweise) ? task.hinweise.filter((note) => typeof note === 'string' && note.trim()) : [];
    if (task.erkannt === false || !Array.isArray(task.axis) || task.axis.length < 2) {
      throw new Error(`Auf dem Foto wurde keine Trägeraufgabe erkannt.${notes.length ? ` ${notes.join(' ')}` : ''}`);
    }
    apply(task);
    finish();
    $('photoDialog').close();
    setImage(null);
    $('photoHint').value = '';
    showImportNotice(notes, data.remaining);
  } catch (error) {
    const aborted = error && error.name === 'AbortError';
    const timedOut = aborted && Date.now() - started >= TIMEOUT_MS - 50;
    if (aborted) resetTurnstile();
    finish();
    if (aborted && !timedOut) return; // vom Nutzer abgebrochen
    const offline = error instanceof TypeError;
    setStatus(timedOut ? 'Die Auswertung hat zu lange gedauert. Bitte noch einmal versuchen.'
      : offline ? 'Der Foto-Import ist nicht erreichbar. Besteht eine Internetverbindung?'
        : error.message, 'error');
  }
}

// ---------- Cloudflare Turnstile ----------

// Skript einmal laden und das Widget im Dialog anlegen; ohne Site-Key gibt es keinen Bot-Schutz
function ensureTurnstile() {
  const sitekey = turnstileSitekey();
  if (!sitekey) return Promise.resolve(false);
  if (!turnstile.loading) {
    turnstile.loading = new Promise((resolve, reject) => {
      window.staticulatorTurnstileReady = () => resolve();
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onerror = () => {
        turnstile.loading = null;
        reject(new Error('Die Sicherheitsprüfung von Cloudflare lässt sich nicht laden (Werbeblocker oder keine Verbindung?).'));
      };
      document.head.appendChild(script);
    }).then(() => {
      turnstile.widget = window.turnstile.render($('photoTurnstile'), {
        sitekey,
        size: 'flexible',
        appearance: 'interaction-only', // nur sichtbar, wenn Cloudflare wirklich nachfragen muss
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        language: 'de',
        callback: (token) => {
          turnstile.token = token;
          turnstile.waiters.splice(0).forEach((waiter) => waiter.resolve(token));
        },
        'expired-callback': () => { turnstile.token = null; },
        'error-callback': () => { turnstile.token = null; },
      });
      return true;
    });
  }
  return turnstile.loading;
}

async function turnstileToken(signal) {
  if (!(await ensureTurnstile())) return '';
  if (turnstile.token) return turnstile.token;
  return new Promise((resolve, reject) => {
    const waiter = { resolve: (token) => { clearTimeout(timer); resolve(token); } };
    const timer = setTimeout(() => {
      turnstile.waiters = turnstile.waiters.filter((w) => w !== waiter);
      reject(new Error('Die Sicherheitsprüfung wurde nicht abgeschlossen. Bitte das Kästchen anklicken oder die Seite neu laden.'));
    }, TOKEN_WAIT_MS);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      turnstile.waiters = turnstile.waiters.filter((w) => w !== waiter);
      reject(new DOMException('Abgebrochen', 'AbortError'));
    });
    turnstile.waiters.push(waiter);
  });
}

function resetTurnstile() {
  turnstile.token = null;
  if (turnstile.widget !== null && window.turnstile) window.turnstile.reset(turnstile.widget);
}

function finish() {
  if (!running) return;
  clearInterval(running.timer);
  clearTimeout(running.timeout);
  running = null;
  updateRun();
}

function stop() {
  if (!running) return;
  running.controller.abort();
  finish();
  setStatus('');
}

// Hinweis über den Eingaben: bleibt, bis er geschlossen oder ein anderes System geladen wird
export function showImportNotice(notes, remaining) {
  const list = $('importNotes');
  list.replaceChildren(...notes.map((note) => {
    const item = document.createElement('li');
    item.textContent = note;
    return item;
  }));
  list.hidden = !notes.length;
  const left = $('importRemaining');
  left.hidden = !Number.isFinite(remaining);
  if (Number.isFinite(remaining)) left.textContent = `Heute noch ${remaining} Foto${remaining === 1 ? '' : 's'} möglich.`;
  $('importNotice').hidden = false;
}

export function hideImportNotice() {
  const notice = $('importNotice');
  if (notice) notice.hidden = true;
}
