// Test di fumo del frontend con DOM simulato: percorre tutte le schermate e i pannelli con dati realistici.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const store = {}, listeners = {}, els = {};
const mkEl = id => els[id] || (els[id] = { id, _h: '', style: {}, dataset: {}, classList: { _s: new Set(['hid']), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); } },
  set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, set textContent(v) { this._h = v; }, contains: () => false, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [] });
const document = { querySelector: s => mkEl(s), querySelectorAll: () => [], addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, activeElement: null, hidden: false };
const now = new Date(), pad = n => String(n).padStart(2, '0'), ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const mkT = (id, name, cat, a, f) => ({ id, name, description: '', category: cat, assignee: a, frequency: f, intervalDays: 7, minutes: 30, effort: 3, priority: 'medium', status: 'active', notes: '', checklist: '["uno","due"]', version: 1 });
const snap = { serverTime: now.toISOString(), tasks: [mkT('t1', 'Aspirare', 'Pulizie', 'p2', 'weekly'), mkT('t2', 'Bollette', 'Gestione domestica', 'none', 'monthly'), mkT('t3', "Lavare <b>x</b>", 'Cucina', 'both', 'daily')],
  occurrences: [{ id: 'o1', taskId: 't1', dueDate: add(-2), status: 'open', assignee: '', version: 1 }, { id: 'o2', taskId: 't2', dueDate: add(0), status: 'open', assignee: '', version: 1 }, { id: 'o3', taskId: 't3', dueDate: add(2), status: 'open', assignee: 'p1', version: 1 }],
  history: [1, 2, 3, 4].map(i => ({ id: 'h' + i, taskId: 't1', taskName: 'Aspirare', category: 'Pulizie', frequency: 'weekly', doneBy: i === 4 ? 'both' : 'p2', doneAt: now.toISOString(), doneDate: add(-i), estMinutes: 30, actualMinutes: i % 2 ? 25 : '', effort: 3, notes: '' })),
  people: [{ id: 'p1', name: 'Io', version: 1 }, { id: 'p2', name: 'Paola', version: 1 }],
  availability: [{ id: 'a1', personId: 'p1', type: 'lavoro', weekdays: '1,2,3,4,5', start: '09:00', end: '18:00', dateFrom: '', dateTo: '', label: '', version: 1 }, { id: 'a2', personId: 'p2', type: 'assenza', weekdays: '', start: '', end: '', dateFrom: add(1), dateTo: add(2), label: 'Viaggio', version: 1 }],
  settings: [{ id: 'dailyCapMin', value: '120', version: 1 }] };
store.cfg = JSON.stringify({ url: 'https://script.google.com/macros/s/x/exec', token: 'a'.repeat(40), me: 'p1' }); store.data = JSON.stringify(snap);
const ctx = { document, window: {}, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  fetch: async () => { throw new Error('offline'); }, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, navigator: {}, confirm: () => true, console, Uint8Array, File: class {}, Set, Math, Date };
ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.crypto = { randomUUID: () => require('crypto').randomUUID() };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../src/app.js', 'utf8'), ctx);
const click = (act, id = '', val = '') => listeners.click.forEach(f => f({ target: { closest: () => ({ dataset: { act, id, val }, parentNode: { children: [] }, classList: { add() {} } }) }, stopPropagation() {} }));
const main = () => els['#main']._h, sheet = () => els['#sheet']._h;
['today', 'tasks', 'cal', 'stats', 'settings'].forEach(t => { click('tab', t); assert(main().length > 50, 'vista ' + t); });
assert(main().includes('Io') && !main().includes('<b>x</b>'), 'nomi personalizzati e HTML escapato');
click('tab', 'today'); assert(main().includes('Scadute') && main().includes('Aspirare'));
['stats', 'bal', 'hist'].forEach(v => { click('tab', 'stats'); click('sview', v); ['week', 'month', 'quarter', 'custom'].forEach(r => { click('srange', r); assert(main().length > 100, v + '/' + r); }); });
click('tab', 'cal'); click('propose'); assert(sheet().includes('Proposta'));
['done', 'occ'].forEach(a => { click(a, 'o1'); assert(sheet().includes('Aspirare'), a); });
click('newTask'); assert(sheet().includes('Nuova mansione')); click('task', 't1'); assert(sheet().includes('Modifica mansione'));
click('availNew', 'p1'); assert(sheet().includes('Nuova disponibilità')); click('avail', 'a2'); assert(sheet().includes('Viaggio'));
click('pending'); click('doComplete', 'o1');  // senza segVal: deve avvisare, non crashare
click('tab', 'today'); assert(main().includes('Completate oggi') && main().includes('Vedi tutte le completate'));
click('allDone'); assert(main().includes('data-act="undo"') && main().includes('Hai sbagliato'), 'storico consultabile con Annulla');
const before = (main().match(/data-act="undo"/g) || []).length;
click('undo', 'h1');  // rete assente: la modifica resta in coda e la vista provvisoria la mostra con ⏳, senza dichiararla sincronizzata
setTimeout(() => {
  const after = (main().match(/data-act="undo"/g) || []).length;
  assert.strictEqual(after, before - 1, 'completamento annullato subito in vista provvisoria');
  assert(els['#banner']._h.includes('non ancora confermat'), 'banner modifiche in attesa');
  console.log('Test UI (fumo): tutte le schermate, lo storico con Annulla e la vista provvisoria funzionano');
}, 50);
//console.log('Test UI (fumo): tutte le schermate e i pannelli si generano senza errori');
