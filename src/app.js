/* Casa in Ordine - frontend. Nessuna dipendenza: JavaScript puro. */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + '_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 14) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const r0 = x => Math.round(x), r1 = x => Math.round(x * 10) / 10;
const CATS = ['Bucato', 'Pulizie', 'Cucina', 'Ordine', 'Spesa e scorte', 'Rifiuti', 'Gestione domestica', 'Altro'];
const FREQ = { once: 'Una tantum', daily: 'Ogni giorno', weekly: 'Ogni settimana', biweekly: 'Ogni 2 settimane', monthly: 'Ogni mese', custom: 'Personalizzata' };
const PRIO = { low: 'Bassa', medium: 'Media', high: 'Alta' }, PR = { high: 3, medium: 2, low: 1 };
const DOW = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
const ATYPE = { lavoro: 'Lavoro', impegno: 'Impegno ricorrente', disponibile: 'Fascia disponibile', assenza: 'Giorni di indisponibilità' };

/* ---------- date (stringhe YYYY-MM-DD, ora locale del telefono) ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => ymd(new Date());
const parse = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const weekStart = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
const fmtDay = s => parse(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

/* ---------- stato locale ---------- */
const LS = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* spazio esaurito */ } } };
const S = {
  cfg: LS.get('cfg', { url: '', token: '', me: '' }), data: LS.get('data', null), outbox: LS.get('outbox', []),
  sync: { state: 'idle', last: LS.get('last', null), msg: '' }, tab: 'today', force: false,
  f: { person: 'all', cat: 'all', due: 'all', status: 'active' }, stats: { view: 'stats', range: 'week', from: '', to: '' }, weekOf: weekStart(today())
};
const EMPTY = { tasks: [], occurrences: [], history: [], people: [], availability: [], settings: [] };
let VIEW = null;
/* Dati del server + modifiche ancora in coda applicate in modo PROVVISORIO (con badge "⏳"), così l'app risponde subito.
   Non vengono mai presentate come sincronizzate finché il server non conferma. */
function buildView() {
  const d = S.data || EMPTY, pend = S.outbox.filter(o => o.status === 'pending');
  if (!pend.length) return d;
  const v = Object.assign({}, d, { occurrences: d.occurrences.slice(), history: d.history.slice() });
  pend.forEach(op => {
    const p = op.payload;
    if (op.action === 'completeOccurrence') {
      const o = v.occurrences.find(x => x.id === p.occurrenceId), t = o && d.tasks.find(x => x.id === o.taskId);
      if (o && t) {
        v.occurrences = v.occurrences.filter(x => x !== o);
        if (!v.history.some(h => h.id === 'h_' + op.opId)) v.history.push({ id: 'h_' + op.opId, taskId: t.id, taskName: t.name, category: t.category, frequency: t.frequency, assignee: o.assignee || t.assignee, doneBy: p.doneBy, doneAt: p.doneAt, doneDate: p.doneDate, estMinutes: t.minutes, actualMinutes: p.actualMinutes === '' || p.actualMinutes == null ? '' : Number(p.actualMinutes), effort: t.effort, notes: p.notes || '', pending: true });
      }
    } else if (op.action === 'undoCompletion') v.history = v.history.filter(h => h.id !== p.historyId);
    else if (op.action === 'updateOccurrence') v.occurrences = v.occurrences.map(o => o.id === p.id ? Object.assign({}, o, p.dueDate !== undefined ? { dueDate: p.dueDate } : {}, p.assignee !== undefined ? { assignee: p.assignee } : {}) : o);
  });
  return v;
}
const D = () => VIEW || (VIEW = buildView());
const person = id => id === 'both' ? 'Entrambi' : id === 'none' || !id ? 'Non assegnata' : ((D().people.find(p => p.id === id) || {}).name || (id === 'p1' ? 'Persona 1' : 'Paola'));
const taskOf = id => D().tasks.find(t => t.id === id);
const eff = o => o.assignee || (taskOf(o.taskId) || {}).assignee || 'none';
const setting = (k, d) => { const s = D().settings.find(x => x.id === k); return s ? s.value : d; };
const openOccs = () => D().occurrences.filter(o => o.status === 'open' && taskOf(o.taskId));
const pendingSet = () => new Set(S.outbox.map(o => o.payload.occurrenceId || o.payload.historyId || o.payload.id || (o.payload.task && o.payload.task.id)).filter(Boolean));
const freqLabel = t => t.frequency === 'custom' ? 'Ogni ' + t.intervalDays + ' giorni' : FREQ[t.frequency];
const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>';
const saveBox = () => LS.set('outbox', S.outbox);

/* ---------- rete e sincronizzazione ---------- */
async function api(action, payload, cfg) {
  cfg = cfg || S.cfg;
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 25000);
  let res;
  try {
    // text/plain evita la richiesta "preflight" CORS, che Apps Script non supporta.
    res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: cfg.token, action: action }, payload || {})), signal: ctrl.signal });
  } catch (e) { throw { network: true, message: 'Nessuna connessione o server non raggiungibile.' }; } finally { clearTimeout(timer); }
  let j;
  try { j = await res.json(); } catch (e) { throw { network: true, message: 'Risposta non valida dal server: controlla l\'URL e la pubblicazione dello script.' }; }
  if (!j.ok) throw { code: j.code, message: j.message, snapshot: j.snapshot };
  return j;
}
function setSync(state, msg) { S.sync.state = state; S.sync.msg = msg || ''; render(); }
function applySnap(snap) { S.data = snap; LS.set('data', snap); S.sync.last = new Date().toISOString(); LS.set('last', S.sync.last); S.sync.state = 'ok'; S.sync.msg = ''; }
function enqueue(action, payload, label) {
  const op = { opId: uid('op'), action: action, payload: payload, label: label, status: 'pending', err: '' };
  S.outbox.push(op); saveBox(); render(); flush();
  return op;
}
let flushing = false;
async function flush() {
  if (flushing || !S.cfg.url) return;
  flushing = true;
  try {
    for (const op of S.outbox.slice()) {
      if (op.status === 'conflict') continue;
      try {
        const r = await api(op.action, Object.assign({}, op.payload, { opId: op.opId }));
        S.outbox = S.outbox.filter(x => x !== op); op.err = ''; applySnap(r.snapshot);
      } catch (e) {
        if (e.network) { op.err = e.message; S.sync.state = 'offline'; S.sync.msg = e.message; break; }
        if (e.code === 'auth' || e.code === 'locked' || e.code === 'busy' || e.code === 'not_configured') { op.err = e.message; S.sync.state = 'error'; S.sync.msg = e.message; break; }
        op.status = 'conflict'; op.err = e.message; if (e.snapshot) applySnap(e.snapshot);
      }
    }
  } finally { flushing = false; saveBox(); render(); }
}
async function refresh(force) {
  if (!S.cfg.url || !S.cfg.token) return;
  const full = force || !S.data;
  if (full) setSync('syncing');
  const before = S.sync.last;
  await flush();
  if (S.outbox.some(o => o.status === 'pending')) { render(); return; } // ancora modifiche non confermate: non sovrascrivere la vista
  if (S.sync.last !== before) { render(); return; } // la risposta alle scritture conteneva già i dati aggiornati
  try {
    // Controllo leggero: se la revisione non è cambiata il server risponde subito, senza dati.
    const r = await api('sync', { rev: full ? null : S.data.rev });
    if (r.unchanged) { S.sync.last = new Date().toISOString(); LS.set('last', S.sync.last); S.sync.state = 'ok'; S.sync.msg = ''; } else applySnap(r.snapshot);
  } catch (e) { S.sync.state = e.network ? 'offline' : 'error'; S.sync.msg = e.message; }
  render();
}

/* ---------- disponibilità ---------- */
function freeMin(pid, date) {
  const av = D().availability.filter(a => a.personId === pid), wd = parse(date).getDay();
  if (av.some(a => a.type === 'assenza' && a.dateFrom <= date && date <= (a.dateTo || a.dateFrom))) return { window: 0, cap: 0 };
  const hasDay = a => String(a.weekdays).split(',').filter(Boolean).map(Number).indexOf(wd) >= 0;
  const tm = s => { const p = String(s).split(':').map(Number); return p[0] * 60 + p[1]; };
  const m = new Uint8Array(1440), frees = av.filter(a => a.type === 'disponibile' && hasDay(a));
  if (frees.length) frees.forEach(a => m.fill(1, tm(a.start), tm(a.end))); else m.fill(1, tm(setting('dayStart', '07:00')), tm(setting('dayEnd', '22:00')));
  av.filter(a => (a.type === 'lavoro' || a.type === 'impegno') && hasDay(a)).forEach(a => m.fill(0, tm(a.start), tm(a.end)));
  const w = m.reduce((x, y) => x + y, 0);
  return { window: w, cap: Math.min(w, Number(setting('dailyCapMin', 120))) };
}

/* ---------- UI di base ---------- */
function toast(msg, undoId) { const t = $('#toast'); t.innerHTML = '<span>' + esc(msg) + '</span>' + (undoId ? '<button class="btn sm" data-act="undoNow" data-id="' + esc(undoId) + '">Annulla</button>' : ''); t.classList.remove('hid'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hid'), undoId ? 7000 : 3200); }
function sheet(html) { const s = $('#sheet'); s.innerHTML = '<div class="backdrop" data-act="closeSheet"></div><div class="panel">' + html + '<button class="btn ghost" data-act="closeSheet">Chiudi</button></div>'; s.classList.remove('hid'); }
const closeSheet = () => { $('#sheet').classList.add('hid'); $('#sheet').innerHTML = ''; };
const sheetOpen = () => !$('#sheet').classList.contains('hid');
const val = n => { const el = $('#sheet [name="' + n + '"]'); return el ? el.value.trim() : ''; };
const seg = (name, opts, cur) => '<div class="seg" data-name="' + name + '">' + opts.map(o => '<button type="button" data-act="seg" data-val="' + esc(o[0]) + '" class="' + (String(o[0]) === String(cur) ? 'on' : '') + '">' + esc(o[1]) + '</button>').join('') + '</div>';
const segVal = n => { const b = $('#sheet .seg[data-name="' + n + '"] .on'); return b ? b.dataset.val : null; };
const people3 = () => [['p1', person('p1')], ['p2', person('p2')], ['both', 'Entrambi']];

function chip() {
  const s = S.sync, last = s.last ? fmtTime(s.last) : null;
  if (s.state === 'syncing') return '<span class="chip">⟳ Sincronizzazione…</span>';
  if (s.state === 'offline') return '<button class="chip bad" data-act="refresh">Offline' + (last ? ' · ultimo agg. ' + last : '') + '</button>';
  if (s.state === 'error') return '<button class="chip bad" data-act="refresh">Errore · riprova</button>';
  return '<button class="chip ' + (last ? 'ok' : '') + '" data-act="refresh">' + (last ? '✓ Sincronizzato ' + last : 'Mai sincronizzato') + ' ⟳</button>';
}
let lastMain = '';
function render() {
  VIEW = null;
  const cfgd = S.cfg.url && S.cfg.token, main = $('#main'), ae = document.activeElement;
  const typing = ae && main.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName);
  const titles = { today: 'Oggi', tasks: 'Mansioni', cal: 'Calendario', stats: 'Statistiche', settings: 'Impostazioni' };
  $('#hdr').innerHTML = '<h1>' + (cfgd ? titles[S.tab] : 'Casa in Ordine') + '</h1>' + (cfgd ? chip() : '');
  const bad = S.outbox.filter(o => o.status === 'conflict').length, pend = S.outbox.length - bad;
  $('#banner').innerHTML = S.outbox.length ? '<div class="warn">' + (pend ? '⚠ ' + pend + ' modifica/e non ancora confermata/e dal server. ' : '') + (bad ? bad + ' non applicata/e. ' : '') + '<button class="btn sm" data-act="pending">Dettagli</button></div>' : '';
  $('#nav').style.display = cfgd ? '' : 'none';
  $('#nav').innerHTML = [['today', '✓', 'Oggi'], ['tasks', '☰', 'Mansioni'], ['cal', '▦', 'Calendario'], ['stats', '◔', 'Statistiche'], ['settings', '⚙', 'Impostazioni']]
    .map(t => '<button data-act="tab" data-id="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '"><b>' + t[1] + '</b>' + t[2] + '</button>').join('');
  if (typing && !S.force) return; // non cancellare ciò che l'utente sta scrivendo
  const sc = main.scrollTop;
  main.innerHTML = cfgd ? view() : setupView();
  main.scrollTop = sc;
}
function view() { return ({ today: todayView, tasks: tasksView, cal: calView, stats: statsView, settings: settingsView }[S.tab] || todayView)(); }

/* ---------- Oggi ---------- */
const pm = a => S.f.person === 'all' || a === S.f.person || (a === 'both' && (S.f.person === 'p1' || S.f.person === 'p2'));
function filters(kind) {
  const sel = (k, o) => '<select data-f="' + k + '" aria-label="Filtro ' + k + '">' + o.map(x => opt(x[0], x[1], S.f[k])).join('') + '</select>';
  return '<div class="filters">' + sel('person', [['all', 'Tutti'], ['p1', person('p1')], ['p2', person('p2')], ['none', 'Non assegnate']]) +
    sel('cat', [['all', 'Categorie']].concat(CATS.map(c => [c, c]))) +
    (kind === 'today' ? sel('due', [['all', 'Scadenze'], ['overdue', 'Scadute'], ['today', 'Oggi'], ['week', '7 giorni']]) : kind === 'hist' ? '' : sel('status', [['active', 'Attive'], ['archived', 'Archiviate'], ['all', 'Tutte']])) + '</div>';
}
function occCard(o, pend) {
  const t = taskOf(o.taskId), late = o.dueDate < today();
  return '<div class="card occ ' + (late ? 'late' : '') + '" data-act="occ" data-id="' + o.id + '"><div class="grow"><b>' + esc(t.name) + '</b><div class="meta">' + esc(t.category) + ' · ' + esc(person(eff(o))) + ' · ' + t.minutes + ' min · ' + (late ? 'scaduta, ' : '') + fmtDay(o.dueDate) + '</div>' +
    (pend.has(o.id) ? '<span class="badge">⏳ in attesa di conferma</span>' : '') + '</div><button class="done" data-act="done" data-id="' + o.id + '" aria-label="Completa">✓</button></div>';
}
function weekSummary() {
  const ws = weekStart(today()), a = agg(hist(ws, addD(ws, 6))), left = openOccs().filter(o => o.dueDate <= addD(ws, 6)).length;
  return '<div class="card"><h3>Questa settimana</h3><div class="row2">' + ['p1', 'p2'].map(p => '<div class="pill"><b>' + esc(person(p)) + '</b><br>' + r1(a[p].n) + ' completate · ' + r0(a[p].est) + ' min</div>').join('') + '</div><div class="meta" style="margin-top:8px">Ancora da fare entro domenica: ' + left + '</div></div>';
}
function todayView() {
  const t = today(), pend = pendingSet();
  const L = openOccs().filter(o => pm(eff(o)) && (S.f.cat === 'all' || taskOf(o.taskId).category === S.f.cat));
  const by = (a, b) => a.dueDate.localeCompare(b.dueDate) || PR[taskOf(b.taskId).priority] - PR[taskOf(a.taskId).priority];
  const show = k => S.f.due === 'all' || S.f.due === k;
  const sec = (title, arr, k) => show(k) && arr.length ? '<h3>' + title + ' (' + arr.length + ')</h3>' + arr.sort(by).map(o => occCard(o, pend)).join('') : '';
  const html = sec('Scadute', L.filter(o => o.dueDate < t), 'overdue') + sec('Oggi', L.filter(o => o.dueDate === t), 'today') + sec('Prossime scadenze', L.filter(o => o.dueDate > t && o.dueDate <= addD(t, 7)), 'week');
  return weekSummary() + filters('today') + (html || '<p class="empty">Nessuna mansione da mostrare con questi filtri.</p>') + doneToday();
}
function histCard(h) {
  const min = h.actualMinutes !== '' && h.actualMinutes != null ? h.actualMinutes + ' min effettivi' : h.estMinutes + ' min stimati';
  return '<div class="card occ"><div class="grow"><b>✓ ' + esc(h.taskName) + '</b><div class="meta">' + esc(h.category) + ' · ' + esc(person(h.doneBy)) + ' · ' + fmtDay(h.doneDate) + ' ' + fmtTime(h.doneAt) + ' · ' + min + (h.notes ? ' · ' + esc(h.notes) : '') + '</div>' +
    (h.pending ? '<span class="badge">⏳ in attesa di conferma</span>' : '') + '</div><button class="btn sm" data-act="undo" data-id="' + esc(h.id) + '">Annulla</button></div>';
}
function doneToday() {
  const t = today(), L = D().history.filter(h => h.doneDate === t).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  return '<h3>Completate oggi (' + L.length + ')</h3>' + (L.map(histCard).join('') || '<p class="meta">Ancora nessuna.</p>') + '<button class="btn" data-act="allDone">Vedi tutte le completate</button>';
}
function completeSheet(id) {
  const o = D().occurrences.find(x => x.id === id); if (!o) return; const t = taskOf(o.taskId);
  let cl = []; try { cl = JSON.parse(t.checklist || '[]'); } catch (e) { /* ignora */ }
  const a = eff(o), pre = a === 'p1' || a === 'p2' || a === 'both' ? (a === 'both' ? S.cfg.me : a) : S.cfg.me;
  sheet('<h2>' + esc(t.name) + '</h2>' + (cl.length ? '<div class="card">' + cl.map(x => '<label class="chk" style="display:flex"><input type="checkbox">' + esc(x) + '</label>').join('') + '</div>' : '') +
    '<div class="lbl">Chi l\'ha fatta?</div>' + seg('doneBy', people3(), pre) +
    '<label>Minuti effettivi (facoltativo, stimati: ' + t.minutes + ')<input name="actual" type="number" inputmode="numeric" min="0" max="1440"></label>' +
    '<label>Note (facoltative)<textarea name="notes" rows="2"></textarea></label>' +
    '<button class="btn primary" data-act="doComplete" data-id="' + id + '">Conferma completata</button>');
}

/* ---------- Mansioni ---------- */
function tasksView() {
  const opens = openOccs(), pend = pendingSet();
  const L = D().tasks.filter(t => (S.f.status === 'all' || t.status === S.f.status) && (S.f.cat === 'all' || t.category === S.f.cat) && pm(t.assignee)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return filters('tasks') + (L.map(t => { const o = opens.find(x => x.taskId === t.id);
    return '<div class="card" data-act="task" data-id="' + t.id + '"><b>' + esc(t.name) + '</b> ' + (t.status === 'archived' ? '<span class="badge">archiviata</span>' : '') + (pend.has(t.id) ? '<span class="badge">⏳</span>' : '') +
      '<div class="meta">' + esc(t.category) + ' · ' + esc(person(t.assignee)) + ' · ' + esc(freqLabel(t)) + ' · ' + t.minutes + ' min · impegno ' + t.effort + '/5 · ' + (o ? 'scade ' + fmtDay(o.dueDate) : 'nessuna scadenza') + '</div></div>'; }).join('') || '<p class="empty">Nessuna mansione.</p>') +
    '<button class="fab" data-act="newTask" aria-label="Nuova mansione">＋</button>';
}
function taskSheet(id) {
  const t = id ? taskOf(id) : null, occ = t ? openOccs().find(o => o.taskId === t.id) : null;
  const x = t || { name: '', description: '', category: 'Pulizie', assignee: 'none', frequency: 'once', intervalDays: 7, minutes: 15, effort: 2, priority: 'medium', status: 'active', notes: '', checklist: '[]' };
  let cl = []; try { cl = JSON.parse(x.checklist || '[]'); } catch (e) { /* ignora */ }
  sheet('<h2>' + (t ? 'Modifica mansione' : 'Nuova mansione') + '</h2>' +
    '<label>Nome<input name="name" value="' + esc(x.name) + '" maxlength="120"></label>' +
    '<label>Descrizione<textarea name="description" rows="2">' + esc(x.description) + '</textarea></label>' +
    '<label>Categoria<select name="category">' + CATS.map(c => opt(c, c, x.category)).join('') + '</select></label>' +
    '<div class="lbl">Responsabile abituale</div>' + seg('assignee', people3().concat([['none', 'Nessuno']]), x.assignee) +
    '<label>Frequenza<select name="frequency">' + Object.keys(FREQ).map(k => opt(k, FREQ[k], x.frequency)).join('') + '</select></label>' +
    '<label id="intervalRow" class="' + (x.frequency === 'custom' ? '' : 'hid') + '">Ogni quanti giorni<input name="intervalDays" type="number" min="1" max="365" value="' + (x.intervalDays || 7) + '"></label>' +
    '<label>Prossima scadenza<input name="dueDate" type="date" value="' + (occ ? occ.dueDate : today()) + '"></label>' +
    '<div class="row2"><label>Durata stimata (min)<input name="minutes" type="number" inputmode="numeric" min="0" max="1440" value="' + x.minutes + '"></label>' +
    '<label>Impegno percepito<select name="effort">' + [1, 2, 3, 4, 5].map(n => opt(n, n + ' / 5', x.effort)).join('') + '</select></label></div>' +
    '<label>Priorità<select name="priority">' + Object.keys(PRIO).map(k => opt(k, PRIO[k], x.priority)).join('') + '</select></label>' +
    '<label>Note<textarea name="notes" rows="2">' + esc(x.notes) + '</textarea></label>' +
    '<label>Checklist (una voce per riga)<textarea name="checklist" rows="3">' + esc(cl.join('\n')) + '</textarea></label>' +
    '<button class="btn primary" data-act="saveTask" data-id="' + (t ? t.id : '') + '">Salva</button>' +
    (t ? '<div class="row2"><button class="btn" data-act="archiveTask" data-id="' + t.id + '">' + (t.status === 'active' ? 'Archivia' : 'Ripristina') + '</button><button class="btn danger" data-act="deleteTask" data-id="' + t.id + '">Elimina</button></div>' : ''));
}
function occSheet(id) {
  const o = D().occurrences.find(x => x.id === id); if (!o) return; const t = taskOf(o.taskId);
  sheet('<h2>' + esc(t.name) + '</h2><p class="meta">' + esc(t.category) + ' · ' + t.minutes + ' min · ' + esc(freqLabel(t)) + '</p>' +
    '<label>Scadenza<input name="due" type="date" value="' + o.dueDate + '"></label>' +
    '<div class="lbl">Responsabile per questa volta</div>' + seg('oassignee', [['', 'Abituale (' + person(t.assignee) + ')']].concat(people3()), o.assignee || '') +
    '<button class="btn primary" data-act="saveOcc" data-id="' + id + '">Salva</button>' +
    '<div class="row2"><button class="btn" data-act="postpone" data-id="' + id + '">Rimanda di 1 giorno</button><button class="btn" data-act="done" data-id="' + id + '">Completa</button></div>' +
    '<button class="btn" data-act="task" data-id="' + t.id + '">Modifica mansione</button>');
}

/* ---------- Calendario ---------- */
function calView() {
  const ws = S.weekOf, t = today(), pend = pendingSet(), opens = openOccs();
  let html = '<div class="row2"><button class="btn" data-act="weekPrev">‹ Prec.</button><button class="btn" data-act="weekNext">Succ. ›</button></div><button class="btn" data-act="weekNow">Questa settimana</button>' +
    '<button class="btn" data-act="propose">Proponi distribuzione (facoltativa)</button>';
  for (let i = 0; i < 7; i++) {
    const d = addD(ws, i), items = opens.filter(o => o.dueDate === d);
    const load = { p1: 0, p2: 0, none: 0 }; items.forEach(o => { const a = eff(o), m = taskOf(o.taskId).minutes; if (a === 'both') { load.p1 += m / 2; load.p2 += m / 2; } else if (a === 'p1' || a === 'p2') load[a] += m; else load.none += m; });
    const over = ['p1', 'p2'].some(p => load[p] > freeMin(p, d).cap);
    html += '<div class="card day ' + (d === t ? 'today' : '') + (over ? ' over' : '') + '"><b>' + fmtDay(d) + '</b>' + (over ? ' <span class="badge" style="background:var(--warnl);color:var(--warn)">giornata carica</span>' : '') +
      '<div class="meta">' + ['p1', 'p2'].map(p => esc(person(p)) + ' ' + r0(load[p]) + '/' + freeMin(p, d).cap + ' min').join(' · ') + (load.none ? ' · da assegnare ' + r0(load.none) + ' min' : '') + '</div>' +
      items.map(o => '<div class="it" data-act="occ" data-id="' + o.id + '"><span>' + esc(taskOf(o.taskId).name) + (pend.has(o.id) ? ' ⏳' : '') + '</span><span class="meta">' + esc(person(eff(o))) + ' · ' + taskOf(o.taskId).minutes + '′</span></div>').join('') + '</div>';
  }
  return html + '<p class="note">Il carico è confrontato con i minuti disponibili al giorno (disponibilità dichiarata, con il tetto giornaliero impostato in Impostazioni). Sono indicazioni, non obblighi.</p>';
}
let proposal = [];
function proposeSheet() {
  const ws = S.weekOf, we = addD(ws, 6), opens = openOccs();
  const load = {}; const key = (p, d) => p + d;
  opens.forEach(o => { const a = eff(o), m = taskOf(o.taskId).minutes; if (a === 'p1' || a === 'p2') load[key(a, o.dueDate)] = (load[key(a, o.dueDate)] || 0) + m; if (a === 'both') ['p1', 'p2'].forEach(p => { load[key(p, o.dueDate)] = (load[key(p, o.dueDate)] || 0) + m / 2; }); });
  proposal = [];
  opens.filter(o => eff(o) === 'none' && o.dueDate >= ws && o.dueDate <= we).sort((a, b) => taskOf(b.taskId).minutes - taskOf(a.taskId).minutes).forEach(o => {
    const m = taskOf(o.taskId).minutes; let best = null, bs = 1e9;
    ['p1', 'p2'].forEach(p => { const cap = freeMin(p, o.dueDate).cap; if (cap <= 0) return; const sc = ((load[key(p, o.dueDate)] || 0) + m) / cap; if (sc < bs) { bs = sc; best = p; } });
    if (best) { load[key(best, o.dueDate)] = (load[key(best, o.dueDate)] || 0) + m; proposal.push({ id: o.id, version: o.version, to: best, name: taskOf(o.taskId).name, date: o.dueDate }); }
  });
  sheet('<h2>Proposta di distribuzione</h2><p class="meta">Riguarda solo le attività non assegnate della settimana. Nulla cambia finché non confermi.</p>' +
    (proposal.length ? proposal.map((p, i) => '<label class="chk" style="display:flex"><input type="checkbox" data-i="' + i + '" checked>' + esc(p.name) + ' (' + fmtDay(p.date) + ') → <b>&nbsp;' + esc(person(p.to)) + '</b></label>').join('') + '<button class="btn primary" data-act="applyProposal">Applica le selezionate</button>' : '<p>Nessuna attività da assegnare (o nessuna disponibilità nei giorni interessati).</p>'));
}

/* ---------- Statistiche ---------- */
function range() {
  const t = today(), r = S.stats.range, d = parse(t);
  if (r === 'week') { const s = weekStart(t); return [s, addD(s, 6)]; }
  if (r === 'month') return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  if (r === 'quarter') { const q = Math.floor(d.getMonth() / 3) * 3; return [ymd(new Date(d.getFullYear(), q, 1)), ymd(new Date(d.getFullYear(), q + 3, 0))]; }
  return [S.stats.from || addD(t, -30), S.stats.to || t];
}
function hist(from, to) { const seen = new Set(); return D().history.filter(h => { if (seen.has(h.id)) return false; seen.add(h.id); return h.doneDate >= from && h.doneDate <= to; }); } // un'attività non viene mai contata due volte
const shares = h => h.doneBy === 'both' ? { p1: .5, p2: .5 } : (h.doneBy === 'p1' || h.doneBy === 'p2') ? { [h.doneBy]: 1 } : {};
const loadMin = h => h.actualMinutes !== '' && h.actualMinutes != null ? h.actualMinutes : h.estMinutes;
function agg(list) {
  const blank = () => ({ n: 0, est: 0, act: 0, nAct: 0, eff: 0, load: 0 }), r = { p1: blank(), p2: blank() };
  list.forEach(h => { const sh = shares(h); Object.keys(sh).forEach(p => { const w = sh[p], a = r[p]; a.n += w; a.est += w * h.estMinutes; a.eff += w * h.effort; a.load += w * loadMin(h); if (h.actualMinutes !== '' && h.actualMinutes != null) { a.act += w * h.actualMinutes; a.nAct += w; } }); });
  return r;
}
const split = (a, b) => { const t = a + b; return '<div class="bar">' + (t ? '<i style="width:' + (a / t * 100) + '%;background:var(--p1)"></i><i style="width:' + (b / t * 100) + '%;background:var(--p2)"></i>' : '') + '</div>'; };
const legend = () => '<div class="legend"><span><i style="background:var(--p1)"></i>' + esc(person('p1')) + '</span><span><i style="background:var(--p2)"></i>' + esc(person('p2')) + '</span></div>';
function byTask(list) { const m = {}; list.forEach(h => { const k = h.taskId || h.taskName; m[k] = m[k] || { name: h.taskName, p1: 0, p2: 0 }; const sh = shares(h); Object.keys(sh).forEach(p => { m[k][p] += sh[p]; }); }); return Object.keys(m).map(k => m[k]); }
function statsView() {
  const tabs = '<div class="seg big">' + [['stats', 'Statistiche'], ['bal', 'Equilibrio'], ['hist', 'Storico']].map(x => '<button class="' + (S.stats.view === x[0] ? 'on' : '') + '" data-act="sview" data-id="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  if (S.stats.view === 'hist') return tabs + histView();
  const rg = range(), bar = '<div class="seg">' + [['week', 'Settimana'], ['month', 'Mese'], ['quarter', 'Trimestre'], ['custom', 'Personalizzato']].map(x => '<button class="' + (S.stats.range === x[0] ? 'on' : '') + '" data-act="srange" data-id="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' +
    (S.stats.range === 'custom' ? '<div class="row2"><input type="date" data-s="from" value="' + rg[0] + '"><input type="date" data-s="to" value="' + rg[1] + '"></div>' : '') + '<div class="meta">Dal ' + fmtDay(rg[0]) + ' al ' + fmtDay(rg[1]) + '</div>';
  return tabs + bar + (S.stats.view === 'bal' ? balView(rg[0], rg[1]) : statsBody(rg[0], rg[1]));
}
function statsBody(from, to) {
  const h = hist(from, to), a = agg(h), P = ['p1', 'p2'], row = (l, f) => '<tr><td>' + l + '</td>' + P.map(p => '<td>' + f(a[p]) + '</td>').join('') + '</tr>';
  let out = '<div class="card"><h3>Per persona</h3><table><tr><th></th>' + P.map(p => '<th>' + esc(person(p)) + '</th>').join('') + '</tr>' +
    row('Attività completate', x => r1(x.n)) + row('Minuti stimati', x => r0(x.est)) + row('Minuti effettivi', x => x.nAct ? r0(x.act) + ' (su ' + r1(x.nAct) + ' att.)' : '–') + row('Impegno percepito medio', x => x.n ? r1(x.eff / x.n) + ' / 5' : '–') + '</table>' +
    '<p class="meta">Quantità, durata e impegno sono mostrati separatamente: non vengono sommati in un punteggio. Le attività svolte "insieme" contano metà a testa.</p></div>';
  const cats = Array.from(new Set(h.map(x => x.category)));
  out += '<div class="card"><h3>Per categoria (minuti stimati)</h3>' + legend() + (cats.map(c => { const ca = agg(h.filter(x => x.category === c)); return '<div class="crow"><div>' + esc(c) + '</div>' + split(ca.p1.est, ca.p2.est) + '<div class="meta">' + r0(ca.p1.est) + ' / ' + r0(ca.p2.est) + ' min · ' + r1(ca.p1.n) + ' / ' + r1(ca.p2.n) + ' att.</div></div>'; }).join('') || '<p class="meta">Nessun completamento nel periodo.</p>') + '</div>';
  const tk = byTask(h).sort((x, y) => (y.p1 + y.p2) - (x.p1 + x.p2)).slice(0, 15);
  out += '<div class="card"><h3>Singole mansioni</h3><table><tr><th></th><th>' + esc(person('p1')) + '</th><th>' + esc(person('p2')) + '</th></tr>' + tk.map(x => '<tr><td>' + esc(x.name) + '</td><td>' + r1(x.p1) + '</td><td>' + r1(x.p2) + '</td></tr>').join('') + '</table></div>';
  const rec = agg(h.filter(x => x.frequency !== 'once')), org = agg(h.filter(x => x.category === 'Gestione domestica'));
  out += '<div class="card"><h3>Ricorrenti e organizzazione</h3><table><tr><th></th>' + P.map(p => '<th>' + esc(person(p)) + '</th>').join('') + '</tr><tr><td>Attività ricorrenti svolte</td>' + P.map(p => '<td>' + r1(rec[p].n) + '</td>').join('') + '</tr><tr><td>Gestione domestica / pianificazione</td>' + P.map(p => '<td>' + r1(org[p].n) + ' att. · ' + r0(org[p].est) + ' min</td>').join('') + '</tr></table></div>';
  const od = openOccs().filter(o => o.dueDate < today()), cnt = k => od.filter(o => eff(o) === k).length;
  out += '<div class="card"><h3>Arretrati (adesso)</h3><div class="meta">' + esc(person('p1')) + ': ' + cnt('p1') + ' · ' + esc(person('p2')) + ': ' + cnt('p2') + ' · Entrambi: ' + cnt('both') + ' · Non assegnate: ' + cnt('none') + '</div></div>';
  let tr = '<div class="card"><h3>Andamento (ultime 8 settimane, minuti stimati)</h3>' + legend(); const w0 = weekStart(today());
  for (let i = 7; i >= 0; i--) { const ws = addD(w0, -7 * i), x = agg(hist(ws, addD(ws, 6))); tr += '<div class="trow"><span>' + parse(ws).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) + '</span>' + split(x.p1.est, x.p2.est) + '<span>' + r0(x.p1.est) + '/' + r0(x.p2.est) + '</span></div>'; }
  return out + tr + '</div>';
}
function balView(from, to) {
  const t = today(), end = to < t ? to : t, h = hist(from, to), a = agg(h);
  let av = { p1: 0, p2: 0 }; for (let d = from, g = 0; d <= end && g < 400; d = addD(d, 1), g++) { av.p1 += freeMin('p1', d).window; av.p2 += freeMin('p2', d).window; }
  const ld = a.p1.load + a.p2.load, avt = av.p1 + av.p2, pc = (x, tot) => tot ? r0(x / tot * 100) : 0;
  let out = '<div class="card"><h3>Carico effettivo e disponibilità dichiarata</h3>' + legend() + '<div class="meta">Carico svolto (minuti effettivi, o stimati se mancanti)</div>' + split(a.p1.load, a.p2.load) + '<div class="meta">' + esc(person('p1')) + ' ' + r0(a.p1.load) + ' min (' + pc(a.p1.load, ld) + '%) · ' + esc(person('p2')) + ' ' + r0(a.p2.load) + ' min (' + pc(a.p2.load, ld) + '%)</div>' +
    '<div class="meta" style="margin-top:10px">Disponibilità dichiarata (minuti liberi nel periodo)</div>' + split(av.p1, av.p2) + '<div class="meta">' + esc(person('p1')) + ' ' + r0(av.p1) + ' min (' + pc(av.p1, avt) + '%) · ' + esc(person('p2')) + ' ' + r0(av.p2) + ' min (' + pc(av.p2, avt) + '%)</div>' +
    '<p class="note">Non esiste una ripartizione "giusta" a priori: la disponibilità dichiarata è solo un punto di riferimento. Le differenze sono spunti per parlarne, non giudizi.</p></div>';
  const conc = []; Array.from(new Set(h.map(x => x.category))).forEach(c => { const ca = agg(h.filter(x => x.category === c)), tot = ca.p1.load + ca.p2.load; if (tot >= 60) { const m = Math.max(ca.p1.load, ca.p2.load) / tot; if (m >= .7) conc.push(esc(c) + ': ' + r0(m * 100) + '% svolto da ' + esc(person(ca.p1.load >= ca.p2.load ? 'p1' : 'p2'))); } });
  const same = byTask(h).filter(x => { const tt = x.p1 + x.p2; return tt >= 3 && Math.max(x.p1, x.p2) / tt >= .8; }).map(x => esc(x.name) + ' → quasi sempre ' + esc(person(x.p1 >= x.p2 ? 'p1' : 'p2')));
  out += '<div class="card"><h3>Categorie più concentrate</h3>' + (conc.length ? '<ul>' + conc.map(c => '<li>' + c + '</li>').join('') + '</ul>' : '<p class="meta">Nessuna categoria sbilanciata nel periodo (soglia: 70% con almeno 60 minuti).</p>') + '</div>' +
    '<div class="card"><h3>Mansioni svolte quasi sempre dalla stessa persona</h3>' + (same.length ? '<ul>' + same.map(c => '<li>' + c + '</li>').join('') + '</ul>' : '<p class="meta">Nessuna (soglia: 80% con almeno 3 volte).</p>') + '</div>' +
    '<div class="card"><h3>Impegno percepito medio</h3><div class="meta">' + esc(person('p1')) + ': ' + (a.p1.n ? r1(a.p1.eff / a.p1.n) : '–') + ' · ' + esc(person('p2')) + ': ' + (a.p2.n ? r1(a.p2.eff / a.p2.n) : '–') + '</div></div>';
  return out;
}
function histView() {
  const all = D().history.filter(h => pm(h.doneBy) && (S.f.cat === 'all' || h.category === S.f.cat)).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  return filters('hist') + '<button class="btn" data-act="exportCsv">Esporta CSV (condividi o copia)</button>' + (all.slice(0, 150).map(histCard).join('') || '<p class="empty">Nessun completamento con questi filtri.</p>') +
    (all.length > 150 ? '<p class="meta">Mostrati gli ultimi 150 di ' + all.length + '; il CSV contiene tutto.</p>' : '') + '<p class="meta">Hai sbagliato a completare? Tocca "Annulla": l\'attività torna da fare e sparisce dalle statistiche.</p>';
}
function csv() {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"', H = ['id', 'mansione', 'categoria', 'svolta_da', 'data', 'ora', 'minuti_stimati', 'minuti_effettivi', 'impegno_1_5', 'note'];
  return '\uFEFF' + H.join(';') + '\n' + D().history.map(h => [h.id, h.taskName, h.category, person(h.doneBy), h.doneDate, fmtTime(h.doneAt), h.estMinutes, h.actualMinutes, h.effort, h.notes].map(q).join(';')).join('\n');
}

/* ---------- Impostazioni ---------- */
function connForm() {
  return '<div class="card"><h3>Connessione</h3><label>URL dell\'app web (termina con /exec)<input name="url" value="' + esc(S.cfg.url) + '" autocapitalize="off" autocomplete="off"></label>' +
    '<label>Token personale<input name="token" type="password" value="' + esc(S.cfg.token) + '" autocapitalize="off" autocomplete="off"></label>' +
    '<button class="btn primary" data-act="saveConn">Salva e verifica</button></div>';
}
function setupView() {
  return '<p>Benvenuto! Prima di iniziare inserisci l\'URL dell\'app web Google Apps Script e il tuo token personale (vedi README, passi 2-3). Restano solo su questo telefono.</p>' + connForm();
}
function settingsView() {
  const av = p => D().availability.filter(a => a.personId === p).map(a => '<div class="card" data-act="avail" data-id="' + a.id + '"><b>' + esc(a.label || ATYPE[a.type]) + '</b><div class="meta">' + ATYPE[a.type] + ' · ' +
    (a.type === 'assenza' ? fmtDay(a.dateFrom) + ' → ' + fmtDay(a.dateTo || a.dateFrom) : String(a.weekdays).split(',').map(d => DOW[d]).join(' ') + ' ' + a.start + '–' + a.end) + '</div></div>').join('');
  return '<div class="card"><h3>Stato</h3><div class="meta">Connesso come: <b>' + esc(person(S.cfg.me)) + '</b> (identità verificata dal server)</div></div>' + connForm() +
    '<div class="card"><h3>Persone</h3><label>Persona 1<input name="n1" value="' + esc(person('p1')) + '" maxlength="40"></label><label>Persona 2<input name="n2" value="' + esc(person('p2')) + '" maxlength="40"></label><button class="btn" data-act="savePeople">Salva nomi</button></div>' +
    '<div class="card"><h3>Orari generali</h3><div class="row2"><label>Inizio giornata<input name="dayStart" type="time" value="' + esc(setting('dayStart', '07:00')) + '"></label><label>Fine giornata<input name="dayEnd" type="time" value="' + esc(setting('dayEnd', '22:00')) + '"></label></div>' +
    '<label>Tetto giornaliero di tempo per la casa (minuti)<input name="cap" type="number" min="0" max="1440" value="' + esc(setting('dailyCapMin', 120)) + '"></label><button class="btn" data-act="saveGeneral">Salva</button></div>' +
    '<h3>Disponibilità e lavoro</h3><p class="meta">Essere a casa non significa essere liberi: inserisci orari di lavoro, impegni ricorrenti, fasce libere e giorni di indisponibilità.</p>' +
    ['p1', 'p2'].map(p => '<div class="meta"><b>' + esc(person(p)) + '</b></div>' + av(p) + '<button class="btn sm" data-act="availNew" data-id="' + p + '">+ Aggiungi per ' + esc(person(p)) + '</button>').join('<br><br>') +
    '<h3>Dati e dispositivo</h3><button class="btn" data-act="refresh">Aggiorna ora</button><button class="btn danger" data-act="logout">Rimuovi configurazione da questo telefono</button><p class="meta">Versione 1.1.0 · controllo automatico ogni 20 secondi quando l\'app è aperta.</p>';
}
function availSheet(id, pid) {
  const a = id ? D().availability.find(x => x.id === id) : { personId: pid || 'p1', type: 'lavoro', weekdays: '1,2,3,4,5', start: '09:00', end: '18:00', dateFrom: today(), dateTo: today(), label: '' };
  if (!a) return; const days = String(a.weekdays).split(','), ab = a.type === 'assenza';
  sheet('<h2>' + (id ? 'Modifica' : 'Nuova') + ' disponibilità</h2><div class="lbl">Persona</div>' + seg('person', [['p1', person('p1')], ['p2', person('p2')]], a.personId) +
    '<label>Tipo<select name="type">' + Object.keys(ATYPE).map(k => opt(k, ATYPE[k], a.type)).join('') + '</select></label>' +
    '<div id="wdRow" class="' + (ab ? 'hid' : '') + '"><div class="lbl">Giorni</div>' + [1, 2, 3, 4, 5, 6, 0].map(d => '<label class="chk"><input type="checkbox" name="wd" value="' + d + '"' + (days.indexOf(String(d)) >= 0 ? ' checked' : '') + '>' + DOW[d] + '</label>').join('') +
    '<div class="row2"><label>Dalle<input name="start" type="time" value="' + esc(a.start) + '"></label><label>Alle<input name="end" type="time" value="' + esc(a.end) + '"></label></div></div>' +
    '<div id="dateRow" class="row2 ' + (ab ? '' : 'hid') + '"><label>Dal<input name="dateFrom" type="date" value="' + esc(a.dateFrom || today()) + '"></label><label>Al<input name="dateTo" type="date" value="' + esc(a.dateTo || today()) + '"></label></div>' +
    '<label>Etichetta (facoltativa)<input name="label" value="' + esc(a.label) + '" maxlength="60"></label><button class="btn primary" data-act="saveAvail" data-id="' + (id || '') + '">Salva</button>' + (id ? '<button class="btn danger" data-act="delAvail" data-id="' + id + '">Elimina</button>' : ''));
}
function pendingSheet() {
  sheet('<h2>Modifiche in sospeso</h2>' + (S.outbox.map((o, i) => '<div class="card"><b>' + esc(o.label) + '</b><div class="meta">' + (o.status === 'conflict' ? 'Non applicata: ' + esc(o.err) : 'In attesa di conferma dal server' + (o.err ? ' (' + esc(o.err) + ')' : '')) + '</div><button class="btn sm" data-act="discard" data-id="' + i + '">Scarta</button></div>').join('') || '<p>Nessuna.</p>') +
    '<p class="meta">Una modifica compare come sincronizzata solo dopo la conferma del server. Se resta in attesa, controlla la connessione e riprova.</p><button class="btn primary" data-act="retry">Riprova ora</button>');
}

/* ---------- azioni ---------- */
const ACT = {
  tab(el, id) { S.tab = id; render(); $('#main').scrollTop = 0; },
  refresh() { refresh(true); },
  done(el, id, e) { e.stopPropagation(); completeSheet(id); },
  occ(el, id) { occSheet(id); },
  seg(el) { Array.from(el.parentNode.children).forEach(b => b.classList.remove('on')); el.classList.add('on'); },
  closeSheet() { closeSheet(); },
  doComplete(el, id) {
    const o = D().occurrences.find(x => x.id === id), t = o && taskOf(o.taskId); if (!t) return closeSheet();
    const by = segVal('doneBy'); if (!by) return toast('Scegli chi l\'ha fatta.');
    const op = enqueue('completeOccurrence', { occurrenceId: id, doneBy: by, doneAt: new Date().toISOString(), doneDate: today(), actualMinutes: val('actual'), notes: val('notes') }, 'Completa «' + t.name + '»');
    closeSheet(); toast('Completata ✓', 'h_' + op.opId);
  },
  newTask() { taskSheet(); }, task(el, id) { taskSheet(id); },
  saveTask(el, id) {
    const old = id ? taskOf(id) : null, name = val('name'); if (!name) return toast('Inserisci un nome.');
    const lines = val('checklist').split('\n').map(s => s.trim()).filter(Boolean);
    const task = { id: old ? old.id : uid('t'), name: name, description: val('description'), category: val('category'), assignee: segVal('assignee') || 'none', frequency: val('frequency'), intervalDays: Number(val('intervalDays')) || 7, minutes: Number(val('minutes')) || 0, effort: Number(val('effort')) || 1, priority: val('priority'), status: old ? old.status : 'active', notes: val('notes'), checklist: JSON.stringify(lines), baseVersion: old ? old.version : 0 };
    enqueue('saveTask', { task: task, dueDate: val('dueDate') }, 'Salva «' + name + '»'); closeSheet();
  },
  archiveTask(el, id) {
    const t = taskOf(id); const task = Object.assign({}, t, { status: t.status === 'active' ? 'archived' : 'active', baseVersion: t.version });
    enqueue('saveTask', { task: task, dueDate: today() }, (t.status === 'active' ? 'Archivia' : 'Ripristina') + ' «' + t.name + '»'); closeSheet();
  },
  deleteTask(el, id) {
    const t = taskOf(id); if (!confirm('Eliminare «' + t.name + '»? Lo storico dei completamenti resta consultabile.')) return;
    enqueue('deleteTask', { id: id, baseVersion: t.version }, 'Elimina «' + t.name + '»'); closeSheet();
  },
  saveOcc(el, id) {
    const o = D().occurrences.find(x => x.id === id), d = val('due'); if (!o || !d) return;
    enqueue('updateOccurrence', { id: id, baseVersion: o.version, dueDate: d, assignee: segVal('oassignee') || '' }, 'Modifica «' + taskOf(o.taskId).name + '»'); closeSheet();
  },
  postpone(el, id) {
    const o = D().occurrences.find(x => x.id === id); if (!o) return;
    enqueue('updateOccurrence', { id: id, baseVersion: o.version, dueDate: addD(o.dueDate > today() ? o.dueDate : today(), 1) }, 'Rimanda «' + taskOf(o.taskId).name + '»'); closeSheet();
  },
  weekPrev() { S.weekOf = addD(S.weekOf, -7); render(); }, weekNext() { S.weekOf = addD(S.weekOf, 7); render(); }, weekNow() { S.weekOf = weekStart(today()); render(); },
  propose() { proposeSheet(); },
  applyProposal() {
    const boxes = Array.from(document.querySelectorAll('#sheet input[data-i]:checked')); if (!boxes.length) return closeSheet();
    boxes.forEach(b => { const p = proposal[Number(b.dataset.i)]; S.outbox.push({ opId: uid('op'), action: 'updateOccurrence', payload: { id: p.id, baseVersion: p.version, assignee: p.to }, label: 'Assegna «' + p.name + '» a ' + person(p.to), status: 'pending', err: '' }); });
    saveBox(); closeSheet(); render(); flush();
  },
  allDone() { S.tab = 'stats'; S.stats.view = 'hist'; render(); $('#main').scrollTop = 0; },
  undo(el, id) { const h = D().history.find(x => x.id === id); if (!h) return; if (!confirm('Annullare il completamento di «' + h.taskName + '»? L\'attività tornerà da fare e sparirà dalle statistiche.')) return; enqueue('undoCompletion', { historyId: id }, 'Annulla completamento «' + h.taskName + '»'); },
  undoNow(el, id) { const h = D().history.find(x => x.id === id); $('#toast').classList.add('hid'); if (h) enqueue('undoCompletion', { historyId: id }, 'Annulla completamento «' + h.taskName + '»'); },
  sview(el, id) { S.stats.view = id; render(); }, srange(el, id) { S.stats.range = id; render(); },
  async exportCsv() {
    const text = csv(), file = new File([text], 'casa-in-ordine-storico.csv', { type: 'text/csv' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Storico Casa in Ordine' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('CSV copiato negli appunti.'); } catch (e) { toast('Impossibile condividere: scarica il CSV dal Google Sheet (foglio Storico).'); }
  },
  async saveConn() {
    const url = val0('url'), token = val0('token');
    if (!/^https:\/\/script\.google\.com\//.test(url) || !/\/exec$/.test(url)) return toast('L\'URL deve iniziare con https://script.google.com/ e finire con /exec');
    if (token.length < 24) return toast('Token troppo corto.');
    toast('Verifica in corso…');
    try { const r = await api('ping', {}, { url: url, token: token }); S.cfg = { url: url, token: token, me: r.user }; LS.set('cfg', S.cfg); S.tab = 'today'; toast('Connesso come ' + (r.user === 'p1' ? 'Persona 1' : 'Persona 2')); render(); refresh(true); }
    catch (e) { toast(e.message || 'Errore di connessione'); }
  },
  savePeople() { [['p1', 'n1'], ['p2', 'n2']].forEach(x => { const n = val0(x[1]), cur = D().people.find(p => p.id === x[0]); if (n && (!cur || cur.name !== n)) enqueue('savePerson', { id: x[0], name: n, baseVersion: cur ? cur.version : 0 }, 'Nome ' + n); }); },
  saveGeneral() { [['dayStart', 'dayStart'], ['dayEnd', 'dayEnd'], ['dailyCapMin', 'cap']].forEach(x => { const v = val0(x[1]); if (v && v !== String(setting(x[0], ''))) enqueue('saveSetting', { key: x[0], value: v }, 'Impostazione ' + x[0]); }); },
  availNew(el, id) { availSheet(null, id); }, avail(el, id) { availSheet(id); },
  saveAvail(el, id) {
    const cur = id ? D().availability.find(a => a.id === id) : null, type = val('type');
    const item = { id: id || uid('av'), personId: segVal('person') || 'p1', type: type, weekdays: Array.from(document.querySelectorAll('#sheet input[name=wd]:checked')).map(x => x.value).join(','), start: val('start'), end: val('end'), dateFrom: val('dateFrom'), dateTo: val('dateTo'), label: val('label'), baseVersion: cur ? cur.version : 0 };
    if (type !== 'assenza' && (!item.weekdays || !item.start || !item.end || item.start >= item.end)) return toast('Scegli almeno un giorno e un orario valido.');
    enqueue('saveAvailability', { item: item }, 'Disponibilità ' + (item.label || ATYPE[type])); closeSheet();
  },
  delAvail(el, id) { const a = D().availability.find(x => x.id === id); if (!confirm('Eliminare questa disponibilità?')) return; enqueue('deleteAvailability', { id: id, baseVersion: a.version }, 'Elimina disponibilità'); closeSheet(); },
  pending() { pendingSheet(); },
  retry() { closeSheet(); refresh(true); },
  discard(el, id) { S.outbox.splice(Number(id), 1); saveBox(); render(); pendingSheet(); },
  logout() { if (!confirm('Rimuovere URL, token e dati locali da questo telefono? Le modifiche non ancora confermate andranno perse.')) return; ['cfg', 'data', 'outbox', 'last'].forEach(k => localStorage.removeItem(k)); S.cfg = { url: '', token: '', me: '' }; S.data = null; S.outbox = []; S.sync = { state: 'idle', last: null, msg: '' }; render(); }
};
const val0 = n => { const el = document.querySelector('#main [name="' + n + '"]'); return el ? el.value.trim() : ''; };

document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || !ACT[el.dataset.act]) return; S.force = true; try { ACT[el.dataset.act](el, el.dataset.id, e); } finally { S.force = false; } });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.f) { S.f[t.dataset.f] = t.value; S.force = true; render(); S.force = false; }
  else if (t.dataset && t.dataset.s) { S.stats[t.dataset.s] = t.value; S.force = true; render(); S.force = false; }
  else if (t.name === 'frequency') { const r = $('#intervalRow'); if (r) r.classList.toggle('hid', t.value !== 'custom'); }
  else if (t.name === 'type' && $('#wdRow')) { const ab = t.value === 'assenza'; $('#wdRow').classList.toggle('hid', ab); $('#dateRow').classList.toggle('hid', !ab); }
});

/* Pulsante Indietro di Android: chiude i pannelli, poi torna a Oggi, poi esce. */
const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (AppPlugin) AppPlugin.addListener('backButton', () => { if (sheetOpen()) closeSheet(); else if (S.tab !== 'today') { S.tab = 'today'; S.force = true; render(); S.force = false; } else AppPlugin.exitApp(); });

let ticks = 0;
setInterval(() => { if (!document.hidden) refresh(++ticks % 15 === 0); }, 20000); // controllo leggero ogni 20 s, scarico completo ogni 5 minuti
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', () => refresh());
render(); refresh(true);
})();
