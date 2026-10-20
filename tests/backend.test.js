// Test della logica di backend con una simulazione in memoria di Google Sheets/Apps Script.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
class Sheet {
  constructor(n) { this.name = n; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  getRange(r, c, nr = 1, nc = 1) {
    const s = this;
    return {
      setValues(v) { v.forEach((row, i) => { s.rows[r - 1 + i] = s.rows[r - 1 + i] || []; row.forEach((x, j) => { s.rows[r - 1 + i][c - 1 + j] = x; }); }); return this; },
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = s.rows[r - 1 + i] || []; o.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] === undefined ? '' : row[c - 1 + j])); } return o; },
      setFontWeight() { return this; }, setNumberFormat() { return this; }
    };
  }
}
const sheets = {}, props = {}, cache = {};
const pad = n => String(n).padStart(2, '0');
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)),
    getSheets: () => Object.values(sheets), deleteSheet: s => delete sheets[s.name] }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, getProperties: () => Object.assign({}, props), setProperties: o => Object.assign(props, o) }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, getAll: ks => Object.fromEntries(ks.filter(k => k in cache).map(k => [k, cache[k]])), putAll: o => Object.assign(cache, o) }) },
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` },
  Session: { getScriptTimeZone: () => 'Europe/Rome' },
  ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
  Logger: { log() {} }, console
};
vm.createContext(ctx);
const bdir = __dirname + '/../backend', bfile = fs.readdirSync(bdir).find(f => /^code\.gs(\.txt)?$/i.test(f));
assert(bfile, 'File del backend non trovato in backend/ (atteso Code.gs)');
vm.runInContext(fs.readFileSync(bdir + '/' + bfile, 'utf8'), ctx);

const call = (token, action, p = {}) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ token, action }, p)) } }));
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = ymd(new Date());
const add = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
let n = 0; const op = () => 'op-test-' + (++n).toString().padStart(4, '0');

ctx.setup(); ctx.generaTokenAccesso();
const T1 = props.TOKEN_P1, T2 = props.TOKEN_P2;
assert(T1.length >= 60 && T1 !== T2, 'token generati');

// auth
assert.strictEqual(call('sbagliato', 'sync').code, 'auth');
assert.strictEqual(call(T1, 'ping').user, 'p1');
assert.strictEqual(call(T2, 'ping').user, 'p2');

// sync + seed idempotente
let s = call(T1, 'sync').snapshot;
assert.strictEqual(s.tasks.length, 28); assert.strictEqual(s.occurrences.length, 28); assert.strictEqual(s.people.length, 2);
ctx.setup(); s = call(T1, 'sync').snapshot;
assert.strictEqual(s.tasks.length, 28, 'setup rilanciato non duplica');
assert(s.tasks.every(t => t.assignee === 'none'), 'nessuna assegnazione automatica');

// completamento ricorrente: una sola nuova occorrenza, idempotente
const task = s.tasks.find(t => t.name === 'Fare la lavatrice');
let occ = s.occurrences.find(o => o.taskId === task.id);
const id1 = op();
let r = call(T2, 'completeOccurrence', { opId: id1, occurrenceId: occ.id, doneBy: 'p2', doneAt: new Date().toISOString(), doneDate: TODAY, actualMinutes: 12, notes: 'ok' });
assert(r.ok, JSON.stringify(r));
assert.strictEqual(r.snapshot.history.length, 1);
let opens = r.snapshot.occurrences.filter(o => o.taskId === task.id);
assert.strictEqual(opens.length, 1, 'una sola occorrenza aperta');
assert(opens[0].dueDate > TODAY, 'prossima scadenza nel futuro');
r = call(T2, 'completeOccurrence', { opId: id1, occurrenceId: occ.id, doneBy: 'p2', doneAt: new Date().toISOString(), doneDate: TODAY });
assert(r.ok && r.duplicate, 'ripetizione = duplicato'); assert.strictEqual(r.snapshot.history.length, 1, 'nessun doppio storico');
r = call(T1, 'completeOccurrence', { opId: op(), occurrenceId: occ.id, doneBy: 'p1', doneAt: new Date().toISOString(), doneDate: TODAY });
assert.strictEqual(r.code, 'conflict', 'completamento simultaneo dall\'altro telefono rifiutato');
assert.strictEqual(r.snapshot.history.length, 1);

// attività scaduta giornaliera: la prossima è domani, non nel passato
const daily = s.tasks.find(t => t.name === 'Rifare il letto');
const dOcc = s.occurrences.find(o => o.taskId === daily.id);
r = call(T1, 'updateOccurrence', { opId: op(), id: dOcc.id, baseVersion: dOcc.version, dueDate: add(TODAY, -3) });
assert(r.ok, JSON.stringify(r));
r = call(T1, 'completeOccurrence', { opId: op(), occurrenceId: dOcc.id, doneBy: 'both', doneAt: new Date().toISOString(), doneDate: TODAY });
assert.strictEqual(r.snapshot.occurrences.find(o => o.taskId === daily.id).dueDate, add(TODAY, 1));

// una tantum: nessuna nuova occorrenza; conflitti di versione; eliminazione logica
const tid = 't_prova_0001';
const base = { id: tid, name: 'Prenotare idraulico', description: '', category: 'Gestione domestica', assignee: 'p1', frequency: 'once', intervalDays: 7, minutes: 15, effort: 2, priority: 'high', status: 'active', notes: '', checklist: '[]', baseVersion: 0 };
r = call(T1, 'saveTask', { opId: op(), task: base, dueDate: TODAY }); assert(r.ok, JSON.stringify(r));
r = call(T1, 'saveTask', { opId: op(), task: Object.assign({}, base, { name: 'x' }), dueDate: TODAY });
assert.strictEqual(r.code, 'conflict', 'versione obsoleta rifiutata');
r = call(T1, 'saveTask', { opId: op(), task: Object.assign({}, base, { name: 'Prenotare idraulico (urgente)', baseVersion: 1 }), dueDate: add(TODAY, 2) });
assert(r.ok); assert.strictEqual(r.snapshot.occurrences.filter(o => o.taskId === tid).length, 1, 'cambio scadenza senza duplicati');
const once = r.snapshot.occurrences.find(o => o.taskId === tid);
r = call(T1, 'completeOccurrence', { opId: op(), occurrenceId: once.id, doneBy: 'p1', doneAt: new Date().toISOString(), doneDate: TODAY });
assert.strictEqual(r.snapshot.occurrences.filter(o => o.taskId === tid).length, 0, 'una tantum non si rigenera');
r = call(T1, 'deleteTask', { opId: op(), id: tid, baseVersion: 2 }); assert(r.ok);
assert(!r.snapshot.tasks.some(t => t.id === tid)); assert(r.snapshot.history.some(h => h.taskId === tid), 'storico conservato');

// annullamento di un completamento (clic sbagliato)
let rs = call(T1, 'undoCompletion', { opId: op(), historyId: 'h_' + id1 });
assert(rs.ok, JSON.stringify(rs));
assert(!rs.snapshot.history.some(h => h.id === 'h_' + id1), 'sparisce dallo storico/statistiche');
opens = rs.snapshot.occurrences.filter(o => o.taskId === task.id);
assert.strictEqual(opens.length, 1, 'una sola occorrenza aperta dopo l\'annullamento');
assert.strictEqual(opens[0].id, occ.id, 'torna aperta l\'occorrenza originale');
rs = call(T1, 'undoCompletion', { opId: op(), historyId: 'h_' + id1 }); assert(rs.ok, 'annullare due volte non fa danni');
assert.strictEqual(call(T1, 'undoCompletion', { opId: op(), historyId: 'h_inesistente' }).code, 'conflict');
// si può completare di nuovo dopo l'annullamento, senza duplicati
rs = call(T2, 'completeOccurrence', { opId: op(), occurrenceId: occ.id, doneBy: 'p2', doneAt: new Date().toISOString(), doneDate: TODAY });
assert(rs.ok); assert.strictEqual(rs.snapshot.occurrences.filter(o => o.taskId === task.id).length, 1);
// sincronizzazione leggera per revisione
const full = call(T1, 'sync').snapshot, again = call(T1, 'sync', { rev: full.rev });
assert(again.ok && again.unchanged && !again.snapshot, 'nessuna novità: risposta senza dati');
assert(call(T1, 'sync', { rev: '0' }).snapshot, 'revisione diversa: dati completi');
const w = call(T1, 'saveSetting', { opId: op(), key: 'dailyCapMin', value: '90' });
assert(w.snapshot.rev !== full.rev && call(T2, 'sync', { rev: full.rev }).snapshot.settings.find(x => x.id === 'dailyCapMin').value === '90', 'una scrittura invalida la revisione degli altri telefoni');

// invio multiplo: tante modifiche rapide in una richiesta, una sola risposta leggera, ripetibile senza duplicati
{
  const sn = call(T1, 'sync').snapshot, ts = sn.tasks.filter(t => t.assignee === 'none').slice(0, 3);
  const oc = ts.map(t => sn.occurrences.find(o => o.taskId === t.id));
  const mk = (o, id) => ({ opId: id, action: 'completeOccurrence', payload: { occurrenceId: o.id, doneBy: 'p1', doneAt: new Date().toISOString(), doneDate: TODAY } });
  const ids = [op(), op(), op()], histBefore = sn.history.length;
  const ops = [mk(oc[0], ids[0]), mk(oc[1], ids[1]), mk(oc[2], ids[2]), { opId: op(), action: 'completeOccurrence', payload: { occurrenceId: 'o_inesistente', doneBy: 'p1', doneDate: TODAY } }];
  const b1 = call(T1, 'batch', { ops });
  assert(b1.ok && !b1.snapshot && b1.rev, 'risposta leggera, senza snapshot');
  assert.deepStrictEqual(b1.results.map(r => r.ok), [true, true, true, false]);
  assert.strictEqual(b1.results[3].code, 'conflict', 'un\'operazione rifiutata non blocca le altre');
  const after = call(T1, 'sync', { rev: '0' }).snapshot;
  assert.strictEqual(after.history.length, histBefore + 3); assert.strictEqual(after.rev, b1.rev);
  const b2 = call(T1, 'batch', { ops: ops.slice(0, 3) }); // risposta persa: il telefono rimanda tutto
  assert(b2.results.every(r => r.ok && r.duplicate), 'ripetizione riconosciuta'); assert.strictEqual(b2.rev, b1.rev, 'nessuna nuova revisione');
  assert.strictEqual(call(T1, 'sync', { rev: '0' }).snapshot.history.length, histBefore + 3, 'nessun doppio completamento');
  assert.strictEqual(call(T1, 'sync', { rev: b1.rev }).unchanged, true);
  assert.strictEqual(call(T2, 'batch', { ops: [{ opId: 'x', action: 'saveTask', payload: {} }] }).results[0].code, 'bad_request');
}
// un token valido funziona anche dopo molti tentativi sbagliati (nessun blocco "a tappeto"); quelli errati sì
for (let i = 0; i < 11; i++) call('sbagliato-' + i, 'sync');
assert.strictEqual(call('sbagliato-x', 'sync').code, 'locked'); assert.strictEqual(call(T2, 'ping').user, 'p2');

// validazione
assert.strictEqual(call(T1, 'saveSetting', { opId: op(), key: 'dayStart', value: '99:99' }).code, 'bad_request');
assert.strictEqual(call(T1, 'saveAvailability', { opId: op(), item: { id: 'a', personId: 'p1', type: 'lavoro', weekdays: '1', start: '10:00', end: '09:00' } }).code, 'bad_request');
console.log('Test backend: tutti superati (' + n + ' operazioni simulate)');
