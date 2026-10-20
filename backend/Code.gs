/**
 * Casa in Ordine - backend Google Apps Script (script legato al Google Sheet).
 * Autenticazione: token segreti per persona, salvati nelle Proprietà dello script
 * (mai nel codice, mai nell'APK). Vedi README.
 */
const APP_VERSION = '1.3.0';

const COLS = {
  tasks: ['id', 'name', 'description', 'category', 'assignee', 'frequency', 'intervalDays', 'minutes', 'effort', 'priority', 'status', 'notes', 'checklist', 'createdBy', 'createdAt', 'updatedAt', 'version', 'deleted'],
  occurrences: ['id', 'taskId', 'dueDate', 'status', 'assignee', 'doneBy', 'doneAt', 'updatedAt', 'version'],
  history: ['id', 'opId', 'occurrenceId', 'taskId', 'taskName', 'category', 'frequency', 'assignee', 'doneBy', 'doneAt', 'doneDate', 'estMinutes', 'actualMinutes', 'effort', 'notes', 'createdBy'],
  people: ['id', 'name', 'updatedAt', 'version'],
  availability: ['id', 'personId', 'type', 'weekdays', 'start', 'end', 'dateFrom', 'dateTo', 'label', 'updatedAt', 'version', 'deleted'],
  settings: ['id', 'value', 'updatedAt', 'version'],
  ops: ['id', 'action', 'at'],
  undone: ['id', 'by', 'at'] // completamenti annullati (lo storico originale resta come traccia)
};
const TITLES = { tasks: 'Mansioni', occurrences: 'Occorrenze', history: 'Storico', people: 'Persone', availability: 'Disponibilita', settings: 'Impostazioni', ops: 'Operazioni', undone: 'Annullati' };
const NUM = { intervalDays: 1, minutes: 1, effort: 1, version: 1, estMinutes: 1, actualMinutes: 1 };
const ASSIGNEES = ['p1', 'p2', 'both', 'none'];
const FREQS = ['once', 'daily', 'weekly', 'biweekly', 'monthly', 'custom'];
const SETTING_KEYS = ['dayStart', 'dayEnd', 'dailyCapMin'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------- utilità ---------- */
function iso_() { return new Date().toISOString(); }
function fail_(code, msg) { const e = new Error(msg); e.code = code; return e; }

function sheet_(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TITLES[key]);
  if (!sh) {
    sh = ss.insertSheet(TITLES[key]);
    sh.getRange(1, 1, 1, COLS[key].length).setValues([COLS[key]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, COLS[key].length).setNumberFormat('@'); // testo: evita conversioni automatiche di date/orari
  }
  return sh;
}
function cell_(col, v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (NUM[col]) {
    if ((v === '' || v == null)) return col === 'actualMinutes' ? '' : 0;
    return Number(v);
  }
  return v == null ? '' : String(v);
}
function readAll_(key) {
  const sh = sheet_(key), n = sh.getLastRow();
  if (n < 2) return [];
  const cols = COLS[key];
  return sh.getRange(2, 1, n - 1, cols.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => { const o = {}; cols.forEach((c, i) => o[c] = cell_(c, r[i])); return o; });
}
function rowOf_(key, id) {
  const sh = sheet_(key), n = sh.getLastRow();
  if (n < 2) return 0;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function get_(key, id) {
  const r = rowOf_(key, id);
  if (!r) return null;
  const cols = COLS[key];
  const v = sheet_(key).getRange(r, 1, 1, cols.length).getValues()[0];
  const o = {}; cols.forEach((c, i) => o[c] = cell_(c, v[i]));
  return o;
}
function put_(key, obj) {
  const sh = sheet_(key), cols = COLS[key];
  let r = rowOf_(key, obj.id);
  if (!r) r = sh.getLastRow() + 1;
  const rg = sh.getRange(r, 1, 1, cols.length);
  rg.setNumberFormat('@');
  rg.setValues([cols.map(c => obj[c] === undefined ? '' : obj[c])]);
}
function appendMany_(key, objs) {
  if (!objs.length) return;
  const sh = sheet_(key), cols = COLS[key], r = sh.getLastRow() + 1;
  const rg = sh.getRange(r, 1, objs.length, cols.length);
  rg.setNumberFormat('@');
  rg.setValues(objs.map(o => cols.map(c => o[c] === undefined ? '' : o[c])));
}
function lock_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(20000)) throw fail_('busy', 'Il server è occupato, riprova tra poco.');
  try { return fn(); } finally { l.releaseLock(); }
}
function newId_(p) { return p + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function checkVersion_(cur, base, what) {
  if (Number(cur.version) !== Number(base)) throw fail_('conflict', what + ' è stata modificata nel frattempo da un altro dispositivo. I dati sono stati aggiornati: riapplica la modifica.');
}
function checkDate_(d) { if (!DATE_RE.test(String(d || ''))) throw fail_('bad_request', 'Data non valida.'); }

/* ---------- date (stringhe YYYY-MM-DD) ---------- */
function addDays_(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function addMonths_(d, n) {
  const p = d.split('-').map(Number);
  const t = new Date(Date.UTC(p[0], p[1] - 1 + n, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(p[2], last));
  return t.toISOString().slice(0, 10);
}
function nextDue_(task, due, doneDate) {
  const step = d => {
    switch (task.frequency) {
      case 'daily': return addDays_(d, 1);
      case 'weekly': return addDays_(d, 7);
      case 'biweekly': return addDays_(d, 14);
      case 'monthly': return addMonths_(d, 1);
      case 'custom': return addDays_(d, Math.max(1, Number(task.intervalDays) || 1));
    }
    return null;
  };
  let n = step(due), g = 0;
  if (!n) return null;
  while (n <= doneDate && g++ < 400) n = step(n); // la prossima scadenza è sempre nel futuro
  return n;
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

/* ---------- autenticazione ---------- */
function same_(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function auth_(token, props) {
  const t1 = props.TOKEN_P1, t2 = props.TOKEN_P2;
  if (!t1 || !t2) throw fail_('not_configured', 'Token non configurati: esegui generaTokenAccesso nello Script.');
  const tok = String(token || '');
  const m1 = same_(tok, t1), m2 = same_(tok, t2);
  if (m1) return 'p1';
  if (m2) return 'p2';
  const cache = CacheService.getScriptCache(), n = Number(cache.get('fails') || 0);
  if (n >= 10) throw fail_('locked', 'Troppi tentativi errati. Riprova tra 10 minuti.');
  cache.put('fails', String(n + 1), 600);
  throw fail_('auth', 'Token non valido.');
}

/** Da eseguire UNA volta dall'editor: crea i due token segreti (uno per persona). */
function generaTokenAccesso() {
  const mk = () => Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const t1 = mk(), t2 = mk();
  PropertiesService.getScriptProperties().setProperties({ TOKEN_P1: t1, TOKEN_P2: t2 });
  Logger.log('TOKEN PERSONA 1 (tuo):\n' + t1 + '\n\nTOKEN PERSONA 2 (Paola):\n' + t2);
}

/* ---------- endpoint ---------- */
function doGet() { // solo per verificare che l'URL sia raggiungibile: non restituisce dati
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'casa-in-ordine', version: APP_VERSION })).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties().getProperties(); // una sola lettura: token + revisione
    const user = auth_(req.token, props);
    out = route_(req, user, props);
  } catch (err) {
    out = { ok: false, code: err.code || 'error', message: err.code ? err.message : 'Errore del server: ' + err.message };
    if (err.code === 'conflict') { try { out.snapshot = snapshot_(getRev_()); } catch (x) { /* ignora */ } }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const WRITES = {
  saveTask: saveTask_, deleteTask: deleteTask_, completeOccurrence: completeOccurrence_, updateOccurrence: updateOccurrence_,
  undoCompletion: undoCompletion_, savePerson: savePerson_, saveAvailability: saveAvailability_, deleteAvailability: deleteAvailability_, saveSetting: saveSetting_
};
function getRev_() { return PropertiesService.getScriptProperties().getProperty('REV') || '0'; }
function bumpRev_() { const p = PropertiesService.getScriptProperties(), r = String(Number(p.getProperty('REV') || 0) + 1); p.setProperty('REV', r); return r; }
/** Da eseguire dall'editor se modifichi il foglio a mano: forza i telefoni a riscaricare tutto. */
function forzaAggiornamento() { bumpRev_(); Logger.log('I telefoni riscaricheranno i dati al prossimo aggiornamento.'); }

function idsOf_(key) {
  const sh = sheet_(key), n = sh.getLastRow(), set = {};
  if (n >= 2) sh.getRange(2, 1, n - 1, 1).getValues().forEach(r => { set[String(r[0])] = 1; });
  return set;
}
function route_(req, user, props) {
  if (req.action === 'ping') return { ok: true, user: user, version: APP_VERSION };
  if (req.action === 'sync') {
    let rev = props.REV || '0';
    if (req.rev != null && String(req.rev) === rev) return { ok: true, unchanged: true, rev: rev }; // nessuna novità: una sola lettura, risposta immediata
    if (sheet_('people').getLastRow() < 2) { lock_(seed_); rev = getRev_(); }
    return { ok: true, snapshot: cachedSnapshot_(rev, false) };
  }
  if (req.action === 'batch') { // più modifiche in una sola richiesta, un solo lock, una sola risposta leggera
    const ops = Array.isArray(req.ops) ? req.ops.slice(0, 30) : [];
    return lock_(() => {
      const seen = idsOf_('ops'), results = [], done = [];
      ops.forEach(o => {
        const id = String(o && o.opId || '');
        if (id.length < 8 || !WRITES[o.action]) { results.push({ opId: id, ok: false, code: 'bad_request', message: 'Operazione non valida.' }); return; }
        if (seen[id]) { results.push({ opId: id, ok: true, duplicate: true }); return; } // già applicata (ripetizione di una richiesta): nessun doppione
        try {
          WRITES[o.action](Object.assign({}, o.payload, { opId: id }), user);
          seen[id] = 1; done.push({ id: id, action: o.action, at: iso_() }); results.push({ opId: id, ok: true });
        } catch (err) {
          results.push({ opId: id, ok: false, code: err.code || 'error', message: err.code ? err.message : 'Errore del server: ' + err.message });
        }
      });
      appendMany_('ops', done);
      return { ok: true, rev: done.length ? bumpRev_() : getRev_(), results: results };
    });
  }
  const fn = WRITES[req.action]; // singole operazioni (compatibilità con le versioni precedenti dell'app)
  if (!fn) throw fail_('bad_request', 'Azione sconosciuta.');
  if (!req.opId || String(req.opId).length < 8) throw fail_('bad_request', 'opId mancante.');
  return lock_(() => {
    if (rowOf_('ops', req.opId)) return { ok: true, duplicate: true, snapshot: cachedSnapshot_(getRev_(), true) };
    fn(req, user);
    appendMany_('ops', [{ id: req.opId, action: req.action, at: iso_() }]);
    bumpRev_();
    return { ok: true, snapshot: cachedSnapshot_(getRev_(), true) };
  });
}
function snapshot_(rev) {
  const undone = {};
  readAll_('undone').forEach(u => { undone[u.id] = 1; });
  return {
    rev: String(rev), serverTime: iso_(),
    tasks: readAll_('tasks').filter(t => t.deleted !== 'true'),
    occurrences: readAll_('occurrences').filter(o => o.status === 'open'),
    history: readAll_('history').filter(h => !undone[h.id]),
    people: readAll_('people'),
    availability: readAll_('availability').filter(a => a.deleted !== 'true'),
    settings: readAll_('settings')
  };
}
/** Istantanea in cache per revisione: le letture dal foglio sono lente, la cache no. */
function cachedSnapshot_(rev, locked) {
  const c = CacheService.getScriptCache(), n = Number(c.get('sn:' + rev) || 0);
  if (n) {
    const keys = []; for (let i = 0; i < n; i++) keys.push('sp:' + rev + ':' + i);
    const got = c.getAll(keys); let txt = '', ok = true;
    keys.forEach(k => { if (got[k] == null) ok = false; else txt += got[k]; });
    if (ok) { try { return JSON.parse(txt); } catch (e) { /* ricostruisci */ } }
  }
  const build = () => {
    const cur = getRev_(), snap = snapshot_(cur); // dati coerenti: nessuna scrittura può avvenire durante la lettura
    try {
      const txt = JSON.stringify(snap), parts = {}; let k = 0;
      for (let i = 0; i < txt.length; i += 30000) parts['sp:' + cur + ':' + (k++)] = txt.slice(i, i + 30000);
      if (k <= 200) { parts['sn:' + cur] = String(k); c.putAll(parts, 21600); }
    } catch (e) { /* la cache è solo un'ottimizzazione */ }
    return snap;
  };
  return locked ? build() : lock_(build);
}

/* ---------- operazioni di scrittura (sempre sotto lock) ---------- */
function validateTask_(t) {
  if (!t.id) throw fail_('bad_request', 'id mancante.');
  if (!String(t.name || '').trim() || String(t.name).length > 120) throw fail_('bad_request', 'Nome non valido.');
  if (ASSIGNEES.indexOf(t.assignee) < 0) throw fail_('bad_request', 'Responsabile non valido.');
  if (FREQS.indexOf(t.frequency) < 0) throw fail_('bad_request', 'Frequenza non valida.');
  if (['active', 'archived'].indexOf(t.status) < 0) throw fail_('bad_request', 'Stato non valido.');
  if (['low', 'medium', 'high'].indexOf(t.priority) < 0) throw fail_('bad_request', 'Priorità non valida.');
  const m = Number(t.minutes), ef = Number(t.effort);
  if (!(m >= 0 && m <= 1440)) throw fail_('bad_request', 'Durata non valida.');
  if (!(ef >= 1 && ef <= 5)) throw fail_('bad_request', 'Impegno non valido.');
}
function pickTask_(t) {
  return {
    name: String(t.name).trim(), description: String(t.description || '').slice(0, 1000), category: String(t.category || 'Altro').slice(0, 60),
    assignee: t.assignee, frequency: t.frequency, intervalDays: Math.max(1, Number(t.intervalDays) || 1), minutes: Number(t.minutes), effort: Number(t.effort),
    priority: t.priority, status: t.status, notes: String(t.notes || '').slice(0, 1000), checklist: String(t.checklist || '[]').slice(0, 3000)
  };
}
function newOcc_(taskId, due) {
  appendMany_('occurrences', [{ id: newId_('o'), taskId: taskId, dueDate: due, status: 'open', assignee: '', doneBy: '', doneAt: '', updatedAt: iso_(), version: 1 }]);
}
function cancelOpens_(taskId, exceptId) {
  readAll_('occurrences').filter(o => o.taskId === taskId && o.status === 'open' && o.id !== exceptId).forEach(o => {
    o.status = 'cancelled'; o.updatedAt = iso_(); o.version += 1; put_('occurrences', o);
  });
}
function saveTask_(req, user) {
  const t = req.task || {};
  validateTask_(t);
  const now = iso_(), cur = get_('tasks', t.id);
  let rec;
  if (cur) {
    if (cur.deleted === 'true') throw fail_('conflict', 'La mansione è stata eliminata.');
    checkVersion_(cur, t.baseVersion, 'La mansione');
    rec = Object.assign({}, cur, pickTask_(t), { updatedAt: now, version: cur.version + 1 });
  } else {
    rec = Object.assign({}, pickTask_(t), { id: t.id, createdBy: user, createdAt: now, updatedAt: now, version: 1, deleted: 'false' });
  }
  put_('tasks', rec);
  if (rec.status !== 'active') { cancelOpens_(rec.id); return; }
  if (req.dueDate) checkDate_(req.dueDate);
  const opens = readAll_('occurrences').filter(o => o.taskId === rec.id && o.status === 'open');
  if (opens.length) { // al massimo una occorrenza aperta per mansione: niente duplicati
    if (req.dueDate && opens[0].dueDate !== req.dueDate) { opens[0].dueDate = req.dueDate; opens[0].updatedAt = now; opens[0].version += 1; put_('occurrences', opens[0]); }
  } else if (req.dueDate) newOcc_(rec.id, req.dueDate);
}
function deleteTask_(req) {
  const cur = get_('tasks', req.id);
  if (!cur || cur.deleted === 'true') return;
  checkVersion_(cur, req.baseVersion, 'La mansione');
  cur.deleted = 'true'; cur.status = 'archived'; cur.updatedAt = iso_(); cur.version += 1; // eliminazione logica: lo storico resta consultabile
  put_('tasks', cur);
  cancelOpens_(cur.id);
}
function completeOccurrence_(req, user) {
  const o = get_('occurrences', req.occurrenceId);
  if (!o) throw fail_('conflict', 'Attività non trovata (forse è stata modificata o eliminata).');
  if (o.status !== 'open') throw fail_('conflict', 'Questa attività risulta già completata o annullata da un altro dispositivo.');
  const task = get_('tasks', o.taskId);
  if (!task || task.deleted === 'true') throw fail_('conflict', 'La mansione è stata eliminata.');
  if (['p1', 'p2', 'both'].indexOf(req.doneBy) < 0) throw fail_('bad_request', 'Persona non valida.');
  checkDate_(req.doneDate);
  let actual = '';
  if (req.actualMinutes !== '' && req.actualMinutes != null) {
    actual = Number(req.actualMinutes);
    if (!(actual >= 0 && actual <= 1440)) throw fail_('bad_request', 'Durata effettiva non valida.');
  }
  const doneAt = String(req.doneAt || iso_());
  appendMany_('history', [{
    id: 'h_' + req.opId, opId: req.opId, occurrenceId: o.id, taskId: task.id, taskName: task.name, category: task.category, frequency: task.frequency,
    assignee: o.assignee || task.assignee, doneBy: req.doneBy, doneAt: doneAt, doneDate: req.doneDate, estMinutes: task.minutes,
    actualMinutes: actual, effort: task.effort, notes: String(req.notes || '').slice(0, 500), createdBy: user
  }]);
  o.status = 'done'; o.doneBy = req.doneBy; o.doneAt = doneAt; o.updatedAt = iso_(); o.version += 1;
  put_('occurrences', o);
  if (task.frequency !== 'once' && task.status === 'active') {
    const hasOpen = readAll_('occurrences').some(x => x.taskId === task.id && x.status === 'open');
    const nd = nextDue_(task, o.dueDate, req.doneDate);
    if (!hasOpen && nd) newOcc_(task.id, nd);
  }
}
function undoCompletion_(req, user) {
  const h = get_('history', req.historyId);
  if (!h) throw fail_('conflict', 'Completamento non trovato.');
  if (rowOf_('undone', h.id)) return; // già annullato: nessun effetto
  appendMany_('undone', [{ id: h.id, by: user, at: iso_() }]);
  const o = get_('occurrences', h.occurrenceId), task = get_('tasks', h.taskId);
  if (o && o.status === 'done' && task && task.deleted !== 'true' && task.status === 'active') {
    o.status = 'open'; o.doneBy = ''; o.doneAt = ''; o.updatedAt = iso_(); o.version += 1; // l'attività torna da fare
    put_('occurrences', o);
    cancelOpens_(task.id, o.id); // elimina l'occorrenza successiva generata dal completamento: una sola aperta per mansione
  }
}
function updateOccurrence_(req) {
  const o = get_('occurrences', req.id);
  if (!o || o.status !== 'open') throw fail_('conflict', 'Attività non più aperta.');
  checkVersion_(o, req.baseVersion, 'L\'attività');
  if (req.dueDate !== undefined) { checkDate_(req.dueDate); o.dueDate = req.dueDate; }
  if (req.assignee !== undefined) {
    if (['', 'p1', 'p2', 'both', 'none'].indexOf(req.assignee) < 0) throw fail_('bad_request', 'Responsabile non valido.');
    o.assignee = req.assignee;
  }
  o.updatedAt = iso_(); o.version += 1;
  put_('occurrences', o);
}
function savePerson_(req) {
  if (['p1', 'p2'].indexOf(req.id) < 0) throw fail_('bad_request', 'Persona non valida.');
  const name = String(req.name || '').trim().slice(0, 40);
  if (!name) throw fail_('bad_request', 'Nome non valido.');
  const cur = get_('people', req.id);
  if (cur) checkVersion_(cur, req.baseVersion, 'Il nome');
  put_('people', { id: req.id, name: name, updatedAt: iso_(), version: cur ? cur.version + 1 : 1 });
}
function saveAvailability_(req) {
  const a = req.item || {};
  if (!a.id) throw fail_('bad_request', 'id mancante.');
  if (['p1', 'p2'].indexOf(a.personId) < 0) throw fail_('bad_request', 'Persona non valida.');
  if (['lavoro', 'impegno', 'disponibile', 'assenza'].indexOf(a.type) < 0) throw fail_('bad_request', 'Tipo non valido.');
  if (a.type === 'assenza') { checkDate_(a.dateFrom); checkDate_(a.dateTo || a.dateFrom); }
  else {
    if (!TIME_RE.test(a.start) || !TIME_RE.test(a.end) || a.start >= a.end) throw fail_('bad_request', 'Orario non valido.');
    if (!/^[0-6](,[0-6])*$/.test(String(a.weekdays || ''))) throw fail_('bad_request', 'Giorni non validi.');
  }
  const cur = get_('availability', a.id);
  if (cur) checkVersion_(cur, a.baseVersion, 'La disponibilità');
  put_('availability', {
    id: a.id, personId: a.personId, type: a.type, weekdays: a.type === 'assenza' ? '' : a.weekdays, start: a.type === 'assenza' ? '' : a.start, end: a.type === 'assenza' ? '' : a.end,
    dateFrom: a.type === 'assenza' ? a.dateFrom : '', dateTo: a.type === 'assenza' ? (a.dateTo || a.dateFrom) : '', label: String(a.label || '').slice(0, 60),
    updatedAt: iso_(), version: cur ? cur.version + 1 : 1, deleted: 'false'
  });
}
function deleteAvailability_(req) {
  const cur = get_('availability', req.id);
  if (!cur) return;
  checkVersion_(cur, req.baseVersion, 'La disponibilità');
  cur.deleted = 'true'; cur.updatedAt = iso_(); cur.version += 1;
  put_('availability', cur);
}
function saveSetting_(req) {
  if (SETTING_KEYS.indexOf(req.key) < 0) throw fail_('bad_request', 'Impostazione sconosciuta.');
  const v = String(req.value);
  if (req.key !== 'dailyCapMin' && !TIME_RE.test(v)) throw fail_('bad_request', 'Orario non valido.');
  if (req.key === 'dailyCapMin' && !(Number(v) >= 0 && Number(v) <= 1440)) throw fail_('bad_request', 'Valore non valido.');
  const cur = get_('settings', req.key); // ultima scrittura vince (impostazioni a basso rischio di conflitto)
  put_('settings', { id: req.key, value: v, updatedAt: iso_(), version: cur ? cur.version + 1 : 1 });
}

/* ---------- inizializzazione (non cancella mai dati esistenti) ---------- */
const SEED_TASKS = [
  ['Bucato', 'Fare la lavatrice', 'weekly', 10, 1], ['Bucato', 'Stendere il bucato', 'weekly', 15, 2], ['Bucato', 'Ritirare il bucato', 'weekly', 10, 1],
  ['Bucato', 'Piegare e riporre', 'weekly', 25, 2], ['Bucato', 'Stirare', 'weekly', 45, 3],
  ['Pulizie', 'Spolverare', 'weekly', 20, 2], ['Pulizie', 'Aspirare', 'weekly', 30, 3], ['Pulizie', 'Lavare i pavimenti', 'weekly', 40, 4],
  ['Pulizie', 'Pulire il bagno', 'weekly', 40, 4], ['Pulizie', 'Pulire la cucina', 'weekly', 30, 3], ['Pulizie', 'Pulire la doccia', 'biweekly', 20, 3], ['Pulizie', 'Pulire i vetri', 'monthly', 45, 3],
  ['Cucina', 'Cucinare la cena', 'daily', 45, 3], ['Cucina', 'Lavare le stoviglie', 'daily', 20, 2], ['Cucina', 'Svuotare la lavastoviglie', 'daily', 10, 1], ['Cucina', 'Pulire il piano di lavoro', 'daily', 5, 1],
  ['Ordine', 'Riordinare le stanze', 'weekly', 20, 2], ['Ordine', 'Sistemare gli oggetti fuori posto', 'daily', 10, 1], ['Ordine', 'Rifare il letto', 'daily', 5, 1],
  ['Spesa e scorte', 'Fare la spesa', 'weekly', 60, 3], ['Spesa e scorte', 'Pianificare i pasti', 'weekly', 20, 2], ['Spesa e scorte', 'Controllare i prodotti mancanti', 'weekly', 10, 1],
  ['Rifiuti', 'Svuotare i cestini', 'weekly', 10, 1], ['Rifiuti', 'Differenziare i rifiuti', 'daily', 5, 1], ['Rifiuti', 'Portare fuori la spazzatura', 'weekly', 10, 1],
  ['Gestione domestica', 'Pagare le bollette', 'monthly', 20, 2], ['Gestione domestica', 'Appuntamenti e manutenzioni', 'monthly', 15, 2], ['Gestione domestica', 'Pianificare la settimana', 'weekly', 15, 2]
];
function seed_() {
  if (readAll_('people').length) return;
  const now = iso_(), td = today_();
  appendMany_('people', [{ id: 'p1', name: 'Persona 1', updatedAt: now, version: 1 }, { id: 'p2', name: 'Paola', updatedAt: now, version: 1 }]);
  appendMany_('settings', [['dayStart', '07:00'], ['dayEnd', '22:00'], ['dailyCapMin', '120']].map(s => ({ id: s[0], value: s[1], updatedAt: now, version: 1 })));
  const av = (id, p, type, wd, s, e, label) => ({ id: id, personId: p, type: type, weekdays: wd, start: s, end: e, dateFrom: '', dateTo: '', label: label, updatedAt: now, version: 1, deleted: 'false' });
  appendMany_('availability', [
    av('av_seed1', 'p1', 'lavoro', '1,2,3,4,5', '09:00', '18:00', 'Lavoro (orario di esempio: modificalo)'),
    av('av_seed2', 'p2', 'impegno', '1,3', '07:00', '22:00', 'Non disponibile il lunedì e il mercoledì')
  ]);
  const tasks = [], occs = [];
  SEED_TASKS.forEach((s, i) => {
    const id = newId_('t');
    tasks.push({ id: id, name: s[1], description: '', category: s[0], assignee: 'none', frequency: s[2], intervalDays: 7, minutes: s[3], effort: s[4], priority: 'medium', status: 'active', notes: '', checklist: '[]', createdBy: 'seed', createdAt: now, updatedAt: now, version: 1, deleted: 'false' });
    occs.push({ id: newId_('o'), taskId: id, dueDate: addDays_(td, i % 7), status: 'open', assignee: '', doneBy: '', doneAt: '', updatedAt: now, version: 1 });
  });
  appendMany_('tasks', tasks);
  appendMany_('occurrences', occs);
  bumpRev_();
}
/** Da eseguire una volta dall'editor: crea i fogli e le mansioni di partenza. Si può rilanciare senza rischi. */
function setup() {
  Object.keys(COLS).forEach(sheet_);
  lock_(seed_);
  const def = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Foglio1') || SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) SpreadsheetApp.getActiveSpreadsheet().deleteSheet(def);
  Logger.log('Fogli pronti. Ora esegui generaTokenAccesso.');
}
