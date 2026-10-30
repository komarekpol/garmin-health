'use strict';
// ══════════ GARMIN HEALTH — aplikace (vkládá se do garmin-dashboard.html, viz tools/build.py) ══════════
// Data: cloud (Apps Script: window.__GH_CLOUD__ → google.script.run ghGet / ghSync / ghSet / ghJournalSet / ghJournalCfg)
// nebo volitelně lokální server (file:// → http://localhost:8765 /data /settings /journal /sync).
// Tvar dat = buildData_ (Apps Script) = load_data (local/garmin_data.py); `days` (kompaktní dny + aktivity) má jen cloud.

const API = 'http://localhost:8765';
const CLOUD = window.__GH_CLOUD__ || null;
const ST_KEYS = ['garmin_thresholds', 'garmin_vst_zones', 'garmin_hr_zones', 'garmin_bb_zones', 'garmin_resp_zones', 'garmin_ui'];
const STALE_H = 30;
let DATA = null, META = null, JR = { days: {}, cfg: {}, food: {} }, DAYS = [], BYD = {}, PAGE = 'dnes';
const UI = { trend: 'hrv', range: 30, out: 'hrv', jday: null, fmeal: null, fq: '', fed: null, fnew: '' };

// ── drobnosti ──
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const num = v => (typeof v === 'number' && isFinite(v)) ? v : (v != null && v !== '' && isFinite(+v) ? +v : null);
const fmt = (v, d) => { v = num(v); return v == null ? '—' : v.toLocaleString('cs-CZ', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
const sgn = (v, d) => { const p = Math.pow(10, d || 0), r = Math.round(v * p) / p; return r === 0 ? '±0' : (r > 0 ? '+' : '−') + fmt(Math.abs(r), d); };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const vr = a => { const m = avg(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1) : 0; };
const ymd = d => { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
const addD = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = () => ymd(new Date());
const DOW = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const MON = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const dLong = s => { const d = new Date(s + 'T12:00:00'); return DOW[d.getDay()] + ' ' + d.getDate() + '. ' + MON[d.getMonth()]; };
const dShort = s => s ? (+s.slice(8, 10)) + '. ' + (+s.slice(5, 7)) + '.' : '';
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const hm = h => { if (h == null) return '—'; const m = Math.round(h * 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 2600); }
function note(msg, kind) {
  const el = $('note'); if (!msg) { el.className = 'card'; el.innerHTML = ''; return; }
  el.className = 'card on'; el.style.borderLeft = '3px solid ' + tok(kind === 'warn' ? '--amber' : '--crit');
  el.innerHTML = '<div class="sm">' + msg + '</div>';
}

// ── nastavení (prahy, zóny, vzhled): v paměti, localStorage = kopie, trvale na Disku (garmin-settings.json) ──
const ST = {};
function stGet(k) { if (k in ST) return ST[k]; try { return localStorage.getItem(k); } catch (e) { return null; } }
function stSet(k, v) { ST[k] = v; try { localStorage.setItem(k, v); } catch (e) {} stQueue(k, v); }
function stDel(k) { ST[k] = null; try { localStorage.removeItem(k); } catch (e) {} stQueue(k, null); }
let stPend = {}, stTimer = null;
function stQueue(k, v) { stPend[k] = v; clearTimeout(stTimer); stTimer = setTimeout(stFlush, 500); }
async function stFlush() {
  const b = stPend; stPend = {}; if (!Object.keys(b).length) return;
  try {
    const r = CLOUD ? await gsRun('ghSet', CLOUD.key, JSON.stringify(b))
      : await (await fetch(`${API}/settings`, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'text/plain' } })).json();
    if (!r.ok) throw new Error(r.error || 'neznámá chyba');
  } catch (e) { note('Nastavení se neuložilo na Disk (' + esc(e.message || e) + ') — platí jen v tomto prohlížeči.', 'warn'); }
}
function stApply(s) {
  if (!s || typeof s !== 'object') return;
  ST_KEYS.forEach(k => { if (k in s && s[k] != null) { ST[k] = String(s[k]); try { localStorage.setItem(k, ST[k]); } catch (e) {} } });
  T = loadT();
}
function gsRun(fn, ...a) {
  return new Promise((res, rej) => {
    if (!window.google || !google.script || !google.script.run) return rej(new Error('google.script.run není k dispozici'));
    google.script.run.withSuccessHandler(t => { try { res(typeof t === 'string' ? JSON.parse(t) : t); } catch (e) { rej(e); } })
      .withFailureHandler(e => rej(e instanceof Error ? e : new Error(String(e && e.message || e))))[fn](...a);
  });
}

// ── prahy (Pavlovy, editovatelné v Nastavení) ──
const THRESH_DEF = {
  hrv_ok:     { val: 28, label: 'HRV normál ≥',        unit: 'ms',  stav: 'ok',     badge: 'normál', akce: 'trénink OK' },
  hrv_warn:   { val: 20, label: 'HRV pozor ≥',          unit: 'ms',  stav: 'warn',   badge: 'pozor',  akce: 'lehčí trénink nebo chůze' },
  hrv_danger: { val: 0,  label: 'HRV alarm < (min)',    unit: 'ms',  stav: 'danger', badge: 'alarm',  akce: 'žádný trénink · zvážit lékaře' },
  hr_ok:      { val: 54, label: 'Klidový TF normál ≤',  unit: 'bpm', stav: 'ok',     badge: 'normál', akce: 'trénink OK' },
  hr_warn:    { val: 57, label: 'Klidový TF pozor >',   unit: 'bpm', stav: 'warn',   badge: 'pozor',  akce: 'sledovat příznaky' },
  hr_danger:  { val: 62, label: 'Klidový TF alarm >',   unit: 'bpm', stav: 'danger', badge: 'alarm',  akce: 'lékař / hematolog' },
  bb_ok:      { val: 45, label: 'Body Battery dobrý ≥', unit: '',    stav: 'ok',     badge: 'normál', akce: 'trénink OK' },
  bb_warn:    { val: 35, label: 'Body Battery pozor ≥', unit: '',    stav: 'warn',   badge: 'pozor',  akce: 'nahradit chůzí' },
  sleep_warn: { val: 50, label: 'Skóre spánku pozor <', unit: '',    stav: 'warn',   badge: 'pozor',  akce: 'snížit intenzitu tréninku' },
  ready_ok:   { val: 80, label: 'Připravenost normál ≥', unit: '%',  stav: 'ok',     badge: 'normál', akce: 'trénink OK' },
  ready_warn: { val: 60, label: 'Připravenost pozor ≥', unit: '%',   stav: 'warn',   badge: 'pozor',  akce: 'lehčí pohyb' },
};
function loadT() {
  try { const s = stGet('garmin_thresholds'); if (s) { const p = JSON.parse(s), m = {}; for (const k in THRESH_DEF) m[k] = { ...THRESH_DEF[k], ...(p[k] || {}) }; return m; } } catch (e) {}
  return JSON.parse(JSON.stringify(THRESH_DEF));
}
let T = loadT();
function saveT() { const o = {}; for (const k in T) o[k] = { val: T[k].val }; stSet('garmin_thresholds', JSON.stringify(o)); }

// zóny grafů (stejné klíče jako původní dashboard): z1 / z2 + okno klouzavého průměru
const ZDEF = {
  hrv:  { key: 'garmin_vst_zones',  z1: 26, z2: 30, avgDays: 7, up: true,  l: 'HRV', u: 'ms' },
  rhr:  { key: 'garmin_hr_zones',   z1: 54, z2: 57, avgDays: 7, up: false, l: 'Klidová TF', u: 'bpm' },
  bb:   { key: 'garmin_bb_zones',   z1: 35, z2: 50, avgDays: 7, up: true,  l: 'Body Battery ráno', u: '' },
  resp: { key: 'garmin_resp_zones', z1: 16, z2: 19, avgDays: 7, up: false, l: 'Dýchání', u: 'dech/min' },
};
function zones(m) { const z = ZDEF[m]; if (!z) return null; try { const p = JSON.parse(stGet(z.key) || 'null'); if (p) return { ...z, z1: +p.z1 || z.z1, z2: +p.z2 || z.z2, avgDays: +p.avgDays || z.avgDays }; } catch (e) {} return { ...z }; }
function zoneSave(m, z) { stSet(ZDEF[m].key, JSON.stringify({ z1: z.z1, z2: z.z2, avgDays: z.avgDays })); }
// barva podle zóny: up = vyšší je lepší (HRV, BB), jinak nižší je lepší (TF, dýchání)
function zoneCol(m, v) { const z = zones(m); if (!z || v == null) return tok('--blue'); if (z.up) return v < z.z1 ? tok('--red') : v < z.z2 ? tok('--amber') : tok('--green'); return v <= z.z1 ? tok('--green') : v <= z.z2 ? tok('--amber') : tok('--red'); }

// ── vzhled ──
function uiGet() { try { return JSON.parse(stGet('garmin_ui') || '{}') || {}; } catch (e) { return {}; } }
// garmin_ui se na Disku ukládá nejvýš 10 000 znaků (ghSet) → hlídat tady, nikdy neuložit useknutý JSON
const UI_MAX = 9500;
function uiSet(o) { const j = JSON.stringify(o); if (j.length > UI_MAX) { toast('Neuloženo — data rozhraní by přesáhla ' + UI_MAX + ' znaků'); return false; } stSet('garmin_ui', j); return true; }
function themeSet(t) { document.documentElement.toggleAttribute('data-theme', t === 'graphite'); if (t === 'graphite') document.documentElement.setAttribute('data-theme', 'graphite'); try { localStorage.setItem('gh_theme', t); } catch (e) {} renderAll(); }

// ══════════ DATA ══════════
async function fetchData() {
  if (CLOUD) return take(await gsRun('ghGet', CLOUD.key), 'cloud');
  const r = await fetch(`${API}/data`, { cache: 'no-store' });
  if (!r.ok) throw new Error('Lokální server: HTTP ' + r.status);
  try { const s = await fetch(`${API}/settings`, { cache: 'no-store' }); if (s.ok) { const st = await s.json(); migrateLocal(st); stApply(st); } } catch (e) {}
  let journal = null; try { const j = await (await fetch(`${API}/journal`, { cache: 'no-store' })).json(); if (j.ok) journal = j.journal; } catch (e) {}
  return take({ ok: true, data: await r.json(), journal: journal, at: new Date().toISOString(), ageH: 0 }, 'local');
}
// stará lokální verze měla prahy jen v localStorage prohlížeče → jednorázově na Disk
function migrateLocal(st) { ST_KEYS.forEach(k => { if (!(k in st)) { let v = null; try { v = localStorage.getItem(k); } catch (e) {} if (v != null) stQueue(k, v); } }); }
function take(r, src) {
  stApply(r.settings);
  if (r.journal) JR = { days: r.journal.days || {}, cfg: r.journal.cfg || {}, food: r.journal.food || {} };
  if (!r.ok || !r.data) throw new Error(r.error || 'Data se nepodařilo načíst');
  if (r.data.error) throw new Error(r.data.error);
  DATA = r.data;
  const se = r.sync && !r.sync.ok ? r.sync.error : (r.sync && r.sync.errs && r.sync.errs.length ? r.sync.errs.join(' · ') : null);
  META = { src: src, at: r.at || DATA.exported_at, ageH: r.ageH || 0, stale: !!r.stale, warn: se ? 'Sync z Garminu: ' + se : (DATA.warn || null), jerr: r.journalErr || null, ierr: r.inboxErr || null };
  buildDays();
  return DATA;
}
// jednotná tabulka dní: cloud dává `days`, lokální režim se skládá z nocí a HRV historie
function buildDays() {
  let rows = Array.isArray(DATA.days) && DATA.days.length ? DATA.days.map(x => ({ ...x, a: x.a || [] })) : null;
  if (!rows) {
    const m = {};
    (DATA.nights || []).forEach(n => { const d = n.date || n.calendar_date; if (!d) return; m[d] = { d: d, sc: num(n.score), sh: num(n.hours), rhr: num(n.hr), bb: num(n.bb), rs: num(n.resp), st: null, stp: null, hrv: num(n.hrv), a: [] }; });
    (DATA.hrv_history || []).forEach(h => { if (!h.date) return; (m[h.date] = m[h.date] || { d: h.date, a: [] }).hrv = num(h.hrv); });
    rows = Object.values(m);
  }
  const nm = {}; (DATA.nights || []).forEach(n => { nm[n.date || n.calendar_date] = n; });
  const hm_ = {}; (DATA.hrv_history || []).forEach(h => { hm_[h.date] = h; });
  rows.forEach(x => { const n = nm[x.d]; if (n) { x.deep = num(n.deep_min); x.rem = num(n.rem_min); x.light = num(n.light_min); x.awake = num(n.awake_min); if (x.rs == null) x.rsN = num(n.resp); else x.rsN = num(n.resp); }
    const h = hm_[x.d]; if (h) { x.bl = num(h.baseline_low); x.bu = num(h.baseline_upper); } });
  DAYS = rows.sort((a, b) => a.d < b.d ? -1 : 1); BYD = {}; DAYS.forEach(x => { BYD[x.d] = x; });
}

async function doSync() {
  const b = $('syncBtn'); b.disabled = true; b.classList.add('loading'); b.querySelector('span').textContent = 'Stahuji…';
  try {
    if (CLOUD) take(await gsRun('ghSync', CLOUD.key), 'cloud');
    else { await fetch(`${API}/sync`, { cache: 'no-store' }); await new Promise(r => setTimeout(r, 28000)); await fetchData(); }
    dataNote(); renderAll(); toast('Data z Garminu aktualizována');
  } catch (e) { note(esc(e.message || e), 'err'); }
  finally { b.disabled = false; b.classList.remove('loading'); b.querySelector('span').textContent = 'Sync'; }
}
function dataNote() {
  if (META && META.stale) note(`Data jsou stará ${Math.round(META.ageH)} h — sync z Garminu neprobíhá. Zkontroluj synchronizaci hodinek s telefonem a klíč Personal API (vyprší nejvýš za rok).`, 'warn');
  else if (META && META.warn) note(esc(META.warn), 'warn');
  else if (META && META.jerr) note('Deník se nepodařilo načíst: ' + esc(META.jerr), 'warn');
  else if (META && META.ierr) note('Záznam z chatu se nepodařilo převzít do deníku: ' + esc(META.ierr), 'warn');
  else note(null);
}
function ageText() {
  if (!META) return '—';
  const t = new Date(META.at), s = t.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (META.src === 'cloud' ? 'sync ' : 'načteno ') + s + (META.src === 'cloud' && META.ageH >= 1 ? ` · před ${Math.round(META.ageH)} h` : '');
}

// ══════════ PŘIPRAVENOST ══════════
// Garmin Personal API Training Readiness nevrací → odhad z dostupných složek (vážený průměr 0–100):
// HRV 35 % (poslední noc v pásmu baseline: dolní mez = 50, horní = 100), skóre spánku 30 %, Body Battery při probuzení 20 %,
// klidová TF 15 % (každý tep nad 7denním průměrem −10). Orientační — není to Garminův algoritmus.
const clamp100 = v => Math.max(0, Math.min(100, v));
function readinessOf() {
  const r = DATA.readiness || {};
  if (r.score != null) return { score: r.score, est: false, parts: [] };
  const h = DATA.hrv || {}, d = DATA.daily || {}, sl = DATA.sleep_latest || {}, parts = [];
  const hv = h.last_night_avg, lo = h.baseline_low, up = h.baseline_upper;
  if (hv != null && lo != null && up != null && up > lo) parts.push(['HRV', 35, clamp100(50 + 50 * (hv - lo) / (up - lo))]);
  if (sl.sleep_score_overall != null) parts.push(['Spánek', 30, clamp100(sl.sleep_score_overall)]);
  if (d.body_battery_at_wake != null) parts.push(['Body Battery', 20, clamp100(d.body_battery_at_wake)]);
  const rhr = d.resting_heart_rate ?? sl.resting_heart_rate, r7 = d.avg_resting_heart_rate_7day;
  if (rhr != null && r7 != null) parts.push(['Klidová TF', 15, clamp100(100 - 10 * (rhr - r7))]);
  if (!parts.length) return { score: null, est: true, parts };
  const w = parts.reduce((a, p) => a + p[1], 0);
  return { score: Math.round(parts.reduce((a, p) => a + p[1] * p[2], 0) / w), est: true, parts };
}
function alertsOf() {
  const h = DATA.hrv || {}, d = DATA.daily || {}, sl = DATA.sleep_latest || {}, al = [];
  const hrv = h.last_night_avg ?? sl.avg_overnight_hrv ?? 0, hr = d.resting_heart_rate ?? sl.resting_heart_rate ?? 0;
  const bb = d.body_battery_at_wake ?? d.body_battery_most_recent ?? 0, sc = sl.sleep_score_overall ?? 0;
  if (hrv > 0 && hrv < T.hrv_warn.val) al.push({ t: 'crit', h: `HRV kritická: ${hrv} ms`, b: 'Žádný trénink. Při příznacích kontaktovat lékaře.' });
  else if (hrv > 0 && hrv < T.hrv_ok.val) al.push({ t: 'warn', h: `HRV nízká: ${hrv} ms`, b: `Pod baselineem (${h.baseline_low ?? T.hrv_ok.val}–${h.baseline_upper ?? '—'} ms). Lehčí pohyb.` });
  else if (hrv > 0) al.push({ t: 'ok', h: `HRV v normálu: ${hrv} ms`, b: 'Nervový systém se dobře regeneruje.' });
  if (hr > T.hr_danger.val) al.push({ t: 'crit', h: `Klidová TF kritická: ${hr} bpm`, b: 'Lékař nebo hematolog.' });
  else if (hr > T.hr_warn.val) al.push({ t: 'warn', h: `Klidová TF zvýšená: ${hr} bpm`, b: 'Sledovat 2–3 dny.' });
  if (bb > 0 && bb < T.bb_warn.val) al.push({ t: 'warn', h: `Body Battery nízká: ${bb}`, b: 'Náročný trénink dnes nevhodný.' });
  if (sc > 0 && sc < T.sleep_warn.val) al.push({ t: 'warn', h: `Skóre spánku nízké: ${sc}`, b: 'Snížit intenzitu tréninku. Priorita: spánek a regenerace.' });
  return al;
}

// ══════════ DENÍK ══════════
const TAGS = [
  { g: 'Jídlo a pití', items: [
    { id: 'alk', l: 'Alkohol', c: 1, u: 'skl.' }, { id: 'kava', l: 'Káva', c: 1, u: '×' }, { id: 'kava_pozde', l: 'Káva po 14 h' },
    { id: 'vecere_pozde', l: 'Pozdní večeře' }, { id: 'tezke', l: 'Těžké / tučné jídlo' }, { id: 'sladke', l: 'Sladké' },
    { id: 'malo_vody', l: 'Málo vody' }, { id: 'hodne_vody', l: 'Hodně vody' } ] },
  { g: 'Pohyb a regenerace', items: [
    { id: 'otuz', l: 'Otužování' }, { id: 'sauna', l: 'Sauna' }, { id: 'med', l: 'Meditace', c: 5, u: 'min' }, { id: 'dech', l: 'Dechová cvičení' },
    { id: 'strecink', l: 'Strečink / jóga' }, { id: 'venku', l: 'Procházka venku' } ] },
  { g: 'Stres a zdraví', items: [
    { id: 'stres', l: 'Pracovní stres' }, { id: 'cesta', l: 'Cestování' }, { id: 'nemoc', l: 'Nemoc / nachlazení' }, { id: 'bolest', l: 'Bolest' },
    { id: 'nalada', l: 'Špatná nálada' }, { id: 'pozde_spat', l: 'Pozdě do postele' }, { id: 'obrazovka', l: 'Obrazovka před spaním' } ] },
];
const QUICK = ['alk', 'kava_pozde', 'vecere_pozde', 'stres', 'otuz', 'med', 'pozde_spat', 'nemoc'];
const MEAL_S = [['sn', 'Snídaně'], ['ob', 'Oběd'], ['ve', 'Večeře'], ['sv', 'Svačina']];
const tagById = id => { for (const g of TAGS) for (const t of g.items) if (t.id === id) return t; const c = (JR.cfg.tags || []).find(x => x.id === id); return c ? { id: c.id, l: c.l } : null; };
const jDay = d => JR.days[d] || null;
function jEdit(d) { const j = JR.days[d] ? JSON.parse(JSON.stringify(JR.days[d])) : {}; j.t = j.t || {}; j.m = j.m || []; j.sup = j.sup || []; return j; }
const mealHas = m => m && (m.w || m.h || (m.it || []).length);
function jEmpty(j) { return !Object.keys(j.t || {}).some(k => j.t[k] > 0) && !(j.m || []).some(mealHas) && !(j.sup || []).length && !(j.n || '').trim() && j.kg == null; }
const jSaveT = {};
function jPut(d, j) {
  // úklid: nulové štítky a prázdná jídla pryč
  Object.keys(j.t).forEach(k => { if (!(j.t[k] > 0)) delete j.t[k]; });
  j.m = (j.m || []).filter(mealHas);
  if (jEmpty(j)) delete JR.days[d]; else JR.days[d] = j;
  jStatus('Ukládám…');
  clearTimeout(jSaveT[d] && jSaveT[d].t); jSaveT[d] = { _pending: true, t: setTimeout(() => { jSaveT[d]._pending = false; jFlush(d); }, 700) };
}
const jBusy = {}, jAgain = {};
async function jFlush(d) {
  if (jBusy[d]) { jAgain[d] = true; return; }   // jeden zápis dne naráz — jinak by druhý nesl staré „at“ a hlásil souběh sám se sebou
  jBusy[d] = true;
  const day = JR.days[d] || {};
  try {
    const r = CLOUD ? await gsRun('ghJournalSet', CLOUD.key, d, JSON.stringify(day))
      : await (await fetch(`${API}/journal`, { method: 'POST', body: JSON.stringify({ date: d, day: day }), headers: { 'Content-Type': 'text/plain' } })).json();
    if (r.conflict) { jAgain[d] = false; if (r.day) JR.days[d] = r.day; else delete JR.days[d]; renderPage(); jStatus('Deník se mezitím změnil (záznam z chatu) — načteno znovu, zopakuj poslední změnu', true); return; }
    if (!r.ok) throw new Error(r.error || 'neznámá chyba');
    if (r.at && JR.days[d]) JR.days[d].at = r.at;
    jStatus('Uloženo ✓');
  } catch (e) { jStatus('Neuloženo: ' + (e.message || e), true); }
  finally { jBusy[d] = false; if (jAgain[d]) { jAgain[d] = false; jFlush(d); } }
}
// návrat na stránku (telefon z pozadí) → čerstvá data i deník, ať se nepřepíše, co mezitím přišlo z chatu
let lastFetch = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || Date.now() - lastFetch < 120e3 || Object.values(jBusy).some(Boolean) || Object.keys(jSaveT).some(k => jSaveT[k] && jSaveT[k]._pending)) return;
  lastFetch = Date.now();
  try { await fetchData(); dataNote(); renderAll(); } catch (e) {}
});
function jStatus(t, err) { const el = $('jst'); if (el) { el.textContent = t; el.classList.toggle('err', !!err); } }
async function jCfgSave() {
  try {
    const r = CLOUD ? await gsRun('ghJournalCfg', CLOUD.key, JSON.stringify(JR.cfg))
      : await (await fetch(`${API}/journal-cfg`, { method: 'POST', body: JSON.stringify(JR.cfg), headers: { 'Content-Type': 'text/plain' } })).json();
    if (!r.ok) throw new Error(r.error); toast('Uloženo');
  } catch (e) { note('Nastavení deníku se neuložilo: ' + esc(e.message || e), 'warn'); }
}

// ══════════ VLIVY ══════════
// Faktor dne D (večer / během dne) → výsledek ráno D+1 (Garmin přiřazuje spánek a HRV k datu probuzení).
// Výsledek se porovnává s osobním průměrem předchozích 14 rán (min. 5 hodnot) — tím se odfiltruje dlouhodobý trend.
// Efekt = průměrná odchylka dnů S faktorem − dnů BEZ něj; Welchův t. Štítky deníku se hodnotí jen ve dnech, kdy je deník
// vyplněný (nevyplněný den ≠ „bez alkoholu“); údaje z Garminu (trénink, otužování, kroky, stres) platí pro všechny dny.
const OUT = {
  hrv: { l: 'HRV', u: 'ms', k: 'hrv', better: 1, d: 0 },
  sc:  { l: 'Skóre spánku', u: 'b.', k: 'sc', better: 1, d: 0 },
  rhr: { l: 'Klidová TF', u: 'bpm', k: 'rhr', better: -1, d: 1 },
  bb:  { l: 'Body Battery ráno', u: '', k: 'bb', better: 1, d: 0 },
};
const acts = d => (BYD[d] && BYD[d].a) || [];
const isTrain = a => (a.l || 0) >= 20;
function factors() {
  const J = d => jDay(d), tg = (d, id, min) => { const j = J(d); return j ? ((j.t && j.t[id] || 0) >= (min || 1) ? 1 : 0) : null; };
  const F = [];
  TAGS.forEach(g => g.items.forEach(t => F.push({ id: 't:' + t.id, l: t.l, g: g.g, src: 'deník', f: d => tg(d, t.id) })));
  F.push({ id: 't:alk2', l: 'Alkohol 2+ sklenky', g: 'Jídlo a pití', src: 'deník', f: d => tg(d, 'alk', 2) });
  F.push({ id: 'm:late', l: 'Jídlo po 20 h', g: 'Jídlo a pití', src: 'deník', f: d => { const j = J(d); if (!j) return null; return (j.m || []).some(m => (m.h || '') >= '20:00') || (j.t || {}).vecere_pozde ? 1 : 0; } });
  (JR.cfg.tags || []).forEach(t => F.push({ id: 't:' + t.id, l: t.l, g: 'Vlastní', src: 'deník', f: d => tg(d, t.id) }));
  (JR.cfg.sup || []).forEach(s => F.push({ id: 's:' + s.id, l: s.l, g: 'Doplňky', src: 'deník', f: d => { const j = J(d); return j ? ((j.sup || []).includes(s.id) ? 1 : 0) : null; } }));
  const hasDay = d => !!BYD[d];
  const gF = (id, l, fn) => F.push({ id: id, l: l, g: 'Z Garminu', src: 'Garmin', f: d => hasDay(d) ? (fn(d) ? 1 : 0) : null });
  gF('g:train', 'Trénink (zátěž ≥ 20)', d => acts(d).some(isTrain));
  gF('g:hard', 'Tvrdý trénink (zátěž ≥ 100 / TE ≥ 3,5)', d => acts(d).some(a => (a.l || 0) >= 100 || (a.te || 0) >= 3.5));
  gF('g:late', 'Trénink po 18 h', d => acts(d).some(a => isTrain(a) && a.h >= 18));
  gF('g:cold', 'Otužování (Garmin + deník)', d => acts(d).some(a => sportOf(a) === 'otuz') || tg(d, 'otuz') === 1);
  gF('g:sauna', 'Sauna (Garmin + deník)', d => acts(d).some(a => /sauna/i.test(a.n || '')) || tg(d, 'sauna') === 1);
  gF('g:med', 'Meditace / dech (Garmin + deník)', d => acts(d).some(a => /medit|breath|dech/i.test((a.n || '') + ' ' + (a.k || ''))) || tg(d, 'med') === 1 || tg(d, 'dech') === 1);
  gF('g:steps', 'Kroky ≥ 10 000', d => (BYD[d].stp || 0) >= 10000);
  gF('g:stress', 'Stresový den (Ø stres ≥ 40)', d => (BYD[d].st || 0) >= 40);
  // jídlo z databáze — jen dny s položkami (jinak null); hranice „hodně / málo“ = horní / dolní čtvrtina tvých vlastních dnů, nebo cíl
  const ND = {}; Object.keys(JR.days).forEach(d => { const n = nutDay(d); if (n) ND[d] = n; });
  const nds = Object.values(ND), q = (k, p) => { const v = nds.map(x => x[k]).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };
  const G = goals(), kHi = q('k', .75), kLo = q('k', .25), pLo = G.p ? G.p * .8 : q('p', .25);
  const nF = (id, l, fn) => F.push({ id: id, l: l, g: 'Jídlo', src: 'jídlo', f: d => ND[d] ? (fn(ND[d], d) ? 1 : 0) : null });
  if (nds.length) {
    nF('n:khi', `Hodně kalorií (≥ ${fmt(Math.round(kHi))} kcal)`, n => n.k >= kHi);
    nF('n:klo', `Málo kalorií (≤ ${fmt(Math.round(kLo))} kcal)`, n => n.k <= kLo);
    nF('n:plo', `Málo bílkovin (< ${fmt(Math.round(pLo))} g)`, n => n.p < pLo);
    nF('n:ceve', 'Sacharidy hlavně večer (≥ 50 % po 18 h)', n => n.c > 0 && n.eveC >= n.c * .5);
    nF('n:late', 'Po 20 h aspoň 500 kcal', n => n.late >= 500);
    nF('n:def', 'Deficit ≥ 500 kcal proti Garminu', (n, d) => BYD[d] && num(BYD[d].kc) != null && n.k <= num(BYD[d].kc) - 500);
  }
  return F;
}
function influence(ok) {
  const o = OUT[ok], rows = [];
  DAYS.forEach(x => {
    const n = BYD[addD(x.d, 1)], y = n ? num(n[o.k]) : null; if (y == null) return;
    const prev = []; for (let i = 0; i < 14; i++) { const p = BYD[addD(x.d, -i)]; const v = p ? num(p[o.k]) : null; if (v != null) prev.push(v); }
    if (prev.length < 5) return;
    rows.push({ d: x.d, r: y - avg(prev) });
  });
  const res = factors().map(f => {
    const w = [], wo = [];
    rows.forEach(r => { const x = f.f(r.d); if (x == null) return; (x ? w : wo).push(r.r); });
    if (w.length < 3 || wo.length < 3) return { f, n1: w.length, n0: wo.length, ok: false };
    const e = avg(w) - avg(wo), se = Math.sqrt(vr(w) / w.length + vr(wo) / wo.length), t = se > 0 ? e / se : 0;
    return { f, n1: w.length, n0: wo.length, e, t, ok: true, good: e * o.better > 0 };
  });
  return { rows: rows.length, ok: res.filter(r => r.ok).sort((a, b) => Math.abs(b.t) - Math.abs(a.t)), few: res.filter(r => !r.ok && r.n1 > 0) };
}
function confPill(r) { return r.n1 < 8 ? '<span class="pill pill-ok">málo dat</span>' : Math.abs(r.t) >= 2 ? '<span class="pill pill-info">průkazné</span>' : '<span class="pill pill-ok">naznačuje</span>'; }
function infRows(res, o, max) {
  const m = Math.max(...res.map(r => Math.abs(r.e)), 0.0001);
  return res.slice(0, max || 99).map(r => {
    const w = Math.abs(r.e) / m * 50, col = tok(r.good ? '--green' : '--red');
    const bar = `<i style="background:${col};width:${w}%;${r.e >= 0 ? 'left:50%' : 'right:50%'}"></i>`;
    return `<div class="inf"><div class="inf-n">${esc(r.f.l)}<small>${esc(r.f.src)} · ${r.n1}× s, ${r.n0}× bez</small></div><div class="dbar">${bar}</div>`
      + `<div class="inf-v" style="color:${col}">${sgn(r.e, o.d)} ${esc(o.u)}<small>${confPill(r)}</small></div></div>`;
  }).join('');
}

// ══════════ VYKRESLENÍ ══════════
const IC = {
  dnes: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  trendy: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  denik: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>',
  vlivy: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  jidlo: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5a2 2 0 0 0 2 2M11 3v5a2 2 0 0 1-2 2"/><path d="M17 21V3c-2 1-3 3.5-3 7 0 1.6 1.3 3 3 3"/>',
  beh: '<circle cx="14.5" cy="4" r="2"/><path d="M7 21l3.5-6 3 2.5V22M6 11.5l3.5-3.5 4 1 2.5 3.5 3 1"/><path d="M10.5 15l1.5-5"/>',
  inov: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  nast: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const NAV = [['dnes', 'Dnes'], ['trendy', 'Trendy'], ['denik', 'Deník'], ['jidlo', 'Jídlo'], ['beh', 'Trénink'], ['vlivy', 'Vlivy'], ['inov', 'Inovace'], ['nast', 'Nastavení']];
// telefon: spodní lišta max 6 položek (dotyk ≥ 44 px na 390 px) — Vlivy a Inovace jsou ve Víc (= Nastavení), odznak Inovací se ukáže na Víc
const BNAV_SKIP = ['vlivy', 'inov'];
const svgI = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;
function navInit() {
  $('tabs').innerHTML = NAV.map(([k, l]) => `<button class="tab" data-p="${k}">${svgI(k)}${l}<span class="nb" data-nb="${k}"></span></button>`).join('');
  $('sidenav').innerHTML = '<div class="sn-gl">Garmin Health</div>' + NAV.map(([k, l]) => `<button class="sn-i" data-p="${k}">${svgI(k)}<span>${l}</span><span class="nb" data-nb="${k}"></span></button>`).join('')
    + '<div class="sn-foot" id="snfoot"></div>';
  $('bnav').innerHTML = NAV.filter(([k]) => !BNAV_SKIP.includes(k)).map(([k, l]) => `<button class="bnav-i" data-p="${k}">${svgI(k)}<span>${l === 'Nastavení' ? 'Víc' : l}</span><span class="nb" data-nb="${k === 'nast' ? 'inov' : k}"></span></button>`).join('');
  document.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => go(b.dataset.p)));
}
function go(p) {
  PAGE = p; try { history.replaceState(null, '', '#' + p); } catch (e) {}
  document.querySelectorAll('.page').forEach(s => s.classList.toggle('active', s.id === 'p-' + p));
  document.querySelectorAll('[data-p]').forEach(b => { const on = b.dataset.p === p; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderPage(); window.scrollTo(0, 0);
}
function renderAll() {
  $('age').textContent = ageText(); $('age').classList.toggle('stale', !!(META && META.stale));
  const f = $('snfoot'); if (f) f.innerHTML = DATA ? 'Data za ' + esc(dShort(DATA.date)) + '<br>' + esc(ageText()) : '';
  navBadges(); renderPage();
}
function navBadges() { const n = inovOpen().length; document.querySelectorAll('[data-nb="inov"]').forEach(b => { b.textContent = n || ''; b.title = n ? n + ' k hlasování' : ''; }); }
function renderPage() {
  if (!DATA) return;
  try { ({ dnes: renderDnes, trendy: renderTrendy, denik: renderDenik, jidlo: renderJidlo, beh: renderBeh, vlivy: renderVlivy, inov: renderInov, nast: renderNast })[PAGE](); }
  catch (e) { console.error(e); $('p-' + PAGE).innerHTML = '<div class="card empty">Chyba vykreslení: ' + esc(e.message || e) + '</div>'; }
}

// ── minigrafy ──
function spark(vals, col) {
  const v = vals.map(num), ok = v.filter(x => x != null); if (ok.length < 2) return '';
  const W = 200, H = 36, mn = Math.min(...ok), mx = Math.max(...ok), rg = mx - mn || 1;
  const pts = v.map((x, i) => x == null ? null : [i * W / (v.length - 1), H - 4 - (x - mn) / rg * (H - 8)]).filter(Boolean);
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${col}"/></svg>`;
}
function ring(score, col) {
  const r = 52, c = 2 * Math.PI * r, p = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return `<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="${tok('--bg4')}" stroke-width="10"/>`
    + `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/></svg>`
    + `<div class="ring-v"><div class="ring-n">${score == null ? '—' : score}</div><div class="ring-u">ze 100</div></div></div>`;
}
const last14 = k => { const out = []; for (let i = 13; i >= 0; i--) { const x = BYD[addD(TODAY(), -i)]; out.push(x ? x[k] : null); } return out; };
function avgK(k, n) { const v = []; for (let i = 0; i < n; i++) { const x = BYD[addD(TODAY(), -i)]; if (x && num(x[k]) != null) v.push(num(x[k])); } return v.length ? avg(v) : null; }
function pill(t, kind) { return `<span class="pill pill-${kind}">${esc(t)}</span>`; }

// ── budíky (z původního dashboardu): ručička = dnes, rysky = Ø 7 dní (modrá) a 14 dní (fialová) ──
function gauge(value, min, max, zones, unit, a7, a14) {
  const cx = 70, cy = 72, r = 54, sw = 12, P = v => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const pt = (v, rad) => { const a = Math.PI * (1 - P(v)); return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; };
  const arc = (v1, v2, col, w) => { if (v2 <= v1) return ''; const [x1, y1] = pt(v1, r), [x2, y2] = pt(v2, r);
    return `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0,1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${w || sw}"/>`; };
  const tick = (v, col, ro, ri) => { if (v == null) return ''; const [x1, y1] = pt(v, ro), [x2, y2] = pt(v, ri);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`; };
  const nd = value == null || isNaN(value), bg = tok('--bg'), z = zones.filter(x => x.to > x.from);
  let s = arc(min, max, tok('--bg4'), sw) + z.map(x => arc(x.from, x.to, x.c)).join('');
  s += z.slice(1).map(x => { const [x1, y1] = pt(x.from, r - sw / 2 - 1), [x2, y2] = pt(x.from, r + sw / 2 + 1); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${bg}" stroke-width="2"/>`; }).join('');
  s += tick(a14, tok('--purple'), r + sw / 2 + 9, r + sw / 2 + 2) + tick(a7, tok('--blue'), r + sw / 2 + 8, r + sw / 2 + 1);
  if (!nd) { const [nx, ny] = pt(value, r - 6); s += `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${tok('--text')}" stroke-width="2.2" stroke-linecap="round"/>`; }
  s += `<circle cx="${cx}" cy="${cy}" r="5" fill="${tok('--bg3')}" stroke="${tok('--text2')}" stroke-width="2"/>`;
  return `<svg class="gauge" viewBox="0 0 140 80" role="img" aria-label="${nd ? 'bez dat' : esc(String(value)) + ' ' + esc(unit || '')}">${s}</svg>`;
}
function gaugesHtml(v) {
  const G = tok('--green'), A = tok('--amber'), C = tok('--crit');
  const ca = v.ca ?? 50, a = (k, n) => { const x = avgK(k, n); return x == null ? null : Math.round(x); };
  const L = [
    { l: 'HRV', v: v.hrv, u: 'ms', min: 0, max: 55, z: [{ from: 0, to: T.hrv_warn.val, c: C }, { from: T.hrv_warn.val, to: T.hrv_ok.val, c: A }, { from: T.hrv_ok.val, to: 55, c: G }], a7: a('hrv', 7), a14: a('hrv', 14) },
    { l: 'Klidová TF', v: v.hr, u: 'bpm', min: 38, max: 75, z: [{ from: 38, to: T.hr_ok.val, c: G }, { from: T.hr_ok.val, to: T.hr_warn.val, c: A }, { from: T.hr_warn.val, to: 75, c: C }], a7: a('rhr', 7), a14: a('rhr', 14) },
    { l: 'Body Battery', v: v.bb, u: '', min: 0, max: 100, z: [{ from: 0, to: T.bb_warn.val, c: C }, { from: T.bb_warn.val, to: T.bb_ok.val, c: A }, { from: T.bb_ok.val, to: 100, c: G }], a7: a('bb', 7), a14: a('bb', 14) },
    { l: 'Připravenost', v: v.sc, u: '', min: 0, max: 100, z: [{ from: 0, to: T.ready_warn.val, c: C }, { from: T.ready_warn.val, to: T.ready_ok.val, c: A }, { from: T.ready_ok.val, to: 100, c: G }] },
    { l: 'Spánek', v: v.ss, u: '', min: 0, max: 100, z: [{ from: 0, to: T.sleep_warn.val, c: C }, { from: T.sleep_warn.val, to: 70, c: A }, { from: 70, to: 100, c: G }], a7: a('sc', 7), a14: a('sc', 14) },
    { l: 'Fitness věk', v: v.fa == null ? null : Math.round(v.fa * 10) / 10, u: 'let', min: 30, max: 65, z: [{ from: 30, to: ca, c: G }, { from: ca, to: ca + 5, c: A }, { from: ca + 5, to: 65, c: C }] },
  ];
  return L.map(g => `<div class="gc"><div class="lbl">${esc(g.l)}</div>${gauge(g.v, g.min, g.max, g.z, g.u, g.a7, g.a14)}`
    + `<div class="gc-v">${g.v == null ? '—' : esc(String(g.v))}<small>${esc(g.u)}</small></div>`
    + `<div class="gc-a">${g.a7 != null ? `<span class="g7">7d ${g.a7}</span>` : ''}${g.a14 != null ? `<span class="g14">14d ${g.a14}</span>` : ''}</div></div>`).join('');
}

// ── Krátce: co se zlepšuje / zhoršuje (tento týden vs minulý), série dní a vliv včerejška z deníku — jen z čísel, žádné domýšlení ──
const BRIEF_M = [
  { k: 'hrv', l: 'HRV', u: 'ms', b: 1, thr: 2, d: 0 }, { k: 'rhr', l: 'klidová TF', u: 'bpm', b: -1, thr: 1.5, d: 1 },
  { k: 'sc', l: 'skóre spánku', u: 'b.', b: 1, thr: 3, d: 0 }, { k: 'bb', l: 'Body Battery ráno', u: '', b: 1, thr: 5, d: 0 },
  { k: 'sh', l: 'délka spánku', u: 'h', b: 1, thr: 0.33, d: 1 }, { k: 'st', l: 'stres', u: '', b: -1, thr: 3, d: 0 },
];
function briefOf() {
  const ref = (DATA && DATA.date) || TODAY(), win = (k, from, n) => { const v = []; for (let i = from; i < from + n; i++) { const x = BYD[addD(ref, -i)]; if (x && num(x[k]) != null) v.push(num(x[k])); } return v; };
  const up = [], down = [], same = [];
  BRIEF_M.forEach(m => {
    const a = win(m.k, 0, 7), p = win(m.k, 7, 7); if (a.length < 4 || p.length < 4) return;
    const diff = avg(a) - avg(p), r = { m: m, now: avg(a), diff: diff };
    if (Math.abs(diff) < m.thr) same.push(r); else (diff * m.b > 0 ? up : down).push(r);
  });
  const rank = (x, y) => Math.abs(y.diff) / y.m.thr - Math.abs(x.diff) / x.m.thr; up.sort(rank); down.sort(rank);
  const fv = (v, m) => m.k === 'sh' ? hm(v) : fmt(v, m.d) + (m.u ? ' ' + m.u : ''), fd = (v, m) => m.k === 'sh' ? (v > 0 ? '+' : '−') + Math.round(Math.abs(v) * 60) + ' min' : sgn(v, m.d) + (m.u ? ' ' + m.u : '');
  const item = r => `<b>${esc(r.m.l)}</b> ${esc(fv(r.now, r.m))} (${esc(fd(r.diff, r.m))})`;
  const out = [];
  if (up.length) out.push({ k: 'up', h: 'Zlepšuje se', t: up.slice(0, 3).map(item).join(', ') });
  if (down.length) out.push({ k: 'down', h: 'Zhoršuje se', t: down.slice(0, 3).map(item).join(', ') });
  if ((up.length || down.length) && same.length) out.push({ k: 'eq', h: 'Beze změny', t: same.map(r => esc(r.m.l)).join(', ') });
  if (!up.length && !down.length && same.length) out.push({ k: 'eq', h: 'Stabilní týden', t: 'Žádná z hlavních hodnot se proti minulému týdnu výrazně nezměnila.' });
  // série: HRV klesá / TF roste aspoň 3 rána po sobě
  const streak = (k, dir) => { let n = 0; for (let i = 0; i < 10; i++) { const a = BYD[addD(ref, -i)], b = BYD[addD(ref, -i - 1)]; if (!a || !b || num(a[k]) == null || num(b[k]) == null || (num(a[k]) - num(b[k])) * dir <= 0) break; n++; } return n; };
  const sH = streak('hrv', -1), sR = streak('rhr', 1), sHu = streak('hrv', 1);
  if (sH >= 3) out.push({ k: 'down', h: 'Série', t: `HRV klesá <b>${sH}. ráno po sobě</b> — zvaž lehčí den a víc spánku.` });
  else if (sR >= 3) out.push({ k: 'down', h: 'Série', t: `Klidová TF roste <b>${sR}. ráno po sobě</b> — může jít o únavu nebo nástup nemoci.` });
  else if (sHu >= 3) out.push({ k: 'up', h: 'Série', t: `HRV roste <b>${sHu}. ráno po sobě</b>.` });
  // včerejšek z deníku: faktory s průkazným vlivem na HRV, které včera platily
  try {
    if (DAYS.length > 20) {
      const y = addD(ref, -1), inf = influence('hrv').ok.filter(r => Math.abs(r.t) >= 2 && r.n1 >= 8 && r.f.f(y) === 1 && !(r.f.id === 't:alk2'));
      if (inf.length) out.push({ k: inf[0].good ? 'up' : 'down', h: 'Včera', t: inf.slice(0, 2).map(r => `<b>${esc(r.f.l)}</b> — u tebe v průměru ${esc(sgn(r.e, 0))} ms HRV další ráno`).join('; ') + '.' });
    }
  } catch (e) {}
  return out;
}
function briefHtml() {
  const b = briefOf(); if (!b.length) return '';
  const ic = { up: '▲', down: '▼', eq: '■' };
  return `<div class="card brief"><div class="card-h"><div class="card-t">Krátce</div><span class="card-s">7 dní vs předchozích 7</span></div>`
    + b.map(x => `<div class="br br-${x.k}"><span class="br-i" aria-hidden="true">${ic[x.k]}</span><div><span class="br-h">${esc(x.h)}:</span> ${x.t}</div></div>`).join('') + '</div>';
}

// ── Dnes ──
function renderDnes() {
  const h = DATA.hrv || {}, d = DATA.daily || {}, sl = DATA.sleep_latest || {}, f = DATA.fitness || {}, a = DATA.last_activity || {};
  const R = readinessOf(), sc = R.score;
  const rk = sc == null ? 'ok' : sc >= T.ready_ok.val ? 'good' : sc >= T.ready_warn.val ? 'warn' : 'crit';
  const rcol = tok(rk === 'good' ? '--green' : rk === 'warn' ? '--amber' : rk === 'crit' ? '--crit' : '--text3');
  const rl = sc == null ? 'MÁLO DAT' : rk === 'good' ? 'TRÉNINK OK' : rk === 'warn' ? 'POSLECHNI TĚLO' : 'ODPOČÍVAT';
  const rd = sc == null ? 'Chybí HRV i spánek za poslední noc.' : rk === 'good' ? 'Metriky v normálu — náročnější trénink je v pořádku.' : rk === 'warn' ? 'Lehčí pohyb, žádný náročný trénink.' : 'Tělo potřebuje regeneraci.';
  const comp = R.parts.map(p => { const c = tok(p[2] >= 70 ? '--green' : p[2] >= 45 ? '--amber' : '--crit');
    return `<span class="t2">${esc(p[0])}</span><div class="bar"><i style="width:${p[2]}%;background:${c}"></i></div><span>${Math.round(p[2])}</span>`; }).join('');
  const al = alertsOf();
  const hrv = h.last_night_avg, hr = d.resting_heart_rate ?? sl.resting_heart_rate, bb = d.body_battery_at_wake ?? d.body_battery_most_recent, ss = sl.sleep_score_overall;
  const st = d.average_stress_level, fa = f.fitness_age != null ? Math.round(f.fitness_age * 10) / 10 : null;
  const tile = (l, v, u, p, sub, sp) => `<div class="card kpi"><div class="kpi-top"><span class="lbl">${l}</span>${p || ''}</div><div class="kpi-v">${v}<small>${u}</small></div><div class="kpi-s">${sub}</div>${sp || ''}</div>`;
  const hrvP = hrv == null ? '' : hrv >= T.hrv_ok.val ? pill('normál', 'ok') : hrv >= T.hrv_warn.val ? pill('nízká', 'amber') : pill('kritická', 'crit');
  const hrP = hr == null ? '' : hr > T.hr_danger.val ? pill('vysoká', 'crit') : hr > T.hr_warn.val ? pill('zvýšená', 'amber') : pill('normál', 'ok');
  const bbP = bb == null ? '' : bb >= T.bb_ok.val ? pill('dobrá', 'ok') : bb >= T.bb_warn.val ? pill('nízká', 'amber') : pill('kritická', 'crit');
  const ssP = ss == null ? '' : ss >= 70 ? pill('dobrý', 'ok') : ss >= T.sleep_warn.val ? pill('uspokojivý', 'amber') : pill('špatný', 'crit');
  const stP = st == null ? '' : st <= 25 ? pill('klid', 'ok') : st <= 50 ? pill('nízký', 'ok') : st <= 75 ? pill('střední', 'amber') : pill('vysoký', 'crit');
  const faP = fa == null ? '' : fa <= (f.chronological_age || 99) ? pill('mladší', 'ok') : pill('starší', 'amber');
  const hrv7 = avgK('hrv', 7), r7 = d.avg_resting_heart_rate_7day ?? avgK('rhr', 7);
  // Dnes jen výrazné vlivy (|t| ≥ 1,5, aspoň 5 dní s faktorem), bez odvozené varianty, když je vidět základní (Alkohol 2+ vs Alkohol)
  const infAll = DAYS.length > 20 ? influence('hrv').ok : [], ids = new Set(infAll.map(r => r.f.id));
  const inf = { ok: infAll.filter(r => Math.abs(r.t) >= 1.5 && r.n1 >= 5 && !(r.f.id === 't:alk2' && ids.has('t:alk'))) };
  const jt = TODAY(), jd = jEdit(jt);
  const quick = QUICK.map(id => chipHtml(tagById(id), jd, jt)).join('');
  const lastAct = a.activity_name ? `<div class="sm t2" style="margin-top:var(--sp-3)">Poslední aktivita: <b>${esc(a.activity_name)}</b> · ${esc(dShort(String(a.start_time_local || '').slice(0, 10)))}${a.duration_min ? ' · ' + fmt(a.duration_min) + ' min' : ''}${a.avg_hr ? ' · Ø TF ' + fmt(a.avg_hr) : ''}</div>` : '';
  $('p-dnes').innerHTML = `
  <div class="page-head"><div><div class="page-t">${esc(cap(dLong(TODAY())))}</div><div class="page-s">Data za ${esc(dShort(DATA.date))} · ${esc(ageText())}</div></div></div>
  ${briefHtml()}
  <div class="grid g-hero">
    <div class="card"><div class="hero">${ring(sc, rcol)}<div style="min-width:0;flex:1">
      <div class="lbl">${R.est ? 'Připravenost (odhad)' : 'Training Readiness'}</div>
      <div class="hero-l" style="color:${rcol}">${rl}</div><div class="hero-d">${rd}</div>
      ${R.parts.length ? `<div class="comp">${comp}</div>` : ''}
      ${R.est ? '<div class="xs muted" style="margin-top:var(--sp-2)">Odhad z HRV, spánku, Body Battery a klidové TF — Garmin readiness přes API nedává.</div>' : ''}
    </div></div>${lastAct}</div>
    <div class="card"><div class="card-h"><div class="card-t">Dnes hlídat</div></div>
      <div class="alerts">${al.length ? al.map(x => `<div class="alert a-${x.t}"><div><b>${esc(x.h)}</b><span class="t2">${esc(x.b)}</span></div></div>`).join('') : '<div class="muted sm">Žádná upozornění.</div>'}</div></div>
  </div>
  <div class="grid g-kpi">
    ${tile('HRV', fmt(hrv), 'ms', hrvP, `baseline ${fmt(h.baseline_low)}–${fmt(h.baseline_upper)} · 7d Ø ${fmt(hrv7)}`, spark(last14('hrv'), tok('--blue')))}
    ${tile('Klidová TF', fmt(hr), 'bpm', hrP, `7d Ø ${fmt(r7)}`, spark(last14('rhr'), tok('--blue')))}
    ${tile('Body Battery ráno', fmt(bb), '', bbP, `max ${fmt(d.body_battery_highest)} · teď ${fmt(d.body_battery_most_recent)}`, spark(last14('bb'), tok('--blue')))}
    ${tile('Spánek', fmt(ss), 'b.', ssP, `${hm(sl.sleep_hours)} · hluboký ${fmt(sl.deep_min)} min · REM ${fmt(sl.rem_min)} min`, spark(last14('sc'), tok('--blue')))}
    ${tile('Stres dne', fmt(st), '', stP, `max ${fmt(d.max_stress_level)} · dýchání ${fmt(d.avg_waking_respiration)}`, spark(last14('st'), tok('--blue')))}
    ${tile('Fitness věk', fa == null ? '—' : fmt(fa, 1), 'let', faP, `chronologický ${fmt(f.chronological_age)}`, '')}
  </div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Deník dnes</div><span class="save-st" id="jst"></span></div>
      <div class="chips" id="quick">${quick}</div>
      ${nutLine(jt) ? `<div class="sm" style="margin-top:var(--sp-3)">Jídlo: ${nutLine(jt)}</div>` : ''}
      <div style="margin-top:var(--sp-3);display:flex;gap:var(--sp-4);flex-wrap:wrap"><button class="lnk" data-go="jidlo">Jídlo a váha →</button><button class="lnk" data-go="denik">Celý deník →</button></div></div>
    <div class="card"><div class="card-h"><div class="card-t">Co nejvíc ovlivňuje tvé HRV</div><button class="lnk" data-go="vlivy">Vlivy →</button></div>
      ${inf.ok.length ? infRows(inf.ok, OUT.hrv, 3) : '<div class="muted sm">Zatím žádný výrazný vliv. Vlivy z Garminu (trénink, otužování, kroky, stres) se počítají z historie hned, vlivy z deníku se ukážou po ~2 týdnech zápisů.</div>'}</div>
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Budíky</div><span class="card-s"><span class="g7">▍Ø 7 dní</span> <span class="g14">▍Ø 14 dní</span></span></div>
    <div class="gauges">${gaugesHtml({ hrv: num(hrv), hr: num(hr), bb: num(bb), sc: sc, ss: num(ss), fa: fa, ca: f.chronological_age })}</div></div>`;
  bindChips($('quick'), jt);
  document.querySelectorAll('#p-dnes [data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
}

// ── čipy deníku ──
function chipHtml(t, j, d) {
  if (!t) return '';
  const v = (j.t || {})[t.id] || 0;
  if (t.c) return `<span class="chip${v ? ' on' : ''}" data-t="${t.id}" data-c="${t.c}">${esc(t.l)}<span class="cnt"><button type="button" data-a="-" aria-label="méně">−</button><b>${v ? v : 0}</b><button type="button" data-a="+" aria-label="více">+</button></span>${t.u ? '<span class="xs muted">' + esc(t.u) + '</span>' : ''}</span>`;
  return `<button type="button" class="chip${v ? ' on' : ''}" data-t="${t.id}" aria-pressed="${v ? 'true' : 'false'}">${esc(t.l)}</button>`;
}
function bindChips(root, d) {
  root.querySelectorAll('[data-t]').forEach(el => {
    const id = el.dataset.t, step = +el.dataset.c || 0;
    const upd = delta => { const j = jEdit(d), v = Math.max(0, (j.t[id] || 0) + delta); j.t[id] = v; jPut(d, j); const nj = jEdit(d), nv = nj.t[id] || 0;
      el.classList.toggle('on', nv > 0); if (step) el.querySelector('b').textContent = nv; else el.setAttribute('aria-pressed', nv ? 'true' : 'false'); };
    if (step) el.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); upd(b.dataset.a === '+' ? step : -step); }));
    else el.addEventListener('click', () => { const j = jEdit(d); upd(j.t[id] ? -1 : 1); });
  });
}

// ── Deník ──
function renderDenik() {
  const d = UI.jday || TODAY(), j = jEdit(d), x = BYD[d] || {}, sup = JR.cfg.sup || [], ctags = JR.cfg.tags || [];
  const actsH = (x.a || []).map(a => `<span class="chip auto">${esc(a.n || a.k)}${a.h != null ? ' · ' + a.h + ' h' : ''}${a.m ? ' · ' + a.m + ' min' : ''}${a.l ? ' · zátěž ' + a.l : ''}</span>`).join('');
  $('p-denik').innerHTML = `
  <div class="page-head"><div><div class="page-t">Deník</div><div class="page-s">Co jíš, piješ a děláš — Vlivy z toho počítají, co tvé HRV a spánek ovlivňuje.</div></div>
    <div class="daynav"><button class="btn" id="jprev" aria-label="Předchozí den">‹</button><div class="daynav-t">${esc(cap(dLong(d)))}</div>
    <button class="btn" id="jnext" aria-label="Další den" ${d >= TODAY() ? 'disabled' : ''}>›</button>${d !== TODAY() ? '<button class="btn btn-ghost" id="jtoday">Dnes</button>' : ''}</div></div>
  <div class="card"><div class="card-h"><div class="card-t">Štítky dne</div><span class="save-st" id="jst"></span></div>
    ${TAGS.map(g => `<div class="grp"><div class="lbl">${esc(g.g)}</div><div class="chips">${g.items.map(t => chipHtml(t, j, d)).join('')}</div></div>`).join('')}
    ${ctags.length ? `<div class="grp"><div class="lbl">Vlastní</div><div class="chips">${ctags.map(t => chipHtml({ id: t.id, l: t.l }, j, d)).join('')}</div></div>` : ''}
    <div class="grp"><div class="lbl">Doplňky a léky</div><div class="chips" id="jsup">${sup.length ? sup.map(s => `<button type="button" class="chip${j.sup.includes(s.id) ? ' on' : ''}" data-s="${esc(s.id)}">${esc(s.l)}</button>`).join('') : '<span class="muted sm">Seznam doplňků si nastav v <button class="lnk" data-go="nast">Nastavení</button>.</span>'}</div></div>
    ${actsH ? `<div class="grp"><div class="lbl">Z Garminu (automaticky)</div><div class="chips">${actsH}</div></div>` : ''}
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Jídlo a váha</div><button class="lnk" data-go="jidlo">Upravit v Jídle →</button></div>
    ${j.m.length ? `<div class="jsum">${j.m.map(m => `<div><span class="lbl">${esc((MEAL_S.find(x => x[0] === m.s) || ['', m.s])[1])}${m.h ? ' · ' + esc(m.h) : ''}</span> ${esc([...(m.it || []).map(it => (foodOf(it.f) || { l: '?' }).l + ' ' + it.g + ' g'), m.w].filter(Boolean).join(', '))}</div>`).join('')}</div>` : '<div class="muted sm">Zatím nic — zapiš v záložce Jídlo nebo nadiktuj Claudovi v chatu.</div>'}
    ${nutLine(d) ? `<div class="sm" style="margin-top:var(--sp-2)">${nutLine(d)}</div>` : ''}${j.kg != null ? `<div class="sm t2">Váha ${fmt(j.kg, 1)} kg</div>` : ''}</div>
  <div class="card"><div class="card-h"><div class="card-t">Poznámka</div></div>
    <textarea id="jnote" placeholder="Jak se cítíš, co bylo jinak…">${esc(j.n || '')}</textarea></div>`;
  const P = $('p-denik');
  bindChips(P, d);
  P.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { const jj = jEdit(d), id = b.dataset.s, i = jj.sup.indexOf(id); if (i >= 0) jj.sup.splice(i, 1); else jj.sup.push(id); jPut(d, jj); b.classList.toggle('on', i < 0); }));
  P.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('jprev').onclick = () => { UI.jday = addD(d, -1); renderDenik(); };
  $('jnext').onclick = () => { if (d < TODAY()) { UI.jday = addD(d, 1); renderDenik(); } };
  if ($('jtoday')) $('jtoday').onclick = () => { UI.jday = null; renderDenik(); };
  $('jnote').addEventListener('input', e => { const jj = jEdit(d); jj.n = e.target.value.slice(0, 2000); jPut(d, jj); });
}

// ── Vlivy ──
function renderVlivy() {
  const o = OUT[UI.out], R = influence(UI.out), nJ = Object.keys(JR.days).length;
  $('p-vlivy').innerHTML = `
  <div class="page-head"><div><div class="page-t">Vlivy</div><div class="page-s">Co je spojené s lepší nebo horší noční regenerací — z tvých dat.</div></div>
    <div class="seg" id="vout">${Object.keys(OUT).map(k => `<button data-k="${k}" class="${k === UI.out ? 'on' : ''}">${OUT[k].l}</button>`).join('')}</div></div>
  <div class="card"><div class="card-h"><div class="card-t">${esc(o.l)} ráno po dni s faktorem</div><span class="card-s">${R.rows} nocí · deník ${nJ} dní</span></div>
    <div class="legend" style="margin-bottom:var(--sp-3)"><span><i style="background:${tok('--green')}"></i>lepší než bez faktoru</span><span><i style="background:${tok('--red')}"></i>horší</span></div>
    ${R.ok.length ? infRows(R.ok, o) : '<div class="empty">Zatím málo dat pro porovnání. Každý faktor potřebuje aspoň 3 dny s ním a 3 bez něj.</div>'}
  </div>
  ${R.few.length ? `<div class="card"><div class="card-t" style="margin-bottom:var(--sp-2)">Zatím málo dat</div><div class="chips">${R.few.map(r => `<span class="chip auto">${esc(r.f.l)} · ${r.n1}×</span>`).join('')}</div></div>` : ''}
  <div class="card sm t2"><b class="t2">Jak to počítám.</b> Pro každý den porovnám ${esc(o.l)} následujícího rána s tvým průměrem předchozích 14 rán (tím odpadne dlouhodobý trend).
    Pak srovnám dny <i>s</i> faktorem a <i>bez</i> něj. Štítky z deníku počítám jen ve dnech, kdy je deník vyplněný. „Průkazné“ = rozdíl je aspoň 2× větší než jeho nejistota a vzorek ≥ 8 dní.
    Je to souvislost, ne důkaz příčiny — faktory se často vyskytují spolu (např. alkohol a pozdní večeře).</div>`;
  $('vout').querySelectorAll('button').forEach(b => b.onclick = () => { UI.out = b.dataset.k; renderVlivy(); });
}

// ── Trendy ──
const TR = [['hrv', 'HRV'], ['rhr', 'Klidová TF'], ['bb', 'Body Battery'], ['resp', 'Dýchání'], ['sleep', 'Spánek'], ['st', 'Stres'], ['kcal', 'Kalorie'], ['makra', 'Makra'], ['kg', 'Váha']];
const RANGES = [[14, '14 d'], [30, '30 d'], [90, '90 d'], [180, '180 d'], [0, 'Vše']];
let CH = null;
function renderTrendy() {
  const m = UI.trend, z = zones(m);
  const zEd = z ? `<div class="zones"><span class="lbl">Zóny</span><label>${z.up ? 'červená pod' : 'zelená do'} <input type="number" id="z1" value="${z.z1}"></label>
    <label>${z.up ? 'žlutá pod' : 'žlutá do'} <input type="number" id="z2" value="${z.z2}"></label><label>Klouzavý průměr <input type="number" id="za" value="${z.avgDays}" min="1" max="60"> dní</label></div>` : '';
  $('p-trendy').innerHTML = `
  <div class="page-head"><div><div class="page-t">Trendy</div><div class="page-s">Vývoj metrik s tvými zónami a klouzavým průměrem.</div></div>
    <div class="seg" id="trng">${RANGES.map(([v, l]) => `<button data-v="${v}" class="${v === UI.range ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  <div class="seg seg-scroll" id="tmet" style="margin-bottom:var(--sp-4)">${TR.map(([k, l]) => `<button data-k="${k}" class="${k === m ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="card"><div class="card-h"><div class="card-t" id="ttl"></div><div class="legend" id="tleg"></div></div>
    <div class="chart-box"><canvas id="tch"></canvas></div>${zEd}<div class="stats" id="tst"></div><div id="twk"></div></div>`;
  $('tmet').querySelectorAll('button').forEach(b => b.onclick = () => { UI.trend = b.dataset.k; renderTrendy(); });
  $('trng').querySelectorAll('button').forEach(b => b.onclick = () => { UI.range = +b.dataset.v; renderTrendy(); });
  if (z) ['z1', 'z2', 'za'].forEach(id => $(id).addEventListener('change', () => { const nz = { z1: +$('z1').value || z.z1, z2: +$('z2').value || z.z2, avgDays: Math.max(1, Math.min(60, +$('za').value || z.avgDays)) }; zoneSave(m, nz); drawTrend(); }));
  drawTrend();
}
function trendRows() { const from = UI.range ? addD(TODAY(), -UI.range + 1) : '0000'; return DAYS.filter(x => x.d >= from); }
function valOf(x, m) { return m === 'resp' ? num(x.rs ?? x.rsN) : m === 'sleep' ? num(x.sc) : num(x[m]); }
function drawTrend() {
  const m = UI.trend, rows = trendRows(), z = zones(m), labels = rows.map(x => dShort(x.d));
  if (CH) { CH.destroy(); CH = null; }
  const grid = tok('--grid'), t3 = tok('--text3'), font = { family: tok('--sans') || 'Inter', size: 11 };
  const base = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: tok('--bg4'), borderColor: tok('--border2'), borderWidth: 1, titleColor: tok('--text'), bodyColor: tok('--text2'), padding: 10, titleFont: font, bodyFont: font } },
    scales: { x: { ticks: { color: t3, font, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: grid } }, y: { ticks: { color: t3, font }, grid: { color: grid } } } };
  let title = '', leg = '';
  $('twk').innerHTML = '';
  if (m === 'kcal' || m === 'makra' || m === 'kg') {
    // dny podle kalendáře (i bez dat z Garminu), aby se jídlo a váha nepropadly
    const n = UI.range || Math.max(30, Object.keys(JR.days).length ? Math.round((Date.parse(TODAY()) - Date.parse(Object.keys(JR.days).sort()[0])) / 864e5) + 1 : 30);
    const dd = []; for (let i = n - 1; i >= 0; i--) dd.push(addD(TODAY(), -i));
    const lb = dd.map(dShort), NU = dd.map(nutDay), G = goals(), pr = rows.length > 90 ? 0 : 2;
    let ds;
    if (m === 'kcal') {
      title = 'Kalorie — snědeno vs spáleno (Garmin)';
      ds = [{ type: 'bar', label: 'Snědeno', data: NU.map(x => x ? Math.round(x.k) : null), backgroundColor: tok('--blue'), borderRadius: 2 },
        { type: 'line', label: 'Spáleno', data: dd.map(d => BYD[d] ? num(BYD[d].kc) : null), borderColor: tok('--text2'), pointRadius: pr, borderWidth: 1.6, tension: .25, spanGaps: true }];
      if (G.k) ds.push({ type: 'line', label: 'Cíl', data: dd.map(() => G.k), borderColor: tok('--amber'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.2 });
      leg = `<span><i style="background:${tok('--blue')}"></i>Snědeno</span><span><i style="background:${tok('--text2')}"></i>Spáleno (Garmin)</span>` + (G.k ? `<span><i style="background:${tok('--amber')}"></i>Cíl</span>` : '');
    } else if (m === 'makra') {
      title = 'Makroživiny — gramy za den';
      ds = [['p', 'Bílkoviny', '--blue'], ['f', 'Tuky', '--purple'], ['c', 'Sacharidy', '--teal']].map(([k, l, c]) => ({ type: 'bar', label: l + ' (g)', data: NU.map(x => x ? Math.round(x[k]) : null), backgroundColor: tok(c), stack: 'm', borderRadius: 2 }));
      leg = [['Bílkoviny', '--blue'], ['Tuky', '--purple'], ['Sacharidy', '--teal']].map(([l, c]) => `<span><i style="background:${tok(c)}"></i>${l}</span>`).join('');
    } else {
      title = 'Váha';
      const kv = dd.map(kgOf), roll = kv.map((_, i) => { const a = kv.slice(Math.max(0, i - 6), i + 1).filter(v => v != null); return a.length ? Math.round(avg(a) * 10) / 10 : null; });
      ds = [{ type: 'line', label: 'Váha (kg)', data: kv, borderColor: tok('--blue'), backgroundColor: tok('--blue'), pointRadius: 3, borderWidth: 1.4, spanGaps: true, tension: .2 },
        { type: 'line', label: 'Ø 7 d', data: roll, borderColor: tok('--text2'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.6, spanGaps: true, tension: .3 }];
      leg = `<span><i style="background:${tok('--blue')}"></i>Váha</span><span><i style="background:${tok('--text2')}"></i>Ø 7 dní</span>`;
    }
    CH = new Chart($('tch'), { data: { labels: lb, datasets: ds }, options: { ...base, scales: { x: { ...base.scales.x, stacked: m === 'makra' }, y: { ...base.scales.y, stacked: m === 'makra', beginAtZero: m !== 'kg' } } } });
    const logged = NU.filter(Boolean), kvs = dd.map(kgOf).filter(v => v != null), burn = dd.map((d, i) => NU[i] && BYD[d] && num(BYD[d].kc) != null ? NU[i].k - num(BYD[d].kc) : null).filter(v => v != null);
    $('tst').innerHTML = m === 'kg' ? stat('Poslední', kvs.length ? fmt(kvs[kvs.length - 1], 1) + ' kg' : '—') + stat('Min', kvs.length ? fmt(Math.min(...kvs), 1) : '—') + stat('Max', kvs.length ? fmt(Math.max(...kvs), 1) : '—') + stat('Změna za období', kvs.length > 1 ? sgn(kvs[kvs.length - 1] - kvs[0], 1) + ' kg' : '—') + stat('Vážení', fmt(kvs.length))
      : stat('Dny se zápisem', fmt(logged.length)) + stat('Ø kcal', kc(logged.length ? avg(logged.map(x => x.k)) : null)) + stat('Ø B / T / S', logged.length ? ['p', 'f', 'c'].map(k => fmt(Math.round(avg(logged.map(x => x[k]))))).join(' / ') + ' g' : '—') + stat('Ø bilance', burn.length ? sgn(Math.round(avg(burn)), 0) + ' kcal' : '—');
    // po týdnech (po–ne), nejnovější nahoře
    const wk = {}; dd.forEach((d, i) => { const dt = new Date(d + 'T12:00:00'), mo = addD(d, -((dt.getDay() + 6) % 7)); const w = wk[mo] = wk[mo] || { n: [], kg: [], b: [] };
      if (NU[i]) w.n.push(NU[i]); if (kgOf(d) != null) w.kg.push(kgOf(d)); if (NU[i] && BYD[d] && num(BYD[d].kc) != null) w.b.push(NU[i].k - num(BYD[d].kc)); });
    const wks = Object.keys(wk).sort().reverse().slice(0, 8).filter(k => wk[k].n.length || wk[k].kg.length);
    if (wks.length) $('twk').innerHTML = `<div class="lbl wk">Po týdnech (Ø ze dnů se zápisem)</div><div class="tbl-wrap"><table data-nogrid><thead><tr><th>Týden od</th><th>Dny</th><th>kcal</th><th>B</th><th>T</th><th>S</th><th>Bilance</th><th>Váha</th></tr></thead><tbody>`
      + wks.map(k => { const w = wk[k], a = f => w.n.length ? fmt(Math.round(avg(w.n.map(f)))) : '—';
        return `<tr><td>${esc(dShort(k))}</td><td>${w.n.length}</td><td>${a(x => x.k)}</td><td>${a(x => x.p)}</td><td>${a(x => x.f)}</td><td>${a(x => x.c)}</td><td>${w.b.length ? sgn(Math.round(avg(w.b)), 0) : '—'}</td><td>${w.kg.length ? fmt(avg(w.kg), 1) : '—'}</td></tr>`; }).join('') + '</tbody></table></div>';
  } else if (m === 'sleep') {
    title = 'Spánek — fáze a skóre';
    const H = k => rows.map(x => x[k] != null ? Math.round(x[k] / 6) / 10 : null);
    const ds = [['deep', 'Hluboký', '--s-deep'], ['rem', 'REM', '--s-rem'], ['light', 'Lehký', '--s-light'], ['awake', 'Bdění', '--s-awake']]
      .map(([k, l, c]) => ({ type: 'bar', label: l + ' (h)', data: H(k), backgroundColor: tok(c), stack: 's', yAxisID: 'y', borderRadius: 2 }));
    const hasStages = rows.some(x => x.deep != null);
    ds.push({ type: 'line', label: 'Skóre', data: rows.map(x => num(x.sc)), borderColor: tok('--text'), backgroundColor: tok('--text'), pointRadius: rows.length > 60 ? 0 : 2, borderWidth: 1.6, tension: .3, yAxisID: 'y2', spanGaps: true });
    if (!hasStages) ds.unshift({ type: 'bar', label: 'Spánek (h)', data: rows.map(x => num(x.sh)), backgroundColor: tok('--s-light'), yAxisID: 'y', borderRadius: 2 });
    CH = new Chart($('tch'), { data: { labels, datasets: hasStages ? ds : ds.filter(x => x.stack !== 's') }, options: { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true, title: { display: true, text: 'hodiny', color: t3, font } }, y2: { position: 'right', min: 0, max: 100, ticks: { color: t3, font }, grid: { display: false } } } } });
    leg = [['Hluboký', '--s-deep'], ['REM', '--s-rem'], ['Lehký', '--s-light'], ['Bdění', '--s-awake'], ['Skóre', '--text']].map(([l, c]) => `<span><i style="background:${tok(c)}"></i>${l}</span>`).join('');
    const sc = rows.map(x => num(x.sc)).filter(v => v != null), sh = rows.map(x => num(x.sh)).filter(v => v != null);
    const pct = k => { const a = rows.filter(x => x[k] != null && x.sh); return a.length ? avg(a.map(x => x[k] / 60 / x.sh * 100)) : null; };
    $('tst').innerHTML = stat('Ø skóre', fmt(avg(sc))) + stat('Ø délka', hm(avg(sh))) + stat('Hluboký', fmt(pct('deep')) + ' %') + stat('REM', fmt(pct('rem')) + ' %') + stat('Nocí', fmt(sc.length));
  } else {
    const L = { hrv: ['HRV — noční průměr', 'ms'], rhr: ['Klidová TF', 'bpm'], bb: ['Body Battery při probuzení', ''], resp: ['Dýchání', 'dech/min'], st: ['Průměrný stres dne', ''] }[m];
    title = L[0];
    const vals = rows.map(x => valOf(x, m)), win = z ? z.avgDays : 7;
    const roll = vals.map((_, i) => { const a = vals.slice(Math.max(0, i - win + 1), i + 1).filter(v => v != null); return a.length >= Math.min(3, win) ? Math.round(avg(a) * 10) / 10 : null; });
    const pc = vals.map(v => z ? zoneCol(m, v) : tok('--blue'));
    const ds = [{ type: 'line', label: L[0], data: vals, borderColor: tok('--blue'), pointBackgroundColor: pc, pointBorderColor: pc, pointRadius: rows.length > 90 ? 1.5 : 3, borderWidth: 1.4, tension: .25, spanGaps: true },
      { type: 'line', label: `Ø ${win} d`, data: roll, borderColor: tok('--text2'), borderDash: [5, 4], pointRadius: 0, borderWidth: 1.6, tension: .3, spanGaps: true }];
    if (m === 'hrv' && rows.some(x => x.bl != null)) {
      ds.push({ type: 'line', label: 'baseline dolní', data: rows.map(x => x.bl ?? null), borderColor: 'transparent', pointRadius: 0, spanGaps: true, fill: false });
      ds.push({ type: 'line', label: 'baseline horní', data: rows.map(x => x.bu ?? null), borderColor: 'transparent', backgroundColor: tok('--green-bg'), pointRadius: 0, spanGaps: true, fill: '-1' });
    }
    CH = new Chart($('tch'), { data: { labels, datasets: ds }, options: { ...base, plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, filter: it => !/baseline/.test(it.dataset.label) } } }, plugins: z ? [zoneBand(m)] : [] });
    leg = `<span><i style="background:${tok('--blue')}"></i>${esc(L[0])}</span><span><i style="background:${tok('--text2')}"></i>Ø ${win} d</span>` + (m === 'hrv' ? `<span><i style="background:${tok('--green-bg')};border:1px solid ${tok('--green')}"></i>baseline Garminu</span>` : '');
    const v = vals.filter(x => x != null), lastV = v.length ? v[v.length - 1] : null, a = avg(v);
    const prevRows = UI.range ? DAYS.filter(x => x.d < addD(TODAY(), -UI.range + 1) && x.d >= addD(TODAY(), -2 * UI.range + 1)).map(x => valOf(x, m)).filter(x => x != null) : [];
    const ch = prevRows.length && a != null ? a - avg(prevRows) : null;
    $('tst').innerHTML = stat('Poslední', fmt(lastV, m === 'resp' ? 1 : 0) + ' ' + L[1]) + stat('Průměr', fmt(a, 1)) + stat('Min', fmt(v.length ? Math.min(...v) : null)) + stat('Max', fmt(v.length ? Math.max(...v) : null))
      + stat('Změna vs předchozí období', ch == null ? '—' : sgn(ch, 1));
  }
  $('ttl').textContent = title; $('tleg').innerHTML = leg;
}
function stat(l, v) { return `<div class="stat"><span class="lbl">${esc(l)}</span><b>${v}</b></div>`; }
// barevná pásma zón za grafem
function zoneBand(m) {
  return { id: 'zb', beforeDatasetsDraw(c) {
    const z = zones(m), y = c.scales.y, a = c.chartArea, ctx = c.ctx; if (!z || !y) return;
    const band = (lo, hi, col) => { const t = Math.max(a.top, y.getPixelForValue(hi)), b = Math.min(a.bottom, y.getPixelForValue(lo)); if (b > t) { ctx.fillStyle = col; ctx.fillRect(a.left, t, a.right - a.left, b - t); } };
    ctx.save(); ctx.globalAlpha = .07;
    if (z.up) { band(y.min, z.z1, tok('--red')); band(z.z1, z.z2, tok('--amber')); band(z.z2, y.max, tok('--green')); }
    else { band(y.min, z.z1, tok('--green')); band(z.z1, z.z2, tok('--amber')); band(z.z2, y.max, tok('--red')); }
    ctx.restore();
  } };
}

// ── Nastavení ──
// ── Inovace ──
const VOTES = { ano: 'Chci', pozdeji: 'Později', ne: 'Nechci' };
const inovVotes = () => uiGet().inov || {};
const inovOpen = () => { const v = inovVotes(); return INOV.filter(x => x.st === 'navrh' && !(v[x.id] && v[x.id].v)); };
function inovVote(id, val, c) {
  const u = uiGet(); u.inov = u.inov || {}; const cur = u.inov[id] || {};
  if (val !== undefined) cur.v = cur.v === val ? '' : val;
  if (c !== undefined) cur.c = String(c).slice(0, 300);
  cur.at = TODAY(); if (!cur.v && !cur.c) delete u.inov[id]; else u.inov[id] = cur;
  if (uiSet(u)) { renderInov(); navBadges(); }
}
function inovCard(x, v) {
  const my = v[x.id] || {}, ef = ['bez vyplňování', '1 klepnutí denně', 'víc vyplňování'][x.vypl || 0];
  const src = x.url ? `<a class="lnk" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.zdroj)}</a>` : `<span>${esc(x.zdroj || '')}</span>`;
  const done = x.st === 'zavedeno' ? `<div class="iv-done">Zavedeno ${esc(dShort(x.done || ''))}${x.why ? ' — ' + esc(x.why) : ''}</div>` : x.st === 'zamitnuto' && x.why ? `<div class="iv-why t2 sm">${esc(x.why)}</div>` : '';
  const vote = x.st === 'navrh' ? `<div class="iv-vote">${Object.entries(VOTES).map(([k, l]) => `<button class="btn iv-b${my.v === k ? ' on iv-' + k : ''}" data-vote="${k}" aria-pressed="${my.v === k}">${l}</button>`).join('')}
      <button class="lnk iv-cbtn" data-c="1">${my.c ? 'Upravit poznámku' : 'Poznámka'}</button></div>
      <div class="iv-c"${my.c ? '' : ' hidden'}><textarea rows="2" maxlength="300" placeholder="Jak to chceš jinak, co ti na tom vadí…">${esc(my.c || '')}</textarea></div>` : '';
  return `<div class="iv" data-id="${esc(x.id)}"><div class="iv-top"><span class="iv-id">${esc(x.id)}</span><b class="iv-t">${esc(x.t)}</b>${pill(ef, x.vypl ? 'amber' : 'info')}</div>
    <div class="iv-co">${esc(x.co)}</div><div class="iv-jak t2 sm">${esc(x.jak)}</div>
    <div class="iv-meta xs muted">Návrh ${esc(dShort(x.d))} · ${src}${x.pavel ? ' · <span class="iv-pav">potřebuje tebe: ' + esc(x.pavel) + '</span>' : ''}</div>${done}${vote}</div>`;
}
function renderInov() {
  const v = inovVotes(), u = uiGet(), pod = u.pod || [], open = inovOpen();
  const yes = INOV.filter(x => x.st === 'navrh' && v[x.id] && v[x.id].v === 'ano');
  const later = INOV.filter(x => x.st === 'navrh' && v[x.id] && v[x.id].v === 'pozdeji');
  const zav = INOV.filter(x => x.st === 'zavedeno').sort((a, b) => (b.done || '').localeCompare(a.done || ''));
  const no = INOV.filter(x => x.st === 'zamitnuto' || (x.st === 'navrh' && v[x.id] && v[x.id].v === 'ne'));
  const sec = (t, s, arr, emp) => `<div class="card"><div class="card-h"><div class="card-t">${t} <span class="muted">${arr.length || ''}</span></div><span class="card-s">${s}</span></div>`
    + (arr.length ? arr.map(x => inovCard(x, v)).join('') : `<div class="muted sm">${emp}</div>`) + '</div>';
  const podRows = pod.slice().reverse().map(p => { const dn = INOV_POD_DONE[p.id];
    return `<div class="pod"><div><div>${esc(p.t)}</div><div class="xs muted">${esc(dShort(p.at))}${dn ? ' · vyřešeno ' + esc(dShort(dn.done)) + ' — ' + esc(dn.why) : ' · čeká na Clauda'}</div></div>`
      + (dn ? pill('hotovo', 'info') : `<button class="btn btn-ghost" data-rmpod="${esc(p.id)}" aria-label="Smazat podnět">✕</button>`) + '</div>'; }).join('');
  $('p-inov').innerHTML = `
  <div class="page-head"><div><div class="page-t">Inovace</div><div class="page-s">Každý týden pár návrhů od Clauda — hlavně takové, které nechtějí víc vyplňování. Co označíš „Chci“, zavedu.</div></div></div>
  ${sec('K hlasování', 'nové návrhy', open, 'Vše odhlasováno — nové návrhy přijdou o víkendu.')}
  <div class="card"><div class="card-h"><div class="card-t">Tvůj podnět</div><span class="card-s">co tě napadne — vyřeším při týdenní kontrole</span></div>
    <div class="row-add"><input id="npod" maxlength="300" placeholder="např. chci vidět vliv tréninku na spánek"><button class="btn" id="apod">Přidat</button></div>
    ${podRows ? '<div class="pods">' + podRows + '</div>' : ''}</div>
  ${sec('Schváleno — zavedu', 'při nejbližší týdenní kontrole', yes, 'Zatím nic. Klepni „Chci“ u návrhu výše.')}
  ${later.length ? sec('Možná později', 'vrátím se k nim', later, '') : ''}
  ${sec('Zavedeno', 'co už v aplikaci je', zav, 'Zatím nic.')}
  ${no.length ? `<details class="card iv-no"><summary class="card-t">Nechci / zamítnuto <span class="muted">${no.length}</span></summary>${no.map(x => inovCard(x, v)).join('')}</details>` : ''}`;
  const P = $('p-inov');
  P.querySelectorAll('.iv').forEach(el => { const id = el.dataset.id;
    el.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => inovVote(id, b.dataset.vote));
    const cb = el.querySelector('[data-c]'), box = el.querySelector('.iv-c');
    if (cb && box) { cb.onclick = () => { box.hidden = false; box.querySelector('textarea').focus(); };
      box.querySelector('textarea').addEventListener('change', e => inovVote(id, undefined, e.target.value.trim())); } });
  const add = () => { const t = $('npod').value.trim(); if (!t) return; const u2 = uiGet(); u2.pod = u2.pod || [];
    if (u2.pod.length >= 40) { toast('Max. 40 podnětů — počkej, až je vyřeším'); return; }
    u2.pod.push({ id: 'P-' + Date.now().toString(36), t: t.slice(0, 300), at: TODAY() }); if (uiSet(u2)) { toast('Podnět uložen'); renderInov(); } };
  $('apod').onclick = add; $('npod').onkeydown = e => { if (e.key === 'Enter') add(); };
  P.querySelectorAll('[data-rmpod]').forEach(b => b.onclick = () => { const u2 = uiGet(); u2.pod = (u2.pod || []).filter(x => x.id !== b.dataset.rmpod); if (uiSet(u2)) renderInov(); });
}

function renderNast() {
  const sup = JR.cfg.sup || [], tags = JR.cfg.tags || [], theme = document.documentElement.getAttribute('data-theme') === 'graphite' ? 'graphite' : 'slate';
  $('p-nast').innerHTML = `
  <div class="page-head"><div><div class="page-t">Nastavení</div><div class="page-s">Ukládá se na Google Disk — platí na PC, iPadu i iPhonu.</div></div></div>
  <div class="grid g-2 inov-link">
    <div class="card"><div class="card-h"><div class="card-t">Vlivy</div><button class="lnk" data-go="vlivy">Otevřít →</button></div>
      <div class="sm t2">Co nejvíc mění tvé HRV, spánek, klidovou TF a Body Battery.</div></div>
    <div class="card"><div class="card-h"><div class="card-t">Inovace</div><button class="lnk" data-go="inov">Otevřít →</button></div>
      <div class="sm t2">${inovOpen().length ? inovOpen().length + ' návrhů čeká na tvůj hlas.' : 'Vše odhlasováno — nové návrhy přijdou v neděli.'}</div></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Doplňky a léky</div><span class="card-s">zobrazí se v Deníku</span></div>
      <div class="list-ed" id="lsup">${sup.map(s => `<span class="chip">${esc(s.l)}<button data-rm="${esc(s.id)}" aria-label="Odebrat">✕</button></span>`).join('') || '<span class="muted sm">Zatím žádné.</span>'}</div>
      <div class="row-add"><input id="nsup" placeholder="např. Hořčík, D3, Omega-3" maxlength="40"><button class="btn" id="asup">Přidat</button></div></div>
    <div class="card"><div class="card-h"><div class="card-t">Vlastní štítky</div><span class="card-s">co chceš sledovat navíc</span></div>
      <div class="list-ed" id="ltag">${tags.map(s => `<span class="chip">${esc(s.l)}<button data-rm="${esc(s.id)}" aria-label="Odebrat">✕</button></span>`).join('') || '<span class="muted sm">Zatím žádné.</span>'}</div>
      <div class="row-add"><input id="ntag" placeholder="např. Masáž, Pozdní kofein z čaje" maxlength="40"><button class="btn" id="atag">Přidat</button></div></div>
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Prahové hodnoty</div><button class="btn btn-ghost" id="treset">Obnovit výchozí</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Metrika</th><th>Práh</th><th>Stav</th><th>Akce</th></tr></thead><tbody>
    ${Object.entries(T).map(([k, r]) => `<tr><td>${esc(r.label)}</td><td><input type="number" step="any" data-th="${k}" value="${r.val}"> <span class="xs muted">${esc(r.unit)}</span></td>
      <td>${pill(r.badge, r.stav === 'ok' ? 'ok' : r.stav === 'warn' ? 'amber' : 'crit')}</td><td class="t2">${esc(r.akce)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Vzhled</div></div>
      <div class="seg" id="theme"><button data-v="slate" class="${theme === 'slate' ? 'on' : ''}">Břidlice</button><button data-v="graphite" class="${theme === 'graphite' ? 'on' : ''}">Grafit</button></div></div>
    <div class="card"><div class="card-h"><div class="card-t">Data</div></div>
      <div class="sm t2">Zdroj: ${META.src === 'cloud' ? 'Garmin Personal API (Apps Script, ~každé 2 h)' : 'lokální server na PC'}<br>Poslední sync: ${esc(ageText())}<br>Dny v datech: ${DAYS.length} · deník: ${Object.keys(JR.days).length} dní</div>
      <div style="margin-top:var(--sp-3)"><button class="btn" id="nsync">Stáhnout teď</button></div></div>
  </div>`;
  const addTo = (key, inp) => { const l = $(inp).value.trim(); if (!l) return; const id = l.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || ('x' + Date.now());
    const arr = JR.cfg[key] = JR.cfg[key] || []; if (!arr.some(x => x.id === id)) arr.push({ id: id, l: l.slice(0, 40) }); jCfgSave(); renderNast(); };
  $('asup').onclick = () => addTo('sup', 'nsup'); $('atag').onclick = () => addTo('tags', 'ntag');
  $('nsup').onkeydown = e => { if (e.key === 'Enter') addTo('sup', 'nsup'); }; $('ntag').onkeydown = e => { if (e.key === 'Enter') addTo('tags', 'ntag'); };
  [['lsup', 'sup'], ['ltag', 'tags']].forEach(([el, key]) => $(el).querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { JR.cfg[key] = (JR.cfg[key] || []).filter(x => x.id !== b.dataset.rm); jCfgSave(); renderNast(); }));
  $('p-nast').querySelectorAll('[data-th]').forEach(i => i.addEventListener('change', () => { const v = parseFloat(i.value); if (isNaN(v)) { i.value = T[i.dataset.th].val; return; } T[i.dataset.th].val = v; saveT(); toast('Práh uložen'); }));
  $('treset').onclick = () => { stDel('garmin_thresholds'); T = loadT(); renderNast(); toast('Výchozí prahy obnoveny'); };
  $('theme').querySelectorAll('button').forEach(b => b.onclick = () => themeSet(b.dataset.v));
  $('nsync').onclick = doSync;
  $('p-nast').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
}

// ══════════ START ══════════
(async function init() {
  navInit();
  $('syncBtn').addEventListener('click', doSync);
  const h = (location.hash || '').slice(1); go(NAV.some(n => n[0] === h) ? h : 'dnes');
  try { await fetchData(); dataNote(); renderAll(); }
  catch (e) {
    note(CLOUD ? esc(e.message || e) : '<b>Lokální server neběží.</b> Hlavní dashboard běží v cloudu (adresa z Apps Scriptu). Offline: dvojklik na <b>Start Garmin Dashboard</b> na ploše.', 'err');
    $('p-' + PAGE).innerHTML = '<div class="card empty">Data nejsou k dispozici.</div>';
  }
})();
