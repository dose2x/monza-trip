'use strict';

const LS_STATE = 'monza-trip-v2';
const LS_KEY = 'monza-trip-key';
const LS_ME = 'monza-trip-me';
const RACE_DAYS = ['2027-09-03', '2027-09-04', '2027-09-05'];
const RACE_DATE = '2027-09-05';
const SPECIAL_DAYS = ['2027-09-06'];
const LS_THEME = 'monza-trip-theme';
const LS_PHOTO = 'monza-trip-photo';
const LS_PHOTO_LIST = 'monza-trip-photo-list';
const PHOTO_CACHE = 'monza-photos-v1';
// Guide photos: a different one is shown each time the app is opened.
// Once sync is set up they come from the private trip database; these local copies are only for testing on this computer.
const GUIDE_PHOTOS = ['lewis1.jpg', 'lewis2.webp', 'lewis3.webp', 'lewis4.webp', 'lewis5.webp', 'lewis6.webp', 'lewis7.webp', 'lewis8.webp'];

const EVENT_KINDS = ['race', 'drive', 'travel', 'stay', 'food', 'sight', 'other'];
const PLACE_KINDS = ['track', 'city', 'stay', 'sight', 'food', 'airport', 'idea'];
const BOOKING_KINDS = ['flight', 'hotel', 'car', 'tickets', 'other'];
const KIND_COLOR = {
  race: '#e10600', track: '#e10600', tickets: '#e10600', drive: '#ff8000', car: '#ff8000', travel: '#0093cc', airport: '#0093cc', flight: '#0093cc',
  stay: '#a071ee', hotel: '#a071ee', food: '#f5b53d', idea: '#f5b53d', sight: '#27c9b4', city: '#8a8a99', other: '#8a8a99',
};
const CATS = ['Flights', 'Lodging', 'Car and fuel', 'Tickets', 'Food', 'Shopping', 'Other'];
const BOOKING_CAT = { flight: 'Flights', hotel: 'Lodging', car: 'Car and fuel', tickets: 'Tickets', other: 'Other' };
const CURS = ['USD', 'EUR', 'CHF'];
const MAX_FORM_CHARS = 6000;
const TODO_GROUPS = ['Race tickets', 'Book first', 'Then book', 'Two weeks before', 'Before each mountain day', 'Other'];

// ---------- State ----------
// Everything is an item with an id, a type and an updatedAt stamp. Sync merges item by item, newest wins.
let state = { items: {}, dirty: {}, cursor: 0 };
let ui = { tab: 'trip', list: 'todo', radio: 0, photo: '', bounds: [] };
let map = null;
let mapLayers = null;
let syncState = 'local';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
    if (saved && saved.items) state = { items: saved.items, dirty: saved.dirty || {}, cursor: saved.cursor || 0 };
  } catch (e) { /* start fresh */ }
  for (const s of [TRIP_DEFAULTS, ...SEED]) {
    if (!state.items[s.id]) state.items[s.id] = { ...s, updatedAt: 1 };
  }
}
function save() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) { toast('Could not save on this phone'); }
}
function all(type) {
  return Object.values(state.items).filter(i => i.type === type && !i.deleted);
}
function settings() { return state.items.settings; }
// The driving legs and airport hops drawn on the map, kept with the rest of the plan.
function route() {
  const r = state.items.route;
  return r && !r.deleted ? { legs: r.legs || [], hops: r.hops || [] } : { legs: [], hops: [] };
}
function put(item) {
  item.updatedAt = Date.now();
  state.items[item.id] = item;
  state.dirty[item.id] = 1;
  save();
  render();
  queueSync();
}
function remove(id) {
  const it = state.items[id];
  if (it) put({ id, type: it.type, deleted: true });
}
// What a form should save: the item as it is now (the other phone may have changed it while the form was open)
// plus only the fields this form changed. A new item takes every field.
function merged(orig, values, changed) {
  const now = orig.id && state.items[orig.id];
  return now && !now.deleted ? { ...now, ...changed } : { ...orig, ...values };
}
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(s, opts) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric' });
}
function daysUntil(date) { return Math.round((parseDate(date) - parseDate(isoDate(new Date()))) / 864e5); }
function tripDates() {
  const s = settings();
  const out = [];
  if (!s.start || !s.end || s.end < s.start) return out;
  for (let d = parseDate(s.start); isoDate(d) <= s.end && out.length < 60; d.setDate(d.getDate() + 1)) out.push(isoDate(d));
  return out;
}
function dayItem(date) {
  const it = state.items['day-' + date];
  return it && !it.deleted ? it : { id: 'day-' + date, type: 'day', title: '', base: '', note: '' };
}
function toUSD(amount, cur) {
  const n = Number(amount) || 0;
  const s = settings();
  if (cur === 'EUR') return n * (Number(s.rateEUR) || 1);
  if (cur === 'CHF') return n * (Number(s.rateCHF) || 1);
  return n;
}
function money(n, cur) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);
}
function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
const cap = s => s[0].toUpperCase() + s.slice(1);
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
// Validation problems show inside the open form, next to the Save button.
function fail(msg) {
  const el = document.getElementById('form-error');
  if (el) el.textContent = msg; else toast(msg);
  return false;
}

// Things that should not be typed into an app anyone with the link can read.
function sensitiveHits(text) {
  const hits = [];
  const luhn = d => { let s = 0; for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; };
  if ((text.match(/\b\d(?:[ -]?\d){12,18}\b/g) || []).some(m => luhn(m.replace(/\D/g, '')))) hits.push('a card number');
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b(ssn|social security)\b/i.test(text)) hits.push('a Social Security number');
  if (/\bpassport\b[^a-z0-9]{0,3}(no\.?|number|#)?[^a-z0-9]{0,5}[a-z]?\d{6,9}\b/i.test(text)) hits.push('a passport number');
  if (/\b(password|passcode)\b\s*(is|:|=)\s*\S+/i.test(text) || /\bpin\b\s*(is|:|=|#)?\s*\d{3,8}\b/i.test(text)) hits.push('a password or PIN');
  if (/\b(cvv|cvc|security code)\b\D{0,4}\d{3,4}\b/i.test(text)) hits.push('a card security code');
  if (/\b(account|routing)\s*(number|no\.?|#)?\s*:?\s*\d{6,17}\b/i.test(text)) hits.push('a bank account number');
  return hits;
}
function sensitiveMessage(hits) {
  return 'This looks like ' + hits.join(' and ') + '. Anyone with the trip link can read what is saved here. Remove it and keep it somewhere safer, like a password manager.';
}

// ---------- Theme and guide photo ----------
function applyTheme() {
  const saved = localStorage.getItem(LS_THEME);
  const theme = saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  const btn = $('[data-act=theme]');
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  btn.classList.toggle('is-light', theme === 'light');
}
function showPhoto(src) {
  ui.photo = src;
  if (ui.tab === 'trip' && !$('#sheet').open) render();
}
async function nextPhoto() {
  const turn = Number(localStorage.getItem(LS_PHOTO)) || 0;
  localStorage.setItem(LS_PHOTO, String(turn + 1));
  const key = localStorage.getItem(LS_KEY);
  if (CONFIG.api && key) {
    const base = CONFIG.api.replace(/\/$/, '') + '/trip/' + encodeURIComponent(key) + '/photos';
    let names = [];
    try { names = JSON.parse(localStorage.getItem(LS_PHOTO_LIST) || '[]'); } catch (e) { /* refetch below */ }
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (res.ok) { names = (await res.json()).photos; localStorage.setItem(LS_PHOTO_LIST, JSON.stringify(names)); }
    } catch (e) { /* offline: use the remembered list */ }
    // Each photo is kept on the phone after its first download, so the guide still has a face offline.
    const store = window.caches ? await caches.open(PHOTO_CACHE) : null;
    for (let n = 0; n < names.length; n++) {
      const url = base + '/' + encodeURIComponent(names[(turn + n) % names.length]);
      try {
        let res = store && await store.match(url);
        if (!res) {
          res = await fetch(url);
          if (!res.ok) continue;
          if (store) store.put(url, res.clone());
        }
        return showPhoto(URL.createObjectURL(await res.blob()));
      } catch (e) { /* try the next one */ }
    }
    return;
  }
  // No sync yet: use the copies next to the app. If one is missing, try the next; with none, the 44 badge stays.
  const tryAt = n => {
    if (n >= GUIDE_PHOTOS.length) return;
    const src = GUIDE_PHOTOS[(turn + n) % GUIDE_PHOTOS.length];
    const probe = new Image();
    probe.onload = () => showPhoto(src);
    probe.onerror = () => tryAt(n + 1);
    probe.src = src;
  };
  tryAt(0);
}

// ---------- Render ----------
function render() {
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderCountdown();
  const box = $('#new-todo');
  const draft = box && { list: box.dataset.list, text: box.value, focus: document.activeElement === box };
  const view = $('#view');
  view.classList.toggle('map-mode', ui.tab === 'map');
  if (ui.tab !== 'map' && map) { map.remove(); map = null; }
  if (ui.tab === 'trip') view.innerHTML = tripView();
  else if (ui.tab === 'map') mapView(view);
  else if (ui.tab === 'bookings') view.innerHTML = bookingsView();
  else if (ui.tab === 'budget') view.innerHTML = budgetView();
  else view.innerHTML = listsView();
  const again = $('#new-todo');
  if (draft && again && again.dataset.list === draft.list) {
    again.value = draft.text;
    if (draft.focus) again.focus();
  }
}

function renderCountdown() {
  const s = settings();
  $('#eyebrow').textContent = s.title || 'Trip planner';
  const today = isoDate(new Date());
  const toTrip = daysUntil(s.start);
  const toRace = daysUntil(RACE_DATE);
  const block = (n, label) => '<div><b>' + esc(n) + '</b><span>' + esc(label) + '</span></div>';
  let html;
  if (today > s.end) html = '<div class="wide"><b>Chequered flag</b><span>Trip complete</span></div>';
  else if (toTrip > 0) html = block(toTrip, toTrip === 1 ? 'Day to go' : 'Days to go') + block(toRace, 'To lights out') +
    '<div class="wide"><b>' + esc(fmtDate(s.start) + ' to ' + fmtDate(s.end)) + '</b><span>2027</span></div>';
  else {
    const list = tripDates();
    html = block(list.indexOf(today) + 1, 'Day of ' + list.length) + (toRace >= 0 ? block(toRace, 'To lights out') : '') +
      '<div class="wide"><b>' + esc(dayItem(today).title || 'Open day') + '</b><span>Today</span></div>';
  }
  $('#countdown').innerHTML = html;
}

// The guide: short race-engineer radio calls built from what is still open.
function radioMessages() {
  const s = settings();
  const today = isoDate(new Date());
  const me = localStorage.getItem(LS_ME) || 'Rachel';
  const msgs = [];
  const openTodos = all('todo').filter(t => t.list === 'todo' && !t.done)
    .sort((a, b) => TODO_GROUPS.indexOf(a.group || 'Other') - TODO_GROUPS.indexOf(b.group || 'Other'));
  const openBookings = all('booking').filter(b => b.status !== 'booked');
  if (today >= s.start && today <= s.end) {
    const d = dayItem(today);
    msgs.push('OK ' + me + ', today: ' + (d.title || 'open day') + '.' + (d.drive ? ' Drive time ' + d.drive.toLowerCase() + '.' : ''));
    if (d.backup) msgs.push('Plan B if the weather turns: ' + d.backup);
    if (d.base) msgs.push('Tonight: ' + d.base + '.');
  } else if (today < s.start) {
    msgs.push('OK ' + me + ', it\'s hammer time. ' + daysUntil(s.start) + ' days to wheels up, ' + daysUntil(RACE_DATE) + ' to lights out at Monza.');
    if (openTodos[0]) msgs.push('Next on the run plan: ' + openTodos[0].text + '.');
    if (openTodos[1]) msgs.push('After that: ' + openTodos[1].text + '.');
    if (openBookings.length) msgs.push(openBookings.length + ' bookings still open. Flights and the Porsche come first, then hotels.');
    else msgs.push('Everything is booked. Copy, we are P1.');
  } else {
    msgs.push('Get in there, ' + me + '. What a drive.');
  }
  return msgs;
}
function radioCard() {
  const msgs = radioMessages();
  const i = ui.radio % msgs.length;
  const bars = [5, 9, 12, 7, 10, 4, 8].map(h => '<i style="height:' + h + 'px"></i>').join('');
  return '<section class="radio" aria-label="Team radio">' +
    '<div class="who">' + (ui.photo ? '<img src="' + esc(ui.photo) + '" alt="Lewis Hamilton">' : '<span aria-hidden="true">44</span>') + '</div>' +
    '<div class="body"><div class="label">Team radio <span class="bars" aria-hidden="true">' + bars + '</span></div>' +
    '<p>' + esc(msgs[i]) + '</p>' +
    (msgs.length > 1 ? '<div class="row"><button class="btn sm" data-act="radio">Next message</button><span class="count">' + (i + 1) + ' / ' + msgs.length + '</span></div>' : '') +
    '</div></section>';
}

function tripView() {
  const today = isoDate(new Date());
  const events = all('event');
  let html = '<div class="wrap">';
  // Until the plan has arrived there is nothing to guide: say how to get it instead.
  if (!events.length && !all('booking').length) {
    const key = localStorage.getItem(LS_KEY);
    return html + '<section class="card corner" style="padding:16px"><h2 style="margin:0 0 6px;font-size:18px;text-transform:uppercase">' +
      (key && CONFIG.api ? 'Loading the trip' : 'Link this phone') + '</h2><p class="muted" style="margin:0 0 12px">' +
      (key && CONFIG.api ? 'Fetching the plan. This needs a connection the first time.'
        : 'Open the trip link you were sent, or paste the trip code in Settings.') + '</p>' +
      '<button class="btn primary" data-act="' + (key && CONFIG.api ? 'retry' : 'settings') + '">' + (key && CONFIG.api ? 'Try again' : 'Open Settings') + '</button></section></div>';
  }
  html += radioCard();
  for (const date of tripDates()) {
    const day = dayItem(date);
    const d = parseDate(date);
    const evs = events.filter(e => e.date === date).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
    const cls = ['card', 'corner', 'day', RACE_DAYS.includes(date) ? 'race' : '', SPECIAL_DAYS.includes(date) ? 'special' : '', date === today ? 'today' : ''].join(' ');
    html += '<section class="' + cls + '">' +
      '<button class="day-head" data-act="edit-day" data-id="' + esc(day.id) + '">' +
      '<div class="date-badge"><b>' + String(d.getDate()).padStart(2, '0') + '</b><i>' + d.toLocaleDateString('en-US', { weekday: 'short' }) + '</i></div>' +
      '<div><div class="day-title">' + esc(day.title || 'Open day') + '</div>' + (day.base ? '<div class="day-base">Overnight: ' + esc(day.base) + '</div>' : '') + '</div></button>';
    if (day.note) html += '<p class="day-note">' + esc(day.note) + '</p>';
    const facts = [['Drive', day.drive], ['Roads', day.roads], ['Backup', day.backup]].filter(f => f[1]);
    if (facts.length) html += '<dl class="facts">' + facts.map(f => '<dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd>').join('') + '</dl>';
    if (safeUrl(day.map)) html += '<div class="day-actions"><a class="btn sm" href="' + esc(safeUrl(day.map)) + '" target="_blank" rel="noopener">Open route in Google Maps</a></div>';
    html += '<ul class="events">';
    for (const e of evs) {
      html += '<li><button class="event" data-act="edit-event" data-id="' + esc(e.id) + '">' +
        '<span class="dot k-' + esc(e.kind) + '"></span><span class="time">' + esc(e.time || 'TBC') + '</span>' +
        '<span class="what">' + esc(e.title) + (e.note ? '<small>' + esc(e.note) + '</small>' : '') + '</span></button></li>';
    }
    html += '</ul><button class="add-line" data-act="add-event" data-date="' + date + '">+ Add to this day</button></section>';
  }
  const dates = tripDates();
  const strays = events.filter(e => !dates.includes(e.date));
  if (strays.length) {
    html += '<h2 class="section-title">Outside the trip dates <small>' + strays.length + '</small></h2><section class="card corner day"><ul class="events" style="border-top:0">' +
      strays.map(e => '<li><button class="event" data-act="edit-event" data-id="' + esc(e.id) + '"><span class="dot k-' + esc(e.kind) + '"></span>' +
        '<span class="time">' + esc(fmtDate(e.date) || 'No day') + '</span><span class="what">' + esc(e.title) + '<small>Tap to move it to a trip day, or delete it.</small></span></button></li>').join('') +
      '</ul></section>';
  }
  return html + '</div>';
}

function bookingsView() {
  const list = all('booking').sort((a, b) => (a.start || '') < (b.start || '') ? -1 : 1);
  const card = b => {
    const booked = b.status === 'booked';
    const dates = b.start ? fmtDate(b.start) + (b.end && b.end !== b.start ? ' to ' + fmtDate(b.end) : '') : '';
    return '<button class="card corner booking ' + (booked ? 'booked' : '') + '" data-act="edit-booking" data-id="' + esc(b.id) + '">' +
      '<span class="dot k-' + esc(b.kind) + '"></span><span class="body">' +
      '<span class="tag ' + (booked ? 'ok' : 'open') + '">' + esc(cap(b.kind)) + ' · ' + (booked ? 'Booked' : 'To book') + '</span>' +
      '<b>' + esc(b.title) + '</b>' +
      '<span class="meta">' + esc(dates) + (Number(b.cost) ? ' · ' + money(b.cost, b.cur) : '') + '</span>' +
      (b.conf ? '<span class="conf">' + esc(b.conf) + '</span>' : '') +
      (b.note ? '<span class="meta">' + esc(b.note) + '</span>' : '') + '</span></button>';
  };
  const todo = list.filter(b => b.status !== 'booked');
  const booked = list.filter(b => b.status === 'booked');
  let html = '<div class="wrap">';
  html += '<h2 class="section-title">Booked <small>' + booked.length + '</small></h2>';
  html += booked.length ? booked.map(card).join('') : '<p class="empty card">Nothing booked yet.</p>';
  html += '<h2 class="section-title">Still to book <small>' + todo.length + '</small></h2>' + todo.map(card).join('');
  html += '<button class="btn ghost" data-act="add-booking">+ Add a booking</button></div>';
  return html;
}

function budgetView() {
  const s = settings();
  const expenses = all('expense').sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
  const bookings = all('booking').filter(b => Number(b.cost) > 0);
  const spent = expenses.reduce((t, e) => t + toUSD(e.amount, e.cur), 0);
  const booked = bookings.filter(b => b.status === 'booked').reduce((t, b) => t + toUSD(b.cost, b.cur), 0);
  const planned = bookings.filter(b => b.status !== 'booked').reduce((t, b) => t + toUSD(b.cost, b.cur), 0);
  const total = spent + booked;
  const budget = Number(s.budget) || 0;
  const byCat = {};
  for (const e of expenses) byCat[e.cat || 'Other'] = (byCat[e.cat || 'Other'] || 0) + toUSD(e.amount, e.cur);
  for (const b of bookings.filter(x => x.status === 'booked')) {
    const c = BOOKING_CAT[b.kind] || 'Other';
    byCat[c] = (byCat[c] || 0) + toUSD(b.cost, b.cur);
  }
  const max = Math.max(1, ...Object.values(byCat));
  let html = '<div class="wrap"><div class="stats">' +
    '<div class="card corner stat"><b>' + money(total) + '</b><span>Committed</span></div>' +
    '<div class="card corner stat"><b>' + money(planned) + '</b><span>Estimated</span></div>' +
    '<div class="card corner stat"><b>' + (budget ? money(budget - total - planned) : '--') + '</b><span>Left</span></div></div>';
  if (budget) {
    const pct = Math.min(100, (total + planned) / budget * 100);
    html += '<div class="meter"><i class="' + (total + planned > budget ? 'over' : '') + '" style="width:' + pct.toFixed(0) + '%"></i></div>' +
      '<p class="small muted" style="margin:0">' + money(total + planned) + ' of ' + money(budget) + ' all-in target, in US dollars</p>';
  }
  html += '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="edit-budget">' + (budget ? 'Budget and rates' : 'Set a budget') + '</button>' +
    '<span class="small muted">1 EUR = $' + esc(s.rateEUR) + ' · 1 CHF = $' + esc(s.rateCHF) + '</span></div>';
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  if (cats.length) {
    html += '<h2 class="section-title">By category</h2><div class="card corner" style="padding:6px 0">';
    for (const c of cats) {
      html += '<div class="cat"><span>' + esc(c) + '</span><div class="meter"><i style="width:' + (byCat[c] / max * 100).toFixed(0) + '%"></i></div><b>' + money(byCat[c]) + '</b></div>';
    }
    html += '</div>';
  }
  html += '<h2 class="section-title">Expenses</h2>';
  if (expenses.length) {
    html += '<div class="card corner">' + expenses.map(e =>
      '<button class="expense" data-act="edit-expense" data-id="' + esc(e.id) + '"><span><b>' + esc(e.title) + '</b>' +
      '<small>' + esc([fmtDate(e.date), e.cat, e.who].filter(Boolean).join(' · ')) + '</small></span>' +
      '<span class="amt">' + money(e.amount, e.cur) + (e.cur !== 'USD' ? '<small>' + money(toUSD(e.amount, e.cur)) + '</small>' : '') + '</span></button>').join('') + '</div>';
  } else {
    html += '<p class="empty card">No expenses yet. Costs on booked items count automatically.</p>';
  }
  html += '<button class="btn ghost" style="margin-top:10px" data-act="add-expense">+ Add an expense</button></div>';
  return html;
}

function listsView() {
  const items = all('todo').filter(t => t.list === ui.list);
  const left = items.filter(t => !t.done).length;
  const row = t => '<div class="todo ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-act="toggle" data-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') +
    ' aria-label="Done: ' + esc(t.text) + '"><button data-act="edit-todo" data-id="' + esc(t.id) + '">' + esc(t.text) + '</button></div>';
  let html = '<div class="wrap"><div class="seg">' +
    '<button data-act="list" data-list="todo" aria-pressed="' + (ui.list === 'todo') + '" class="' + (ui.list === 'todo' ? 'on' : '') + '">To do</button>' +
    '<button data-act="list" data-list="pack" aria-pressed="' + (ui.list === 'pack') + '" class="' + (ui.list === 'pack' ? 'on' : '') + '">Packing</button></div>' +
    '<p class="small muted" style="margin:0 0 10px">' + left + ' of ' + items.length + ' left</p>';
  if (!items.length) html += '<p class="empty card">Nothing here yet.</p>';
  else if (ui.list === 'todo') {
    for (const g of TODO_GROUPS) {
      const rows = items.filter(t => (TODO_GROUPS.includes(t.group) ? t.group : 'Other') === g);
      if (rows.length) html += '<h2 class="section-title">' + esc(g) + ' <small>' + rows.filter(t => !t.done).length + ' open</small></h2><div class="card corner">' + rows.map(row).join('') + '</div>';
    }
  } else {
    html += '<div class="card corner">' + items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0)).map(row).join('') + '</div>';
  }
  html += '<div class="add-todo"><input type="text" id="new-todo" data-list="' + ui.list + '" aria-label="' + (ui.list === 'todo' ? 'New task' : 'New packing item') + '" placeholder="' +
    (ui.list === 'todo' ? 'Add a task' : 'Add an item') + '" enterkeyhint="done"><button class="btn primary" data-act="add-todo">Add</button></div></div>';
  return html;
}

// ---------- Map ----------
function mapView(view) {
  const places = all('place').sort((a, b) => a.name < b.name ? -1 : 1);
  const legCount = route().legs.length;
  if (map && ui.legCount !== legCount) { map.remove(); map = null; ui.fitted = false; }
  ui.legCount = legCount;
  if (!map || !document.getElementById('map')) {
    view.innerHTML = '<div class="map-bar"><button class="btn sm" data-act="fit">Whole trip</button>' +
      route().legs.map((l, i) => '<button class="btn sm" data-act="leg" data-id="' + i + '"><span class="swatch" style="background:' + l.color + '"></span>' + esc(fmtDate(l.date)) + '</button>').join('') +
      '<button class="btn sm" data-act="add-place">+ Place</button></div>' +
      '<div id="map"></div><div class="map-list" id="map-list"></div>';
    if (window.L) {
      map = L.map('map', { zoomControl: false, zoomSnap: 0.25 }).setView([48, 8.6], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, crossOrigin: true, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      mapLayers = L.layerGroup().addTo(map);
      map.on('contextmenu', e => placeForm({ lat: e.latlng.lat.toFixed(5), lon: e.latlng.lng.toFixed(5) }));
      // Keep the whole trip in view while the page settles, until someone moves the map.
      ui.moved = false;
      map.getContainer().addEventListener('pointerdown', () => { ui.moved = true; });
      new ResizeObserver(() => {
        if (!map) return;
        map.invalidateSize();
        if (!ui.moved) fitTrip();
      }).observe(map.getContainer());
    } else {
      $('#map').innerHTML = '<p class="empty">The map needs a connection the first time it loads.</p>';
    }
  }
  $('#map-list').innerHTML = places.map(p =>
    '<button class="place" data-act="show-place" data-id="' + esc(p.id) + '"><span class="dot k-' + esc(p.kind) + '"></span>' +
    '<span><b>' + esc(p.name) + '</b>' + (p.note ? '<small>' + esc(p.note) + '</small>' : '') + '</span></button>').join('') +
    '<p class="small muted" style="padding:8px 14px;margin:0">Press and hold the map to drop a pin. Route lines are sketches: use the Google Maps button on each driving day for directions.</p>';
  // The list below just changed the map's height.
  if (map) { map.invalidateSize(); drawMap(places); }
}

function fitTrip() {
  map.invalidateSize();
  if (ui.bounds.length) map.fitBounds(ui.bounds, { padding: [24, 24], animate: false });
}

function drawMap(places) {
  mapLayers.clearLayers();
  const bounds = [];
  const dot = (color, via) => L.divIcon({ className: '', html: '<div class="pin ' + (via ? 'via' : '') + '" style="background:' + color + '"></div>', iconSize: via ? [10, 10] : [18, 18], iconAnchor: via ? [5, 5] : [9, 9] });
  const { legs, hops } = route();
  for (const hop of hops) L.polyline(hop, { color: '#8a8a99', weight: 3, dashArray: '4 6' }).addTo(mapLayers);
  for (const leg of legs) {
    L.polyline(leg.pts.map(p => [p[1], p[2]]), { color: leg.color, weight: 4, opacity: .9 }).addTo(mapLayers);
    for (const p of leg.pts.slice(1, -1)) L.marker([p[1], p[2]], { icon: dot(leg.color, true) }).bindPopup(esc(p[0]) + '<br>' + esc(fmtDate(leg.date))).addTo(mapLayers);
  }
  for (const p of places) {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!isFinite(lat) || !isFinite(lon) || (!lat && !lon)) continue;
    bounds.push([lat, lon]);
    const link = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon;
    const m = L.marker([lat, lon], { icon: dot(KIND_COLOR[p.kind] || KIND_COLOR.other), zIndexOffset: 500 }).addTo(mapLayers);
    m.bindPopup('<b>' + esc(p.name) + '</b>' + (p.note ? '<br>' + esc(p.note) : '') +
      '<br><a href="' + link + '" target="_blank" rel="noopener">Open in Google Maps</a>' +
      '<br><button class="btn sm" style="margin-top:6px" data-act="edit-place" data-id="' + esc(p.id) + '">Edit</button>');
    m.placeId = p.id;
  }
  ui.bounds = bounds;
  if (!ui.fitted && bounds.length) { fitTrip(); setTimeout(() => { if (map && !ui.moved) fitTrip(); }, 400); ui.fitted = true; }
}

// ---------- Sheet and forms ----------
let sheetSave = null;
function openSheet(html) {
  $('#sheet-form').innerHTML = html;
  const dlg = $('#sheet');
  if (!dlg.open) dlg.showModal();
}
function closeSheet() { sheetSave = null; if ($('#sheet').open) $('#sheet').close(); }

// fields: [{ name, label, type, options, half }]
function form(title, fields, values, onSave, onDelete, extra) {
  let html = '<h2 id="sheet-title">' + esc(title) + '</h2>';
  let half = false;
  const initial = {};
  for (const f of fields) {
    const v = values[f.name] == null ? '' : values[f.name];
    initial[f.name] = String(v).trim();
    if (f.half && !half) { html += '<div class="two">'; half = true; }
    if (!f.half && half) { html += '</div>'; half = false; }
    html += '<div><label for="f-' + f.name + '">' + esc(f.label) + '</label>';
    if (f.type === 'select') {
      html += '<select id="f-' + f.name + '" name="' + f.name + '">' + f.options.map(o => {
        const [val, text] = Array.isArray(o) ? o : [o, o];
        return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(text) + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'textarea') {
      html += '<textarea id="f-' + f.name + '" name="' + f.name + '">' + esc(v) + '</textarea>';
    } else {
      html += '<input id="f-' + f.name + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' +
        (f.type === 'number' ? ' step="any" inputmode="decimal"' : '') + '>';
    }
    html += '</div>';
  }
  if (half) html += '</div>';
  html += (extra || '') + '<div class="form-error" id="form-error" role="alert"></div>' +
    '<div class="sheet-actions">' + (onDelete ? '<button type="button" class="btn danger" data-act="sheet-delete">Delete</button>' : '') +
    '<span class="grow"></span><button type="button" class="btn" data-act="close">Cancel</button>' +
    '<button type="submit" class="btn primary">Save</button></div>';
  sheetSave = { onSave, onDelete, fields, initial, scan: title !== 'Settings' };
  openSheet(html);
}
function formValues() {
  const out = {};
  for (const f of sheetSave.fields) out[f.name] = document.getElementById('f-' + f.name).value.trim();
  return out;
}
const kindOptions = kinds => kinds.map(k => [k, cap(k)]);

function dayForm(id) {
  const day = dayItem(id.slice(4));
  form(fmtDate(id.slice(4), { weekday: 'long', month: 'long', day: 'numeric' }), [
    { name: 'title', label: 'Plan for the day' },
    { name: 'base', label: 'Overnight' },
    { name: 'note', label: 'Notes', type: 'textarea' },
    { name: 'drive', label: 'Drive time' },
    { name: 'roads', label: 'Roads' },
    { name: 'backup', label: 'Backup route' },
    { name: 'map', label: 'Google Maps link', type: 'url' },
  ], day, (v, ch) => put({ ...merged(day, v, ch), id, type: 'day' }));
}
function eventForm(ev) {
  const isNew = !ev.id;
  form(isNew ? 'Add to ' + fmtDate(ev.date) : 'Edit plan', [
    { name: 'title', label: 'What' },
    { name: 'date', label: 'Day', type: 'date', half: true },
    { name: 'time', label: 'Time', type: 'time', half: true },
    { name: 'kind', label: 'Type', type: 'select', options: kindOptions(EVENT_KINDS) },
    { name: 'note', label: 'Notes', type: 'textarea' },
  ], ev, (v, ch) => {
    if (!v.title) return fail('Give it a name.');
    if (!tripDates().includes(v.date)) return fail('Pick a day within the trip.');
    put({ ...merged(ev, v, ch), id: ev.id || uid('ev'), type: 'event' });
  }, isNew ? null : () => remove(ev.id));
}
function placeForm(p) {
  const isNew = !p.id;
  form(isNew ? 'Add a place' : 'Edit place', [
    { name: 'name', label: 'Name or address' },
    { name: 'kind', label: 'Type', type: 'select', options: kindOptions(PLACE_KINDS) },
    { name: 'lat', label: 'Latitude', type: 'number', half: true },
    { name: 'lon', label: 'Longitude', type: 'number', half: true },
    { name: 'note', label: 'Notes', type: 'textarea' },
  ], { kind: 'sight', ...p }, (v, ch) => {
    if (!v.name) return fail('Give it a name.');
    if (!v.lat || !v.lon) return fail('Tap "Find on map" to place it first.');
    put({ ...merged(p, v, ch), id: p.id || uid('pl'), type: 'place' });
  }, isNew ? null : () => remove(p.id),
  '<button type="button" class="btn sm" style="margin-top:10px" data-act="geocode">Find on map</button>');
}
function bookingForm(b) {
  const isNew = !b.id;
  form(isNew ? 'Add a booking' : 'Edit booking', [
    { name: 'title', label: 'What' },
    { name: 'kind', label: 'Type', type: 'select', options: kindOptions(BOOKING_KINDS), half: true },
    { name: 'status', label: 'Status', type: 'select', options: [['todo', 'Still to book'], ['booked', 'Booked']], half: true },
    { name: 'start', label: 'From', type: 'date', half: true },
    { name: 'end', label: 'To', type: 'date', half: true },
    { name: 'conf', label: 'Confirmation number' },
    { name: 'cost', label: 'Cost', type: 'number', half: true },
    { name: 'cur', label: 'Currency', type: 'select', options: CURS, half: true },
    { name: 'link', label: 'Link', type: 'url' },
    { name: 'note', label: 'Notes', type: 'textarea' },
  ], { kind: 'hotel', status: 'todo', cur: 'EUR', ...b }, (v, ch) => {
    if (!v.title) return fail('Give it a name.');
    put({ ...merged(b, v, ch), id: b.id || uid('bk'), type: 'booking' });
  }, isNew ? null : () => remove(b.id),
  !isNew && (b.conf || safeUrl(b.link)) ? '<div class="row" style="margin-top:10px">' +
    (b.conf ? '<button type="button" class="btn sm" data-act="copy" data-text="' + esc(b.conf) + '">Copy confirmation</button>' : '') +
    (safeUrl(b.link) ? '<a class="btn sm" href="' + esc(safeUrl(b.link)) + '" target="_blank" rel="noopener">Open link</a>' : '') + '</div>' : '');
}
function expenseForm(e) {
  const isNew = !e.id;
  form(isNew ? 'Add an expense' : 'Edit expense', [
    { name: 'title', label: 'What' },
    { name: 'amount', label: 'Amount', type: 'number', half: true },
    { name: 'cur', label: 'Currency', type: 'select', options: CURS, half: true },
    { name: 'date', label: 'Day', type: 'date', half: true },
    { name: 'cat', label: 'Category', type: 'select', options: CATS, half: true },
    { name: 'who', label: 'Paid by', type: 'select', options: ['Aaron', 'Rachel', 'Both'] },
  ], { cur: 'EUR', cat: 'Food', date: isoDate(new Date()), who: localStorage.getItem(LS_ME) || 'Both', ...e }, (v, ch) => {
    if (!v.title || !Number(v.amount)) return fail('Add a name and an amount.');
    put({ ...merged(e, v, ch), id: e.id || uid('ex'), type: 'expense' });
  }, isNew ? null : () => remove(e.id));
}
function todoForm(t) {
  const fields = [{ name: 'text', label: 'Item' }, { name: 'list', label: 'List', type: 'select', options: [['todo', 'To do'], ['pack', 'Packing']] }];
  if (t.list === 'todo') fields.push({ name: 'group', label: 'Section', type: 'select', options: TODO_GROUPS });
  form('Edit item', fields, { group: 'Other', ...t }, (v, ch) => { if (!v.text) return fail('Give it a name.'); put(merged(t, v, ch)); }, () => remove(t.id));
}
function budgetForm() {
  const s = settings();
  form('Budget and exchange rates', [
    { name: 'budget', label: 'All-in trip budget, US dollars', type: 'number' },
    { name: 'rateEUR', label: '1 euro in dollars', type: 'number', half: true },
    { name: 'rateCHF', label: '1 Swiss franc in dollars', type: 'number', half: true },
  ], s, (v, ch) => {
    if (!(Number(v.rateEUR) > 0) || !(Number(v.rateCHF) > 0)) return fail('Enter both exchange rates, for example 1.15.');
    put(merged(s, v, ch));
  });
}
function settingsSheet() {
  const s = settings();
  const key = localStorage.getItem(LS_KEY) || '';
  const labels = {
    local: CONFIG.api ? 'Not linked. Paste the trip code below.' : 'Saved on this phone only. Sync is not set up yet.',
    ok: 'Synced', syncing: 'Syncing...', offline: 'Offline. Changes will sync later.', error: 'Sync problem. Check the trip code.',
  };
  form('Settings', [
    { name: 'me', label: 'This phone belongs to', type: 'select', options: ['Rachel', 'Aaron'] },
    { name: 'start', label: 'Trip starts', type: 'date', half: true },
    { name: 'end', label: 'Trip ends', type: 'date', half: true },
    { name: 'key', label: 'Trip code' },
  ], { me: localStorage.getItem(LS_ME) || 'Rachel', start: s.start, end: s.end, key }, v => {
    if (!v.start || !v.end || v.end < v.start) return fail('The trip needs a start date and an end date on or after it.');
    localStorage.setItem(LS_ME, v.me);
    if (v.key !== key) { localStorage.setItem(LS_KEY, v.key); state.cursor = 0; setTimeout(nextPhoto, 3000); for (const id in state.items) if (state.items[id].updatedAt > 1) state.dirty[id] = 1; }
    if (v.start !== s.start || v.end !== s.end) put({ ...settings(), start: v.start, end: v.end });
    else { save(); render(); queueSync(); }
  }, null,
  '<p class="small muted" style="margin:12px 0 0">Sync: ' + esc(labels[syncState]) + '</p>' +
  '<p class="small muted" style="margin:6px 0 0">Anyone with the trip link can read this trip. Confirmation numbers are fine; never save card numbers, passport numbers or passwords here.</p>' +
  '<div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-act="export">Download a backup</button>' +
  (key ? '<button type="button" class="btn sm" data-act="copy-link">Copy link for the other phone</button>' : '') + '</div>');
}

async function geocode() {
  const q = document.getElementById('f-name').value.trim();
  if (!q) return fail('Type a name or address first.');
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const hit = (await res.json())[0];
    if (!hit) return fail('Could not find that. Try adding the town.');
    document.getElementById('f-lat').value = Number(hit.lat).toFixed(5);
    document.getElementById('f-lon').value = Number(hit.lon).toFixed(5);
    document.getElementById('form-error').textContent = '';
    toast('Found: ' + hit.display_name.split(',').slice(0, 2).join(','));
  } catch (e) { fail('Search needs a connection.'); }
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; ui.fitted = false; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  const item = id ? state.items[id] : null;
  switch (act) {
    case 'settings': settingsSheet(); break;
    case 'retry': sync().then(() => { nextPhoto(); toast(syncState === 'ok' ? 'Up to date' : 'Could not reach the trip'); }); break;
    case 'theme':
      localStorage.setItem(LS_THEME, document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      applyTheme();
      break;
    case 'save-anyway': if (sheetSave) { sheetSave.allowSensitive = true; $('#sheet-form').requestSubmit(); } break;
    case 'radio': ui.radio++; render(); break;
    case 'edit-day': dayForm(id); break;
    case 'add-event': eventForm({ date: el.dataset.date, kind: 'sight' }); break;
    case 'edit-event': eventForm(item); break;
    case 'add-place': placeForm({}); break;
    case 'edit-place': placeForm(item); break;
    case 'show-place': {
      if (!map) { placeForm(item); break; }
      ui.moved = true;
      map.setView([Number(item.lat), Number(item.lon)], Math.max(map.getZoom(), 9));
      mapLayers.eachLayer(l => { if (l.placeId === id) l.openPopup(); });
      break;
    }
    case 'fit': ui.moved = false; if (map) fitTrip(); break;
    case 'leg': ui.moved = true; if (map) map.fitBounds(route().legs[Number(id)].pts.map(p => [p[1], p[2]]), { padding: [30, 30] }); break;
    case 'add-booking': bookingForm({}); break;
    case 'edit-booking': bookingForm(item); break;
    case 'add-expense': expenseForm({}); break;
    case 'edit-expense': expenseForm(item); break;
    case 'edit-budget': budgetForm(); break;
    case 'list': ui.list = el.dataset.list; render(); break;
    case 'toggle': put({ ...item, done: el.checked }); break;
    case 'edit-todo': todoForm(item); break;
    case 'add-todo': addTodo(); break;
    case 'geocode': geocode(); break;
    case 'copy': navigator.clipboard.writeText(el.dataset.text).then(() => toast('Copied')); break;
    case 'copy-link':
      navigator.clipboard.writeText(location.origin + location.pathname + '#k=' + localStorage.getItem(LS_KEY)).then(() => toast('Link copied'));
      break;
    case 'export': exportBackup(); break;
    case 'sheet-delete': if (sheetSave && sheetSave.onDelete && confirm('Delete this? It is removed on both phones.')) { const f = sheetSave.onDelete; closeSheet(); f(); } break;
    case 'close': closeSheet(); break;
  }
});
$('#sheet-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!sheetSave) return closeSheet();
  const values = formValues();
  const hits = sheetSave.scan && !sheetSave.allowSensitive ? sensitiveHits(Object.values(values).join('\n')) : [];
  if (hits.length) {
    $('#form-error').innerHTML = esc(sensitiveMessage(hits)) + '<br><button type="button" class="btn sm" style="margin-top:8px" data-act="save-anyway">Save anyway</button>';
    $('#form-error').scrollIntoView({ block: 'nearest' });
    return;
  }
  if (JSON.stringify(values).length > MAX_FORM_CHARS) return fail('That is too long to sync between phones. Shorten the notes.');
  const changed = {};
  for (const k in values) if (values[k] !== sheetSave.initial[k]) changed[k] = values[k];
  // A save handler returns false to keep the sheet open (validation failed).
  if (sheetSave.onSave(values, changed) !== false) closeSheet();
});
$('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) closeSheet(); });
$('#sheet').addEventListener('close', () => { sheetSave = null; });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'new-todo') { e.preventDefault(); addTodo(); }
});
function addTodo() {
  const text = $('#new-todo').value.trim();
  if (!text) return;
  const hits = sensitiveHits(text);
  if (hits.length && !confirm(sensitiveMessage(hits) + '\n\nSave it anyway?')) return;
  const item = { id: uid('td'), type: 'todo', list: ui.list, text, done: false };
  if (ui.list === 'todo') item.group = 'Other';
  $('#new-todo').value = '';
  put(item);
  $('#new-todo').focus();
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(Object.values(state.items), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'monza-trip-backup-' + isoDate(new Date()) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 10000);
}

// ---------- Sync ----------
let syncTimer = null;
let syncing = false;
function queueSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); }
async function sync() {
  const key = localStorage.getItem(LS_KEY);
  if (!CONFIG.api || !key) { syncState = 'local'; return; }
  if (syncing) return queueSync();
  syncing = true;
  syncState = 'syncing';
  const url = CONFIG.api.replace(/\/$/, '') + '/trip/' + encodeURIComponent(key);
  try {
    const sending = Object.keys(state.dirty).map(id => state.items[id]).filter(Boolean);
    if (sending.length) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: sending }) });
      if (!res.ok) throw new Error('push ' + res.status);
      for (const it of sending) if (state.items[it.id].updatedAt === it.updatedAt) delete state.dirty[it.id];
      const refused = (await res.json()).rejected || [];
      if (refused.length) toast(refused.length + ' item too large to sync. It stays on this phone only.');
    }
    const res = await fetch(url + '?since=' + state.cursor, { cache: 'no-store' });
    if (!res.ok) throw new Error('pull ' + res.status);
    const data = await res.json();
    let changed = false;
    for (const it of data.items) {
      const mine = state.items[it.id];
      if (!mine || it.updatedAt > mine.updatedAt) { state.items[it.id] = it; delete state.dirty[it.id]; changed = true; }
    }
    state.cursor = data.cursor || state.cursor;
    save();
    syncState = 'ok';
    // Do not redraw under an open form.
    if (changed && !$('#sheet').open) render();
  } catch (e) {
    syncState = navigator.onLine ? 'error' : 'offline';
  } finally {
    syncing = false;
  }
}

// ---------- Start ----------
(function start() {
  const m = location.hash.match(/k=([\w-]{16,})/);
  if (m) localStorage.setItem(LS_KEY, m[1]);
  applyTheme();
  load();
  save();
  render();
  sync();
  nextPhoto();
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); renderCountdown(); } });
  window.addEventListener('online', sync);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
