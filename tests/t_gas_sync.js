// Test syncu přes Garmin Personal API v Apps Scriptu bez sítě a bez osobních dat:
// skutečný apps-script/garmin-apps-script.gs ve vm s modely služeb Apps Scriptu (Disk, Vlastnosti, mezipaměť, UrlFetchApp)
// a modelem Personal API — tvary odpovědí podle skutečných vzorků z 30.10.2026 (Garmin Data/garmin-api-vzorky.json):
// souhrny v2 ve skupinách, spánek plochý se sleepScores, Body Battery řada [čas, úroveň] + událost SLEEP, HRV hrvSummaries.
//   node tests/t_gas_sync.js   → zapíše tests/out/sample-api.json (pro test dashboardu)
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (n, c, i) => { console.log((c ? 'OK   ' : 'FAIL ') + n + (c || i == null ? '' : ' — ' + i)); if (!c) fails++; };

// ── model Personal API ──
const DAY = 864e5, TODAY = new Date(Date.now()).toISOString().slice(0, 10);
const add = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const range = (a, b) => { const o = []; for (let d = a; d <= b; d = add(d, 1)) o.push(d); return o; };
const idx = d => Math.round((Date.parse(d) - Date.parse('2020-01-01')) / DAY);
const jwt = () => 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url') + '.s';
const API = { calls: [], fail401once: true, maxSleepSpan: 14, maxSumSpan: 28 };
function api(url, opt) {
  const u = new URL(url), p = u.pathname, q = Object.fromEntries(u.searchParams), h = (opt && opt.headers) || {};
  API.calls.push(p + (u.search || ''));
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body) });
  if (p === '/personalapitoken-service/personal-api/personal-api-key/token') {
    if (h.Authorization !== 'ApiKey test-key' || h.Accept !== '*/*') return res(401, 'bad');
    return res(200, jwt());
  }
  if (!/^Bearer h\./.test(h.Authorization || '')) return res(401, '');
  if (API.fail401once) { API.fail401once = false; return res(401, ''); }   // vypršený token → nový a znovu
  let m;
  if ((m = p.match(/^\/hrv-service\/hrv\/daily\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/))) {
    const r = range(m[1], m[2]).filter(has); if (!r.length) return res(204, '');   // skutečné API: bez dat 204
    return res(200, { hrvSummaries: r.map(d => ({ calendarDate: d, weeklyAvg: 30, lastNightAvg: 24 + idx(d) % 9, lastNight5MinHigh: 41, status: 'BALANCED',
      baseline: { lowUpper: 25, balancedLow: 27, balancedUpper: 35, markerValue: 0.5 } })) });
  }
  if (p === '/usersummary-service/v2/dailysummaries') {
    const r = range(q.startDate, q.endDate); if (r.length > API.maxSumSpan) return res(400, '');
    return res(200, { data: r.filter(has).map(d => ({ uuid: 'u', userProfilePk: 1, calendarDate: d, source: 'garmin', includesWellnessData: true,
      movement: { steps: { goal: 99999, value: 9000 } }, calories: { burnedTotal: 2400, burnedActive: 520 },
      heartRate: { minValue: 48, maxValue: 140, restingValue: 51 + idx(d) % 3 }, stress: { avgLevel: 31, maxLevel: 88 },
      bodyBattery: { minValue: 18, maxValue: 92, chargedValue: 60, drainedValue: 55, latestValue: 47 }, respiration: { avgValue: 14.5 } })) });
  }
  if (p === '/sleep-service/sleep/dailySleepSummariesByDate') {
    const r = range(q.startDate, q.endDate); if (r.length > API.maxSleepSpan) return res(400, '');   // limit délky → kód musí rozsah zkrátit
    return res(200, r.filter(has).map(sleepObj));
  }
  if (p === '/sleep-service/sleep/dailySleep') return res(200, has(q.date) ? sleepObj(q.date) : { id: null, calendarDate: null, sleepTimeSeconds: null });   // den bez dat = objekt se samými null
  if (p === '/wellness-service/wellness/bodyBattery/reports/daily') {
    return res(200, range(q.startDate, q.endDate).filter(has).map(d => { const t0 = Date.parse(d + 'T00:00:00Z');
      return { date: d, charged: 60, drained: 55, bodyBatteryValuesArray: [[t0 - 3 * 3600e3, 30], [t0 + 5 * 3600e3, 78], [t0 + 12 * 3600e3, 55]],
        bodyBatteryActivityEvent: [{ eventType: 'SLEEP', durationInMilliseconds: 28e6, bodyBatteryImpact: 42 }] }; }));
  }
  if (p.startsWith('/fitnessage-service/fitnessage/v2/')) return res(200, { chronologicalAge: 50, fitnessAge: 44.4, achievableFitnessAge: 41 });
  if (p === '/activitylist-service/activities/search/activities') {
    // každý 3. den běh, každý 5. otužování (název „Cold Plunge“), dnes ráno běh; nejnovější první, stránkování start / limit
    const from = q.startDate || add(TODAY, -400), to = q.endDate || TODAY, all = [];
    range(from, to).filter(has).reverse().forEach(d => {
      if (d === TODAY || idx(d) % 3 === 0) { const i = idx(d), t3 = Math.floor(i / 3), km = d === TODAY ? 10 : 6 + t3 % 7, sp = 2.7 + (t3 % 4) * 0.15, tk = d === TODAY ? 'running' : ['running', 'trail_running', 'treadmill_running'][t3 % 3];
        all.push({ activityId: 9000000 + i, activityName: tk === 'trail_running' ? 'Olomouc - trail' : 'Běh', activityType: { typeKey: tk, typeId: 1 }, startTimeLocal: d + ' 07:00:00',
          duration: Math.round(km * 1000 / sp), movingDuration: Math.round(km * 1000 / sp) - 30, distance: km * 1000, averageSpeed: sp, maxSpeed: sp * 1.3,
          averageHR: 140 + i % 12, maxHR: 168, elevationGain: tk === 'trail_running' ? 210 : 35, averageRunningCadenceInStepsPerMinute: 166.4,
          avgStrideLength: 101.3, activityTrainingLoad: 120, aerobicTrainingEffect: 3.4, anaerobicTrainingEffect: 0.8, vO2MaxValue: 48 }); }
      if (idx(d) % 5 === 0) all.push({ activityName: 'Cold Plunge | 15.0°C', activityType: { typeKey: 'other' }, startTimeLocal: d + ' 06:30:00', duration: 180, distance: 0, averageHR: 72, activityTrainingLoad: 0.06 });
    });
    API.actQ = (API.actQ || 0) + 1;
    return res(200, all.slice(+q.start || 0, (+q.start || 0) + (+q.limit || 20)));
  }
  return res(404, '');
}
// dny, které má Garmin (hodinky synchronizované) — test „nesynchronizované hodinky“ posune hranici
API.lastSynced = null;
function has(d) { return !API.lastSynced || d <= API.lastSynced; }
function sleepObj(d) {
  const end = Date.parse(d + 'T05:30:00Z');
  return { id: 1, userProfilePK: 1, calendarDate: d, sleepTimeSeconds: 7 * 3600 + idx(d) % 5 * 600, deepSleepSeconds: 4800, lightSleepSeconds: 13200, remSleepSeconds: 5400, awakeSleepSeconds: 1200,
    averageRespirationValue: 14.1, avgSleepStress: 19, avgHeartRate: 53, sleepEndTimestampGMT: end, sleepScoreFeedback: 'POSITIVE',
    sleepScores: { totalDuration: { qualifierKey: 'GOOD' }, overall: { value: 70 + idx(d) % 15, qualifierKey: 'GOOD' } } };
}

// ── model Apps Scriptu ──
function gasEnv() {
  const props = {}, cache = {}, files = {}, mails = [];
  let fid = 0;
  const mkFile = (name, content) => { const f = { id: 'f' + (++fid), name, content, upd: new Date(), cr: new Date(Date.now() + fid), trashed: false };
    files[f.id] = f; return wrapF(f); };
  const wrapF = f => ({ getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, getLastUpdated: () => f.upd, getSize: () => Buffer.byteLength(f.content),
    setContent: c => { f.content = c; f.upd = new Date(); }, getDateCreated: () => f.cr, setTrashed: t => { f.trashed = !!t; }, setName: n => { f.name = n; }, getBlob: () => ({ getDataAsString: () => f.content }), getUrl: () => 'drive://' + f.id });
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const folder = { getId: () => 'folder', getName: () => 'Garmin Data', isTrashed: () => false, getUrl: () => 'drive://folder',
    getFilesByName: n => iter(Object.values(files).filter(f => f.name === n).map(wrapF)), getFiles: () => iter(Object.values(files).map(wrapF)), createFile: (n, c) => mkFile(n, c) };
  const env = {
    console, JSON, Date, Math, Object, Array, String, Number, Buffer, URL, encodeURIComponent, parseFloat, isFinite, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k in props ? props[k] : null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    UrlFetchApp: { fetch: (u, o) => api(u, o) },
    DriveApp: { getFolderById: () => folder, getRootFolder: () => ({ getFoldersByName: () => iter([folder]), createFolder: () => folder }) },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    Utilities: {
      formatDate: (d, tz, f) => { const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
        return f === 'yyyy-MM-dd' ? `${s.year}-${s.month}-${s.day}` : f === 'H' ? String(+s.hour) : f === 'HH:mm:ss' ? `${s.hour}:${s.minute}:${s.second}` : `${s.year}-w`; },
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => [...crypto.createHash(a).update(s).digest()],
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), base64Encode: b => Buffer.from(b).toString('base64'),
      base64DecodeWebSafe: s => [...Buffer.from(s.replace(/=+$/, ''), 'base64url')],
      newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('utf8') }), getUuid: () => crypto.randomUUID(),
    },
    MailApp: { sendEmail: (to, sub, body) => mails.push({ to, sub, body }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    Logger: { log: () => {} },
    ScriptApp: { getProjectTriggers: () => [] },
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/garmin-apps-script.gs'), 'utf8'), env);
  return { env, props, files, mails, folder, file: n => Object.values(files).find(f => f.name === n) };
}

// ── běhy ──
const G = gasEnv();
G.props.SYNC_KEY = 'k1';
let r = G.env.syncGarmin_({ manual: true });
ok('bez klíče = srozumitelná chyba', !r.ok && /GARMIN_API_KEY/.test(r.error), JSON.stringify(r));
G.props.GARMIN_API_KEY = 'test-key';
API.calls.length = 0;
r = G.env.syncGarmin_({ manual: true });
ok('backfill proběhl', r.ok && r.backfill && !r.partial, JSON.stringify(r));
ok('backfill: chyby kroků žádné', r.errs && r.errs.length === 0, JSON.stringify(r.errs));
ok('backfill dokončen (BF_DONE)', !!G.props.BF_DONE && !G.props.BF_STATE);
ok('401 → nový token a pokračování', API.calls.filter(c => c.startsWith('/personalapitoken')).length >= 2);
ok('HTTP 400 na délku spánku → rozsah zkrácen', API.calls.some(c => /dailySleepSummariesByDate/.test(c)) && r.nights >= 195, 'nocí ' + r.nights);
const backfillCalls = API.calls.length;
const data = JSON.parse(G.file('garmin-data.json').content);
const sample = fs.existsSync(path.join(OUT, 'sample.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'sample.json'), 'utf8')) : null;
if (sample) ok('stejné klíče jako local/garmin_data.py', ['daily', 'hrv', 'sleep_latest', 'readiness', 'training_status', 'fitness', 'nights', 'hrv_history', 'last_activity', 'date'].every(k => k in data));
ok('noci za 200 dní', data.nights.length >= 195 && data.nights.length <= 201, data.nights.length);
ok('HRV historie ~2 roky', data.hrv_history.length >= 700, data.hrv_history.length);
ok('poslední noc: skóre, fáze, HRV', data.nights.at(-1).score >= 70 && data.nights.at(-1).deep_min === 80 && data.nights.at(-1).hrv > 0, JSON.stringify(data.nights.at(-1)));
ok('Body Battery při probuzení dopočtena z řady', data.daily.body_battery_at_wake === 78 && data.nights.at(-1).bb === 78, data.daily.body_battery_at_wake);
ok('denní souhrn v2: klidová TF, stres, dýchání, BB, kroky', data.daily.resting_heart_rate > 0 && data.daily.average_stress_level === 31 && data.daily.max_stress_level === 88
  && data.daily.avg_waking_respiration === 14.5 && data.daily.body_battery_highest === 92 && data.daily.body_battery_most_recent === 47 && data.daily.total_steps === 9000, JSON.stringify(data.daily));
ok('7denní průměr klidové TF dopočten', data.daily.avg_resting_heart_rate_7day >= 51 && data.daily.avg_resting_heart_rate_7day <= 53, data.daily.avg_resting_heart_rate_7day);
ok('změna BB ve spánku z události SLEEP', data.sleep_latest.body_battery_change === 42 && data.nights.at(-1).bb_change === 42, data.sleep_latest.body_battery_change);
ok('klidová TF u spánku z denního souhrnu', data.sleep_latest.resting_heart_rate > 0 && data.nights.at(-1).hr > 0);
ok('HRV baseline (lowUpper / balancedUpper)', data.hrv.baseline_low === 25 && data.hrv.baseline_upper === 35);
ok('fitness věk + aktivita', data.fitness.fitness_age === 44.4 && data.last_activity.activity_name === 'Běh' && data.last_activity.distance_km === 10, JSON.stringify(data.last_activity));
ok('kompaktní dny ~210 s HRV, spánkem, TF, BB, stresem', data.days.length >= 200 && data.days.length <= 212 && data.days.at(-2).hrv > 0 && data.days.at(-2).sc > 0 && data.days.at(-2).rhr > 0 && data.days.at(-2).st === 31, data.days.length + ' ' + JSON.stringify(data.days.at(-2)));
{ const withRun = data.days.filter(d => d.a.some(a => /running/.test(a.k))).length, withCold = data.days.filter(d => d.a.some(a => /cold/i.test(a.n))).length;
  ok('aktivity po dnech (běh, otužování) i přes stránkování po 100', withRun >= 65 && withCold >= 38 && data.days.at(-1).a[0].h === 7 && data.days.at(-1).a[0].te === 3.4, withRun + ' / ' + withCold); }
ok('readiness prázdná (API ji nemá) → stránka odhadne', Object.keys(data.readiness).length === 0);
ok('vzorky odpovědí uloženy jednou', !!G.file('garmin-api-vzorky.json') && !!G.props.SAMPLES_DONE);
ok('velikost dat < 2 MB', Buffer.byteLength(G.file('garmin-data.json').content) < 2e6, Buffer.byteLength(G.file('garmin-data.json').content));
// běžný sync = jen pár volání
API.calls.length = 0;
r = G.env.syncGarmin_({});
ok('běžný sync: málo volání', r.ok && !r.backfill && API.calls.length <= 10, API.calls.length + ' (backfill ' + backfillCalls + ')');
// stránka: ghGet / ghSync
const g = JSON.parse(G.env.ghGet('k1'));
ok('ghGet vrací data a stáří', g.ok && g.data.nights.length > 0 && g.ageH < 1);
ok('ghGet se špatným klíčem odmítne', !JSON.parse(G.env.ghGet('x')).ok);
const s2 = JSON.parse(G.env.ghSync('k1'));
ok('ghSync (tlačítko) stáhne a vrátí data', s2.ok && s2.sync && s2.sync.ok, JSON.stringify(s2.sync));
// 429 → pauza, další sync nic nevolá
const orig = API.maxSumSpan; API.calls.length = 0;
const fetch0 = G.env.UrlFetchApp.fetch; G.env.UrlFetchApp.fetch = (u, o) => /dailysummaries/.test(u) ? { getResponseCode: () => 429, getContentText: () => '' } : fetch0(u, o);
r = G.env.syncGarmin_({});
ok('429 → chyba a pauza', !r.ok && /429/.test(r.error) && +G.props.GARMIN_COOLDOWN > Date.now());
API.calls.length = 0; r = G.env.syncGarmin_({});
ok('během pauzy žádné volání', !r.ok && API.calls.length === 0);
G.env.UrlFetchApp.fetch = fetch0; delete G.props.GARMIN_COOLDOWN; API.maxSumSpan = orig;
ok('data na Disku po chybě zůstala', JSON.parse(G.file('garmin-data.json').content).nights.length > 0);
// klíč neplatný
G.props.GARMIN_API_KEY = 'spatny'; G.env.CacheService.getScriptCache = () => ({ get: () => null, put: () => {} });
r = G.env.syncGarmin_({});
ok('neplatný klíč = jasná chyba', !r.ok && /neplatný nebo vypršel/.test(r.error), r.error);
// připomínka vypršení klíče
G.props.GARMIN_KEY_EXP = add(TODAY, 20); G.env.keyExpWatch_(); G.env.keyExpWatch_();
ok('e-mail o vypršení klíče 1× týdně', G.mails.filter(m => /vyprší za/.test(m.sub)).length === 1, JSON.stringify(G.mails.map(m => m.sub)));

// hodinky 6 dní nesynchronizované: Garmin zná jen dny do -6 → po syncu hodinek se dotáhnou všechny chybějící dny
{
  const G3 = gasEnv(); G3.props.SYNC_KEY = 'k'; G3.props.GARMIN_API_KEY = 'test-key'; API.fail401once = false;
  API.lastSynced = add(TODAY, -6);
  let r3 = G3.env.syncGarmin_({});
  const n1 = JSON.parse(G3.file('garmin-data.json').content).nights.at(-1).date;
  ok('nesynchronizované hodinky: poslední noc = poslední den v Garminu', r3.ok && n1 === API.lastSynced, n1);
  API.lastSynced = null;   // Pavel synchronizoval hodinky
  r3 = G3.env.syncGarmin_({});
  const d3 = JSON.parse(G3.file('garmin-data.json').content), nd = d3.nights.map(n => n.date);
  ok('po syncu hodinek se dotáhnou všechny chybějící dny (ne jen 3)', r3.ok && range(add(TODAY, -6), TODAY).every(d => nd.includes(d)), nd.slice(-8).join(','));
}

// backfill s výpadkem Garminu (HTTP 500 u souhrnů) → nedokončený, další běh doplní
{
  const G2 = gasEnv(); G2.props.SYNC_KEY = 'k'; G2.props.GARMIN_API_KEY = 'test-key'; API.fail401once = false;
  const f0 = G2.env.UrlFetchApp.fetch;
  G2.env.UrlFetchApp.fetch = (u, o) => /dailysummaries/.test(u) ? { getResponseCode: () => 500, getContentText: () => 'down' } : f0(u, o);
  let r2 = G2.env.syncGarmin_({});
  ok('výpadek při backfillu: běh skončí, chyba zapsaná', r2.ok && r2.errs.length === 1 && /souhrny/.test(r2.errs[0]) && !!G2.props.SYNC_ERR, JSON.stringify(r2.errs));
  ok('výpadek při backfillu: backfill NEoznačen jako hotový', !G2.props.BF_DONE && !!G2.props.BF_STATE, G2.props.BF_STATE);
  G2.env.UrlFetchApp.fetch = f0;
  r2 = G2.env.syncGarmin_({});
  ok('další běh backfill dokončí', r2.ok && !!G2.props.BF_DONE && !G2.props.BF_STATE && !G2.props.SYNC_ERR, JSON.stringify(r2));
  const d2 = JSON.parse(G2.file('garmin-data.json').content);
  ok('po dokončení jsou denní souhrny za celou dobu', d2.daily.resting_heart_rate > 0 && Object.keys(JSON.parse(G2.file('garmin-hist.json').content).days).filter(k => JSON.parse(G2.file('garmin-hist.json').content).days[k].d).length >= 200);
}

// deník: uložení dne, čtení přes ghGet, smazání, limity, špatný klíč
{
  const day = { t: { alk: 2, kava_pozde: 1 }, m: [{ s: 'vecere', h: '21:30', w: 'pizza' }], sup: ['mg'], med: 10, n: 'test' };
  let r = JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify(day)));
  ok('deník: uložení dne', r.ok, JSON.stringify(r));
  let g2 = JSON.parse(G.env.ghGet('k1'));
  ok('deník: ghGet vrací záznam dne', g2.journal && g2.journal.days[TODAY] && g2.journal.days[TODAY].t.alk === 2 && g2.journal.days[TODAY].m[0].w === 'pizza');
  r = JSON.parse(G.env.ghJournalCfg('k1', JSON.stringify({ sup: [{ id: 'mg', l: 'Hořčík' }] })));
  ok('deník: nastavení (doplňky)', r.ok && JSON.parse(G.env.ghGet('k1')).journal.cfg.sup[0].l === 'Hořčík');
  const at1 = JSON.parse(G.env.ghGet('k1')).journal.days[TODAY].at;
  r = JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify({ t: { alk: 3 } })));
  ok('deník: souběh — zápis se starým / chybějícím at odmítnut a vrátí aktuální den', !r.ok && r.conflict && r.day.t.alk === 2, JSON.stringify(r));
  r = JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify(Object.assign({}, day, { at: at1, n: 'změna' }))));
  ok('deník: zápis se správným at projde a vrátí nové at', r.ok && r.at && r.at === JSON.parse(G.env.ghGet('k1')).journal.days[TODAY].at);
  r = JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify({ at: r.at })));
  ok('deník: prázdný den = smazání', r.ok && !JSON.parse(G.env.ghGet('k1')).journal.days[TODAY]);
  ok('deník: špatný klíč odmítnut', !JSON.parse(G.env.ghJournalSet('x', TODAY, '{}')).ok);
  ok('deník: neplatné datum odmítnuto', !JSON.parse(G.env.ghJournalSet('k1', '2026-1-1', '{}')).ok);
  ok('deník: příliš velký den odmítnut', !JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify({ n: 'x'.repeat(7000) }))).ok);
  G.env.ghJournalSet('k1', add(TODAY, -1), JSON.stringify(day));
  G.env.ghJournalSet('k1', TODAY, JSON.stringify(day));
  // nečitelný soubor deníku = chyba, ne tiché přepsání
  const jf = G.file('garmin-journal.json'), keep = jf.content; jf.content = '{rozbité';
  r = JSON.parse(G.env.ghJournalSet('k1', TODAY, JSON.stringify(day)));
  ok('deník: poškozený soubor se nepřepíše', !r.ok && jf.content === '{rozbité', JSON.stringify(r));
  jf.content = keep;
}

// schránka deníku: soubor od Clauda z chatu → převezme se při otevření stránky, hotový do koše, chybný „CHYBA“
{
  const Y = add(TODAY, -1), j0 = JSON.parse(G.file('garmin-journal.json').content).days[Y];
  G.folder.createFile('garmin-denik-vstup 2026-10-30 1612.json', JSON.stringify({ v: 1, items: [
    { d: Y, tadd: { alk: 1 }, t: { kava_pozde: 0, sauna: 1 }, m: [{ s: 'ob', h: '12:30', w: 'kuře s rýží' }, { s: 'ob', h: '12:30', w: 'kuře s rýží' }], sup: ['mg', 'd3'], n: 'z chatu', newSup: [{ id: 'd3', l: 'Vitamín D3' }] },
    { d: TODAY, t: { med: 15 }, m: [{ s: 'sn', h: '07:10', w: 'ovesná kaše' }] } ] }));
  G.folder.createFile('garmin-denik-vstup zly.json', '{nečitelné');
  const g = JSON.parse(G.env.ghGet('k1')), dy = g.journal.days[Y], dt = g.journal.days[TODAY];
  ok('schránka: počítadlo se přičte, štítek nastaví / smaže', dy.t.alk === j0.t.alk + 1 && dy.t.sauna === 1 && !dy.t.kava_pozde, JSON.stringify(dy.t));
  ok('schránka: jídla přidána bez duplicit, doplňky sjednoceny, poznámka připojena', dy.m.length === 2 && dy.m[1].w === 'kuře s rýží' && dy.sup.join() === 'mg,d3' && /test · z chatu/.test(dy.n), JSON.stringify(dy));
  ok('schránka: nový doplněk do nastavení, nový den, src chat', g.journal.cfg.sup.some(x => x.id === 'd3' && x.l === 'Vitamín D3') && dt.t.med === 15 && dt.m.some(m => m.w === 'ovesná kaše' && m.s === 'sn') && dt.src === 'chat');
  const fs_ = Object.values(G.files);
  ok('schránka: hotový soubor v koši, chybný přejmenován + chyba vrácena', fs_.find(f => f.name === 'garmin-denik-vstup 2026-10-30 1612.json').trashed && fs_.some(f => f.name === 'garmin-denik-vstup zly CHYBA.json' && !f.trashed) && /zly/.test(g.inboxErr || ''), g.inboxErr);
  const g2 = JSON.parse(G.env.ghGet('k1'));
  ok('schránka: druhé otevření nic nezdvojí', g2.journal.days[Y].t.alk === dy.t.alk && g2.journal.days[Y].m.length === 2 && !g2.inboxErr);
  G.folder.createFile('garmin-denik-vstup bez-data.json', JSON.stringify({ items: [{ t: { alk: 1 } }] }));
  ok('schránka: záznam bez data odmítnut', /datum/.test(JSON.parse(G.env.ghGet('k1')).inboxErr || ''));
  // stránka otevřená se starou kopií dne, mezitím přišel záznam z chatu → klik na stránce záznam nepřepíše
  const old = Object.assign({}, dy, { at: '2026-01-01T00:00:00.000Z' });
  const rc = JSON.parse(G.env.ghJournalSet('k1', Y, JSON.stringify(old)));
  ok('schránka: stará kopie ze stránky záznam z chatu nepřepíše', !rc.ok && rc.conflict && rc.day.src === 'chat' && rc.day.m.length === 2);
  // jídla z databáze + váha přes schránku, výtah pro Clauda
  G.folder.createFile('garmin-denik-vstup 2026-10-30 1800.json', JSON.stringify({ v: 1, items: [{ d: Y, kg: 82.4,
    food: [{ id: 'ovesna_kase', l: 'Ovesná kaše s mlékem', por: 300, porL: 'miska', k: 110, p: 4.5, f: 2.8, c: 16, src: 'https://www.kaloricketabulky.cz/' }],
    m: [{ s: 'sn', h: '07:10', w: '', it: [{ f: 'ovesna_kase', g: 300 }] }] }] }));
  let g3 = JSON.parse(G.env.ghGet('k1'));
  ok('schránka: nové jídlo do databáze, položka v jídle, váha', g3.journal.food.ovesna_kase && g3.journal.food.ovesna_kase.k === 110 && g3.journal.days[Y].m.some(m => m.it && m.it[0].f === 'ovesna_kase' && m.it[0].g === 300) && g3.journal.days[Y].kg === 82.4, JSON.stringify(g3.journal.days[Y]));
  ok('schránka: výtah garmin-jidla.json jen s databází', JSON.parse(G.file('garmin-jidla.json').content).food.ovesna_kase.l === 'Ovesná kaše s mlékem' && !/days/.test(G.file('garmin-jidla.json').content));
  G.folder.createFile('garmin-denik-vstup 2026-10-30 1801.json', JSON.stringify({ items: [{ d: Y, food: [{ id: 'ovesna_kase', l: 'Jiná', k: 999 }] }] }));
  g3 = JSON.parse(G.env.ghGet('k1'));
  ok('schránka: existující jídlo se bez foodSet nepřepíše (Pavlovy opravy zůstanou)', g3.journal.food.ovesna_kase.l === 'Ovesná kaše s mlékem', g3.inboxErr);
  G.folder.createFile('garmin-denik-vstup 2026-10-30 1802.json', JSON.stringify({ items: [{ d: Y, m: [{ s: 'ob', it: [{ f: 'neexistuje', g: 100 }] }] }] }));
  ok('schránka: položka s neznámým jídlem odmítnuta (nic nezapsáno)', /není v databázi/.test(JSON.parse(G.env.ghGet('k1')).inboxErr || ''));
  // databáze ze stránky
  let fr = JSON.parse(G.env.ghFoodSet('k1', 'rohlik', JSON.stringify({ l: 'Rohlík', por: 43, porL: '1 ks', k: 290, p: 9, f: 4, c: 54 })));
  ok('jídla: ghFoodSet uloží a vrátí jídlo', fr.ok && fr.food.k === 290 && JSON.parse(G.env.ghGet('k1')).journal.food.rohlik.por === 43, JSON.stringify(fr));
  ok('jídla: bez kcal / názvu odmítnuto', !JSON.parse(G.env.ghFoodSet('k1', 'x', JSON.stringify({ l: 'X' }))).ok && !JSON.parse(G.env.ghFoodSet('k1', 'y', JSON.stringify({ k: 100 }))).ok);
  ok('jídla: smazání', JSON.parse(G.env.ghFoodSet('k1', 'rohlik', null)).ok && !JSON.parse(G.env.ghGet('k1')).journal.food.rohlik);
  ok('jídla: špatný klíč odmítnut', !JSON.parse(G.env.ghFoodSet('x', 'a', JSON.stringify({ l: 'A', k: 1 }))).ok);
  ok('Garmin: spálené kcal v days', JSON.parse(G.file('garmin-data.json').content).days.some(x => x.kc > 0), JSON.stringify(JSON.parse(G.file('garmin-data.json').content).days.slice(-1)));
  { const ds = JSON.parse(G.file('garmin-data.json').content).days, runs = [].concat(...ds.map(x => x.a)).filter(a => /running/.test(a.k || ''));
    const r = runs[0] || {};
    ok('Běh: aktivity nesou km, čas, tempo (rychlost), TF, kadenci, převýšení, TE, VO2max, id', runs.length > 20 && r.km > 0 && r.s > 0 && r.sp > 0 && r.hr > 0 && r.hrx > 0 && r.cad === 166 && r.el >= 0 && r.tea === 0.8 && r.vo2 === 48 && r.id && r.t === '07:00', JSON.stringify(r));
    ok('Běh: typy running / trail / treadmill', ['running', 'trail_running', 'treadmill_running'].every(k => runs.some(a => a.k === k)));
    const cp = [].concat(...ds.map(x => x.a)).find(a => /Cold/.test(a.n));
    ok('Běh: neběžecká aktivita bez prázdných polí (distance 0 → bez km)', cp && cp.km == null && cp.cad == null, JSON.stringify(cp)); }
}

fs.writeFileSync(path.join(OUT, 'sample-api.json'), G.file('garmin-data.json').content);
fs.writeFileSync(path.join(OUT, 'sample-journal.json'), G.file('garmin-journal.json').content);
console.log(fails ? `\n${fails} FAIL` : '\nvše OK');
process.exit(fails ? 1 : 0);
