// ══════════════ GARMIN HEALTH — Google Apps Script ══════════════
// Stejný vzor jako Tradelog (EdgePilot):
//   • stránku dashboardu načítá při každém otevření z GitHubu (větev GH_BRANCH) → push do main = nasazení na PC, iPad i iPhone
//   • data stahuje SÁM z oficiálního Garmin Connect Personal API (od 21.10.2026; klíč GARMIN_API_KEY, jen čtení) — bez PC,
//     bez hesla ke Garminu; historie na Disku „Můj disk/Garmin Data/garmin-hist.json“, výstup pro stránku garmin-data.json
//     (stejný tvar jako local/garmin_data.py → load_data, takže stránka i lokální offline režim čtou totéž)
//   • prahy a zóny dashboardu ukládá na Disk (garmin-settings.json) → stejné na všech zařízeních
//   • kód se aktualizuje sám: selfUpdateTick 1× za hodinu stáhne apps-script/garmin-apps-script.gs z GitHubu
// Vlastnosti skriptu: SYNC_KEY (vytvoří setup), GH_REPO = komarekpol/garmin-health, GH_TOKEN (fine-grained, Contents: read),
// GH_BRANCH (výchozí main), GARMIN_API_KEY (Personal API klíč z Garmin Connect → Nastavení → Personal API Key),
// GARMIN_KEY_EXP (RRRR-MM-DD vypršení klíče — připomínka e-mailem 30 dní předem), volitelně SELF_FILE (výchozí „garmin“),
// ALERT_EMAIL (výchozí vlastník skriptu).
// Pojistka samoaktualizace: soubor musí obsahovat function selfUpdate( a function doGet(.

const UA = 'garmin-health-apps-script';
const DATA_FOLDER_NAME = 'Garmin Data';
const DATA_FILE = 'garmin-data.json';
const SETTINGS_FILE = 'garmin-settings.json';
const HTML_COPY_FILE = 'garmin-dashboard-zaloha.html';   // poslední dobrá stránka z GitHubu (výpadek GitHubu = stránka dál běží)
const HEALTH_FILE = 'garmin-health-stav.json';            // stav částí systému (čte Claude při kontrole) — malý soubor
const SETTINGS_MAX_ = 50000;                               // prahy + zóny dnes ~1 tis. znaků
const DATA_MAX_ = 8000000;                                 // google.script.run a stránka; export dnes ~0,1–0,2 MB
const STALE_H_ = 30;                                       // data starší = sync z Garminu neběží (klíč, výpadek) → e-mail 1× denně
const KEEP_KEYS_ = ['garmin_thresholds', 'garmin_vst_zones', 'garmin_hr_zones', 'garmin_bb_zones', 'garmin_resp_zones'];

function props_() { return PropertiesService.getScriptProperties(); }
function cfg_() { return { key: props_().getProperty('SYNC_KEY') || '' }; }
function keyOk_(k) { const c = cfg_().key; return !!c && k === c; }
function ghCfg_() {
  const p = props_(), repo = p.getProperty('GH_REPO'), tok = p.getProperty('GH_TOKEN');
  return repo && tok ? { repo: repo, tok: tok, branch: p.getProperty('GH_BRANCH') || 'main' } : null;
}
// CacheService nikdy nesmí shodit stránku (kvóta, výpadek) — vše přes try
function cacheGet_(k) { try { return CacheService.getScriptCache().get(k); } catch (e) { return null; } }
function cachePut_(k, v, s) { try { if (String(v).length < 95000) CacheService.getScriptCache().put(k, v, s); } catch (e) {} }

// ══ 📁 Disk: Můj disk/Garmin Data (složku zakládá PC exportem; nikdy nic v kořeni Disku) ══
function dataFolder_() {
  const p = props_(), id = p.getProperty('DATA_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const it = DriveApp.getRootFolder().getFoldersByName(DATA_FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(DATA_FOLDER_NAME);
  p.setProperty('DATA_FOLDER_ID', f.getId());
  return f;
}
function fileIn_(name) {
  const it = dataFolder_().getFilesByName(name);
  let best = null;
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed() && (!best || f.getLastUpdated() > best.getLastUpdated())) best = f; }
  return best;   // při duplicitách (Disk pro počítače občas vytvoří kopii) vždy nejnovější
}
function writeFile_(name, text, mime) {
  const f = fileIn_(name);
  if (f) { f.setContent(text); return f; }
  return dataFolder_().createFile(name, text, mime || MimeType.PLAIN_TEXT);
}

function dataRead_() {
  const f = fileIn_(DATA_FILE);
  if (!f) return { ok: false, error: 'Na Disku zatím není ' + DATA_FOLDER_NAME + '/' + DATA_FILE + ' — ve Vlastnostech skriptu chybí GARMIN_API_KEY, nebo ještě neproběhl první sync (v editoru spusť syncNow).' };
  if (f.getSize() > DATA_MAX_) return { ok: false, error: DATA_FILE + ' má ' + f.getSize() + ' B (limit ' + DATA_MAX_ + ' B) — zkrať historii v local/garmin_data.py' };
  const text = f.getBlob().getDataAsString('UTF-8');
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: DATA_FILE + ' nejde přečíst (' + e + ') — Disk možná soubor právě nahrává, zkus za chvíli.' }; }
  const at = data.exported_at ? Date.parse(data.exported_at) : f.getLastUpdated().getTime();
  return { ok: true, data: data, at: new Date(at).toISOString(), ageH: Math.round((Date.now() - at) / 36e5 * 10) / 10, bytes: text.length };
}
function settingsRead_() {
  const f = fileIn_(SETTINGS_FILE);
  if (!f) return {};
  try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')) || {}; } catch (e) { return {}; }
}

// ══ 🌐 Webová aplikace ══
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!keyOk_(p.key)) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Garmin Health: chybí nebo nesedí klíč v adrese (…/exec?key=…). Adresu vypíše funkce setup.</p>').setTitle('Garmin Health');
  if (p.mode === 'data') return json_(apiData_());
  if (p.mode === 'health') return json_(healthOut_());
  return page_();
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Stránka volá data přes google.script.run (fetch na /exec na iPhonu končí „Nemáte oprávnění“ — poučení z Tradelogu).
function ghGet(key) {
  let out;
  try { if (!keyOk_(key)) throw new Error('Neplatný klíč'); out = apiData_(); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return JSON.stringify(out);
}
// Tlačítko „Sync Garmin“ v cloudu: stáhne poslední dny hned (zámek proti souběhu s časovačem) a vrátí čerstvá data
function ghSync(key) {
  let out;
  try {
    if (!keyOk_(key)) throw new Error('Neplatný klíč');
    const r = syncGarmin_({ manual: true });
    out = apiData_(); out.sync = r;
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return JSON.stringify(out);
}
function apiData_() {
  const d = dataRead_();
  d.settings = settingsRead_();
  if (d.ok) d.stale = d.ageH > STALE_H_;
  return d;
}
// Uložení prahů a zón (jen známé klíče, ohraničená velikost — nic jiného se přes stránku na Disk nezapíše)
function ghSet(key, json) {
  let out;
  try {
    if (!keyOk_(key)) throw new Error('Neplatný klíč');
    if (typeof json !== 'string' || json.length > SETTINGS_MAX_) throw new Error('Nastavení je větší než ' + SETTINGS_MAX_ + ' znaků — neuloženo');
    const inp = JSON.parse(json), cur = settingsRead_();
    KEEP_KEYS_.forEach(k => { if (k in inp) { if (inp[k] === null) delete cur[k]; else cur[k] = String(inp[k]).slice(0, 10000); } });
    cur._at = new Date().toISOString();
    writeFile_(SETTINGS_FILE, JSON.stringify(cur), MimeType.PLAIN_TEXT);
    out = { ok: true, at: cur._at };
  } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return JSON.stringify(out);
}

// HtmlService při servírování „minifikuje“ skripty vlastním tokenizérem, který se plete u regexů a vnořených šablon
// (Tradelog 10.10. a 25.10.2026). Každý vložený skript se proto přenese jako JSON řetězec bez „/“ a „<“ a spustí se na stránce.
function wrapScripts_(html) {
  return String(html).replace(/<script>([\s\S]*?)<\/script>/g, function (m, code) {
    var js = JSON.stringify(code).replace(/\//g, '\\/').replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return '<script>(function(){var c=document.currentScript,s=document.createElement("script");s.text=' + js + ';c.parentNode.insertBefore(s,c.nextSibling);})();</script>';
  });
}
function ghHtml_() {
  const g = ghCfg_(); if (!g) return null;
  try {
    const r = UrlFetchApp.fetch('https://api.github.com/repos/' + g.repo + '/contents/garmin-dashboard.html?ref=' + encodeURIComponent(g.branch),
      { headers: { Authorization: 'Bearer ' + g.tok, Accept: 'application/vnd.github.raw', 'User-Agent': UA }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) { console.warn('GitHub HTTP ' + r.getResponseCode()); return null; }
    const html = r.getContentText('UTF-8');
    return html.length > 1000 ? html : null;
  } catch (e) { console.warn('GitHub: ' + e); return null; }
}
function ghBuild_() {
  const hit = cacheGet_('gh_build'); if (hit) return hit;
  const g = ghCfg_(); if (!g) return null;
  try {
    const r = UrlFetchApp.fetch('https://api.github.com/repos/' + g.repo + '/commits?path=garmin-dashboard.html&per_page=1&sha=' + encodeURIComponent(g.branch),
      { headers: { Authorization: 'Bearer ' + g.tok, Accept: 'application/vnd.github+json', 'User-Agent': UA }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    const s = ((JSON.parse(r.getContentText()) || [])[0] || {}).sha; if (!s) return null;
    const v = String(s).slice(0, 7); cachePut_('gh_build', v, 120); return v;
  } catch (e) { return null; }
}
function page_() {
  let html = ghHtml_(), src = 'github';
  if (html) {
    // záloha poslední dobré stránky na Disk jen při změně (porovnání délky + hash v mezipaměti)
    try {
      const h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html, Utilities.Charset.UTF_8));
      if (props_().getProperty('HTML_COPY_HASH') !== h) { writeFile_(HTML_COPY_FILE, html, MimeType.PLAIN_TEXT); props_().setProperty('HTML_COPY_HASH', h); }
    } catch (e) { console.warn('záloha stránky: ' + e); }
  } else {
    const f = fileIn_(HTML_COPY_FILE); src = 'drive';
    if (!f) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Garmin Health: stránku se nepodařilo načíst z GitHubu (GH_REPO / GH_TOKEN ve Vlastnostech skriptu) a na Disku zatím není záloha. Spusť v editoru testGitHub.</p>').setTitle('Garmin Health');
    html = f.getBlob().getDataAsString('UTF-8');
  }
  const inj = '<script>window.__GH_CLOUD__=' + JSON.stringify({ key: cfg_().key, build: { sha: src === 'github' ? ghBuild_() : null, src: src, at: new Date().toISOString() } }).replace(/</g, '\\u003c') + ';</script>';
  const w = wrapScripts_(html);
  const out = /<head[^>]*>/i.test(w) ? w.replace(/<head[^>]*>/i, m => m + inj) : inj + w;
  return HtmlService.createHtmlOutput(out).setTitle('Garmin Health')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ══ 🩺 Stav a hlídač starých dat ══
function healthOut_() {
  const d = dataRead_(), p = props_();
  return { at: new Date().toISOString(), data: d.ok ? { at: d.at, ageH: d.ageH, bytes: d.bytes, date: d.data.date, warn: d.data.warn || null, stale: d.ageH > STALE_H_ } : { error: d.error },
    sync: { at: p.getProperty('SYNC_AT'), err: p.getProperty('SYNC_ERR'), backfill: p.getProperty('BF_STATE'), keyExp: p.getProperty('GARMIN_KEY_EXP') || null, cooldown: p.getProperty('GARMIN_COOLDOWN') },
    selfSha: p.getProperty('SELF_SHA'), selfAt: p.getProperty('SELF_AT'), selfErr: p.getProperty('SELF_ERR'), staleMail: p.getProperty('STALE_MAIL_DAY'),
    triggers: (() => { try { return ScriptApp.getProjectTriggers().map(x => x.getHandlerFunction()); } catch (e) { return null; } })() };
}
function staleWatch_() {
  const d = dataRead_(), p = props_(), day = Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
  const se = p.getProperty('SYNC_ERR');
  const bad = !d.ok ? d.error + (se ? '\nPoslední chyba syncu: ' + se : '') : d.ageH > STALE_H_ ? 'Data z Garminu jsou stará ' + Math.round(d.ageH) + ' h (poslední sync ' + d.at + ').' + (se ? '\nPoslední chyba syncu: ' + se : '') + '\nKdyž je chyba HTTP 401, vypršel nebo byl zrušen klíč Personal API: vytvoř nový v Garmin Connect (Nastavení → Personal API Key) a vlož ho do Vlastností skriptu jako GARMIN_API_KEY.' : null;
  if (!bad || p.getProperty('STALE_MAIL_DAY') === day) return;
  // e-mail jen v denní době (7–22 Praha) a 1× denně
  const h = +Utilities.formatDate(new Date(), 'Europe/Prague', 'H'); if (h < 7 || h > 22) return;
  MailApp.sendEmail(p.getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail(), 'Garmin Health: data se neaktualizují', bad);
  p.setProperty('STALE_MAIL_DAY', day);
}

// ══ 🔄 Samoaktualizace z GitHubu (stejně jako Tradelog) ══
// Vyžaduje: Apps Script API zapnuté v script.google.com/home/usersettings a v manifestu script.projects + script.deployments.
function selfUpdate(force) {
  force = force === true;
  const g = ghCfg_(); if (!g) throw new Error('Chybí GH_REPO / GH_TOKEN ve Vlastnostech skriptu');
  const p = props_(), fileName = p.getProperty('SELF_FILE') || 'garmin', path = 'apps-script/garmin-apps-script.gs';
  const gr = UrlFetchApp.fetch('https://api.github.com/repos/' + g.repo + '/contents/' + path + '?ref=' + encodeURIComponent(g.branch),
    { headers: { Authorization: 'Bearer ' + g.tok, Accept: 'application/vnd.github+json', 'User-Agent': UA }, muteHttpExceptions: true });
  if (gr.getResponseCode() !== 200) throw new Error('GitHub HTTP ' + gr.getResponseCode());
  const meta = JSON.parse(gr.getContentText());
  if (!force && meta.sha === p.getProperty('SELF_SHA')) return { ok: true, same: true, sha: meta.sha };
  const code = Utilities.newBlob(Utilities.base64Decode(String(meta.content || '').replace(/\s/g, ''))).getDataAsString('UTF-8');
  if (code.length < 5000 || code.indexOf('function selfUpdate(') < 0 || code.indexOf('function doGet(') < 0) throw new Error('Kód z GitHubu neprošel kontrolou obsahu — aktualizace přerušena');
  try { new Function(code); } catch (e) { throw new Error('Kód z GitHubu má syntaktickou chybu (' + e + ') — aktualizace přerušena'); }
  const sid = ScriptApp.getScriptId(), tok = ScriptApp.getOAuthToken();
  const api = (method, url, body) => {
    const o = { method: method, headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true, contentType: 'application/json' };
    if (body) o.payload = JSON.stringify(body);
    const r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + sid + url, o), t = r.getContentText();
    if (r.getResponseCode() >= 300) throw new Error('Apps Script API ' + method + ' ' + url + ' → HTTP ' + r.getResponseCode() + ': ' + t.slice(0, 300));
    return t ? JSON.parse(t) : {};
  };
  const cur = api('get', '/content');
  const f = (cur.files || []).filter(x => x.name === fileName && x.type === 'SERVER_JS')[0];
  if (!f) throw new Error('V projektu není soubor „' + fileName + '“ (Vlastnost SELF_FILE)');
  if (!force && f.source === code) { p.setProperty('SELF_SHA', meta.sha); return { ok: true, same: true, sha: meta.sha }; }
  f.source = code;
  api('put', '/content', { files: cur.files });
  const ver = api('post', '/versions', { description: 'GitHub ' + meta.sha.slice(0, 7) + ' ' + new Date().toISOString().slice(0, 16) });
  const deps = (api('get', '/deployments').deployments || []).filter(d => d.deploymentConfig && d.deploymentConfig.versionNumber);
  deps.forEach(d => api('put', '/deployments/' + d.deploymentId, { deploymentConfig: { scriptId: sid, versionNumber: ver.versionNumber,
    manifestFileName: d.deploymentConfig.manifestFileName || 'appsscript', description: 'GitHub ' + meta.sha.slice(0, 7) } }));
  p.setProperty('SELF_SHA', meta.sha); p.setProperty('SELF_AT', new Date().toISOString());
  return { ok: true, updated: true, sha: meta.sha, version: ver.versionNumber, deployments: deps.length };
}
function selfUpdateTick() {
  const p = props_();
  try { syncTick_(); } catch (e) { console.warn('syncTick_: ' + e); }
  try { staleWatch_(); } catch (e) { console.warn('staleWatch_: ' + e); }
  try { keyExpWatch_(); } catch (e) { console.warn('keyExpWatch_: ' + e); }
  let r; try { r = selfUpdate(false); p.deleteProperty('SELF_ERR'); } catch (err) { console.warn('selfUpdate: ' + err); r = { ok: false, error: String(err) }; p.setProperty('SELF_ERR', new Date().toISOString() + ' ' + String(err).slice(0, 400)); }
  try { writeFile_(HEALTH_FILE, JSON.stringify(healthOut_(), null, 1), MimeType.PLAIN_TEXT); } catch (e) {}
  return r;
}

// ══ ⚙ Jednorázové nastavení (spouští Pavel v editoru) ══
// 1) setup — klíč, složka na Disku, kontrola GitHubu a dat, vypíše adresu dashboardu
function setup() {
  const p = props_();
  if (!p.getProperty('SYNC_KEY')) p.setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, ''));
  const f = dataFolder_();
  Logger.log('Složka dat: %s (%s)', f.getName(), f.getUrl());
  testGitHub();
  Logger.log(p.getProperty('GARMIN_API_KEY') ? '✓ GARMIN_API_KEY je nastavený — ověření: spusť testGarmin' : '✖ Chybí GARMIN_API_KEY (Garmin Connect web → Nastavení → Personal API Key → Create Key, platnost 1 rok)');
  const d = dataRead_();
  Logger.log(d.ok ? '✓ Data: ' + d.data.date + ', export ' + d.at + ' (' + d.ageH + ' h), ' + Math.round(d.bytes / 1024) + ' kB' : '✖ Data: ' + d.error);
  let url = ''; try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  Logger.log(url ? 'Adresa dashboardu (PC, iPad, iPhone → Sdílet → Přidat na plochu):\n%s?key=%s' : 'Webová aplikace ještě není nasazená: Implementovat → Nová implementace → Webová aplikace, pak spusť setup znovu.%s%s', url, url ? p.getProperty('SYNC_KEY') : '');
}
// 2) setupSelfUpdate — hodinový časovač: samoaktualizace z GitHubu + hlídač starých dat
function setupSelfUpdate() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'selfUpdateTick').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('selfUpdateTick').timeBased().everyHours(1).create();
  Logger.log('🔄 Samoaktualizace z GitHubu 1× za hodinu. Teď první běh…');
  Logger.log('Výsledek: %s', JSON.stringify(selfUpdate(true)));
}
function testGitHub() {
  const g = ghCfg_();
  if (!g) { Logger.log('✖ Chybí GH_REPO nebo GH_TOKEN ve Vlastnostech skriptu.'); return; }
  const h = ghHtml_();
  Logger.log(h ? '✓ GitHub OK: ' + g.repo + '@' + g.branch + ' — garmin-dashboard.html ' + Math.round(h.length / 1024) + ' kB' : '✖ Nepodařilo se načíst garmin-dashboard.html z ' + g.repo + ' (zkontroluj token a název repozitáře).');
}

// ══════════════ ⌚ GARMIN CONNECT PERSONAL API (oficiální, od 21.10.2026) ══════════════
// Klíč: Garmin Connect web → Nastavení → Personal API Key → Create Key (platnost 30 dní – 1 rok, zobrazí se jen jednou)
// → Vlastnost skriptu GARMIN_API_KEY. Klíč se vymění za JWT token (POST, hlavička „Authorization: ApiKey …“, Accept */* —
// s Accept application/json vrací 406), data jsou GET s „Authorization: Bearer …“. Cesty a postup podle oficiálního klienta
// github.com/garmin/connect-personal-api-python (Apache-2.0). Rate limity Garmin nezveřejňuje → málo volání, při 429 pauza 1 h.
// Tvary odpovědí Garmin nedokumentuje: parsery hledají známé názvy polí Garmin Connect (stejné služby jako garmin-givemydata)
// a první běhy ukládají vzorky odpovědí do garmin-api-vzorky.json (ověření mapování; jen na Disku, nikdy do repa).
const GP_BASE_ = 'https://personal.connectapi.garmin.com';
const GP_TOKEN_PATH_ = '/personalapitoken-service/personal-api/personal-api-key/token';
const HIST_FILE = 'garmin-hist.json';
const SAMPLES_FILE = 'garmin-api-vzorky.json';
const NIGHTS_DAYS_ = 200;           // noci pro grafy (jako local/garmin_data.py)
const HRV_BACK_DAYS_ = 730;         // HRV historie pro záložku VST (backfill)
const DAY_BACK_DAYS_ = 210;         // denní souhrny, spánek, Body Battery (backfill)
const HIST_KEEP_DAYS_ = 800;        // déle se v garmin-hist.json nedrží (≈ 0,3 kB / den)
const SYNC_EVERY_MIN_ = 110;        // automatický sync ~ každé 2 h (časovač selfUpdateTick běží 1× za hodinu)
const SYNC_HOURS_ = [5, 23];        // jen 5–23 h Praha
const RECENT_DAYS_ = 3;             // běžný sync: posledních N dní (pozdní skóre spánku, HRV)
const SPAN_ = { hrv: 180, sum: 28, sleep: 28, bb: 28 };   // max dní v jednom dotazu (zdroje: shapecalendar.com, badgehero.io — konzervativně)
const RUN_BUDGET_MS_ = 4.5 * 60e3;  // Apps Script běží max 6 min → backfill po částech přes BF_STATE

function ymd_(d) { return Utilities.formatDate(d, 'Europe/Prague', 'yyyy-MM-dd'); }
function addDays_(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function isYmd_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)); }

function gpToken_(force) {
  const key = props_().getProperty('GARMIN_API_KEY');
  if (!key) throw new Error('Chybí GARMIN_API_KEY ve Vlastnostech skriptu');
  const ck = 'gp_tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)).slice(0, 16);
  if (!force) { const hit = cacheGet_(ck); if (hit) return hit; }
  const r = UrlFetchApp.fetch(GP_BASE_ + GP_TOKEN_PATH_, { method: 'post', headers: { Authorization: 'ApiKey ' + key, Accept: '*/*' }, muteHttpExceptions: true });
  const code = r.getResponseCode(), t = String(r.getContentText() || '').trim();
  if (code === 401 || code === 403) throw new Error('HTTP ' + code + ' při výměně klíče — GARMIN_API_KEY je neplatný nebo vypršel');
  if (code >= 300 || !t) throw new Error('Token Personal API: HTTP ' + code + ' ' + t.slice(0, 200));
  let ttl = 3600;   // token = JWT; ponechat do 1 h před koncem (jako oficiální klient), CacheService max 6 h
  try { const exp = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(t.split('.')[1] + '==='.slice((t.split('.')[1].length + 3) % 4))).getDataAsString()).exp; if (exp) ttl = Math.max(60, Math.min(21600, Math.floor(exp - Date.now() / 1000 - 3600))); } catch (e) {}
  cachePut_(ck, t, ttl);
  return t;
}
// GET s jedním pokusem o nový token při 401; 429 = pauza (GARMIN_COOLDOWN) a přerušení syncu
function gpGet_(path, params, ctx) {
  const qs = params ? '?' + Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&') : '';
  for (let i = 0; i < 2; i++) {
    const r = UrlFetchApp.fetch(GP_BASE_ + path + qs, { headers: { Authorization: 'Bearer ' + gpToken_(i > 0), Accept: 'application/json' }, muteHttpExceptions: true });
    const code = r.getResponseCode(); if (ctx) ctx.calls++;
    if (code === 401 && i === 0) continue;
    if (code === 429) { props_().setProperty('GARMIN_COOLDOWN', String(Date.now() + 3600e3)); const e = new Error('HTTP 429 (limit Garminu) — pauza 1 h'); e.stop = true; throw e; }
    if (code === 204 || code === 404) return null;   // žádná data pro den / endpoint
    const t = r.getContentText('UTF-8');
    if (code >= 300) { const e = new Error(path + ' → HTTP ' + code + ' ' + t.slice(0, 160)); e.code = code; throw e; }
    if (!t) return null;
    const j = JSON.parse(t);
    if (ctx && ctx.samples && !ctx.samples[path]) ctx.samples[path] = sampleOf_(j);
    return j;
  }
  throw new Error(path + ' → HTTP 401 i s novým tokenem — GARMIN_API_KEY je neplatný nebo vypršel');
}
// rozsah po částech; když Garmin odmítne délku (HTTP 400), část se zkrátí na polovinu
function gpRange_(path, kind, from, to, mk, ctx) {
  const out = []; let a = from, span = SPAN_[kind];
  while (a <= to) {
    if (Date.now() - ctx.t0 > RUN_BUDGET_MS_) { ctx.partial = true; break; }
    const b = addDays_(a, span - 1) < to ? addDays_(a, span - 1) : to;
    try { const j = gpGet_(mk.path ? mk.path(a, b) : path, mk.params ? mk.params(a, b) : null, ctx); listOf_(j).forEach(x => out.push(x)); a = addDays_(b, 1); }
    catch (e) { if (e.code === 400 && span > 1) { span = Math.max(1, Math.floor(span / 2)); continue; } throw e; }
  }
  return out;
}
// zkrácený vzorek odpovědi (klíče a typy, pole jen 1. prvek) — k ověření mapování polí
function sampleOf_(j, depth) {
  depth = depth || 0;
  if (Array.isArray(j)) return depth > 3 ? '[…' + j.length + ']' : [j.length ? sampleOf_(j[0], depth + 1) : null, '…' + j.length];
  if (j && typeof j === 'object') { if (depth > 4) return '{…}'; const o = {}; Object.keys(j).slice(0, 60).forEach(k => o[k] = sampleOf_(j[k], depth + 1)); return o; }
  return typeof j === 'string' ? j.slice(0, 40) : j;
}

// ── parsery (názvy polí Garmin Connect; hledá se do hloubky 3, první nenulová hodnota) ──
function listOf_(j) {
  if (j == null) return [];
  if (Array.isArray(j)) return j;
  if (typeof j === 'object') {
    for (const k of ['data', 'hrvSummaries', 'dailySleepSummaries', 'sleepSummaries', 'summaries', 'values', 'items']) if (Array.isArray(j[k])) return j[k];
    const arr = Object.keys(j).map(k => j[k]).filter(v => Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && dateOf_(v[0]));
    if (arr.length) return arr[0];
  }
  return [j];
}
function pick_(o, keys, depth) {
  if (!o || typeof o !== 'object') return null;
  for (const k of keys) if (o[k] != null && typeof o[k] !== 'object') return o[k];
  if ((depth || 0) >= 3) return null;
  for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { const r = pick_(v, keys, (depth || 0) + 1); if (r != null) return r; } }
  return null;
}
function num_(v) { const n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
function dateOf_(o) {
  if (!o || typeof o !== 'object') return null;
  const d = pick_(o, ['calendarDate', 'date', 'summaryDate', 'sleepDate']) || pick_(o, ['startTimestampLocal', 'startTimeLocal']);
  return isYmd_(String(d || '')) ? String(d).slice(0, 10) : null;
}
function dailyOf_(o) {
  const v = k => num_(pick_(o, k));
  return { total_steps: v(['totalSteps']), resting_heart_rate: v(['restingHeartRate', 'restingHR']),
    avg_resting_heart_rate_7day: v(['lastSevenDaysAvgRestingHeartRate', 'averageRestingHeartRate']),
    average_stress_level: v(['averageStressLevel', 'avgStressLevel', 'overallStressLevel']), max_stress_level: v(['maxStressLevel']),
    body_battery_highest: v(['bodyBatteryHighestValue']), body_battery_lowest: v(['bodyBatteryLowestValue']),
    body_battery_most_recent: v(['bodyBatteryMostRecentValue']), body_battery_at_wake: v(['bodyBatteryAtWakeTime']),
    body_battery_during_sleep: v(['bodyBatteryDuringSleep']), avg_waking_respiration: v(['avgWakingRespirationValue']),
    total_kilocalories: v(['totalKilocalories']), active_kilocalories: v(['activeKilocalories']) };
}
function sleepOf_(o) {
  const dto = o.dailySleepDTO || o, v = k => num_(pick_(dto, k)), top = k => num_(pick_(o, k));
  const sec = v(['sleepTimeSeconds']); if (sec == null) return null;
  const sc = dto.sleepScores || {}, ov = sc.overall;
  return { sleep_time_seconds: sec, deep_sleep_seconds: v(['deepSleepSeconds']), light_sleep_seconds: v(['lightSleepSeconds']),
    rem_sleep_seconds: v(['remSleepSeconds']), awake_sleep_seconds: v(['awakeSleepSeconds']),
    average_hr_sleep: v(['averageHrSleep', 'avgSleepHR', 'avgHeartRate']), resting_heart_rate: top(['restingHeartRate']),
    average_respiration: v(['averageRespirationValue']), avg_sleep_stress: v(['avgSleepStress']),
    body_battery_change: top(['bodyBatteryChange']), avg_overnight_hrv: top(['avgOvernightHrv']),
    sleep_score_overall: num_(ov && typeof ov === 'object' ? ov.value : ov) ?? v(['overallSleepScore', 'sleepScore']),
    sleep_score_feedback: pick_(dto, ['sleepScoreFeedback']), sleep_score_insight: pick_(dto, ['sleepScoreInsight']),
    sleep_end_gmt: num_(pick_(dto, ['sleepEndTimestampGMT'])) };
}
function hrvOf_(o) {
  const s = o.hrvSummary || o, b = s.baseline || {};
  const last = num_(s.lastNightAvg); if (last == null && num_(s.weeklyAvg) == null) return null;
  return { weekly_avg: num_(s.weeklyAvg), last_night_avg: last, last_night_5min_high: num_(s.lastNight5MinHigh), status: s.status || null,
    baseline_low: num_(b.lowUpper ?? s.baselineLowUpper), baseline_upper: num_(b.balancedUpper ?? s.baselineBalancedUpper) };
}
// Body Battery: denní souhrn má highest / lowest / most recent; když chybí, dopočte se z řady [čas GMT ms, úroveň]
function bbOf_(o) {
  const arr = o.bodyBatteryValuesArray || null;   // [[čas GMT ms, „MEASURED“, úroveň, verze]] nebo [[čas, úroveň]]
  const out = { charged: num_(pick_(o, ['charged', 'bodyBatteryChargedValue'])), drained: num_(pick_(o, ['drained', 'bodyBatteryDrainedValue'])) };
  if (Array.isArray(arr)) {
    const pts = arr.map(p => Array.isArray(p) ? [num_(p[0]), num_(p.length > 2 ? p[2] : p[1])] : [num_(p.timestamp || p.startTimestampGMT), num_(p.bodyBatteryLevel || p.level || p.value)]).filter(p => p[0] != null && p[1] != null);
    if (pts.length) { out.pts = pts; out.highest = Math.max.apply(null, pts.map(p => p[1])); out.lowest = Math.min.apply(null, pts.map(p => p[1])); out.most_recent = pts[pts.length - 1][1]; }
  }
  return out;
}
function actOf_(a) {
  if (!a) return {};
  const t = a.activityType || {};
  return { start_time_local: a.startTimeLocal || null, activity_name: a.activityName || null, activity_type: t.typeKey || t || null,
    duration_min: a.duration != null ? Math.round(a.duration / 6) / 10 : null, distance_km: a.distance != null ? Math.round(a.distance / 10) / 100 : null,
    avg_hr: num_(a.averageHR), training_load_value: num_(a.activityTrainingLoad) };
}

// ── historie na Disku ──
function histRead_() {
  const f = fileIn_(HIST_FILE);
  if (!f) return { v: 1, days: {} };
  try { const h = JSON.parse(f.getBlob().getDataAsString('UTF-8')); h.days = h.days || {}; return h; }
  catch (e) { throw new Error(HIST_FILE + ' nejde přečíst (' + e + ') — sync přerušen, soubor nepřepisuji'); }
}
function histPut_(h, date, part, obj) {
  if (!date || !obj) return;
  const d = h.days[date] || (h.days[date] = {});
  const cur = d[part] || {};
  Object.keys(obj).forEach(k => { if (obj[k] != null) cur[k] = obj[k]; });   // nová hodnota nikdy nepřepíše starou prázdnou
  d[part] = cur;
}

function syncTick_() {
  const p = props_(), now = Date.now(), h = +Utilities.formatDate(new Date(), 'Europe/Prague', 'H');
  if (!p.getProperty('GARMIN_API_KEY')) return;
  if (h < SYNC_HOURS_[0] || h > SYNC_HOURS_[1]) return;
  const last = Date.parse(p.getProperty('SYNC_AT') || '') || 0;
  if (now - last < SYNC_EVERY_MIN_ * 60e3 && !p.getProperty('BF_STATE')) return;
  syncGarmin_({});
}
function syncNow() { Logger.log(JSON.stringify(syncGarmin_({ manual: true }), null, 1)); }
function syncFull() { props_().deleteProperty('BF_DONE'); Logger.log(JSON.stringify(syncGarmin_({ manual: true }), null, 1)); }

function syncGarmin_(opt) {
  const p = props_(), lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'Sync už běží' };
  const ctx = { t0: Date.now(), calls: 0, samples: p.getProperty('SAMPLES_DONE') ? null : {}, partial: false, errs: [] };
  try {
    if (!p.getProperty('GARMIN_API_KEY')) throw new Error('Chybí GARMIN_API_KEY ve Vlastnostech skriptu (Garmin Connect web → Nastavení → Personal API Key)');
    const cd = +(p.getProperty('GARMIN_COOLDOWN') || 0);
    if (cd > Date.now()) throw new Error('Pauza po HTTP 429 do ' + new Date(cd).toLocaleTimeString('cs-CZ'));
    const H = histRead_(), today = ymd_(new Date());
    // backfill (první běh / syncFull): po částech přes více běhů, stav v BF_STATE
    const bf = p.getProperty('BF_DONE') ? null : JSON.parse(p.getProperty('BF_STATE') || 'null') || { hrv: addDays_(today, -HRV_BACK_DAYS_), day: addDays_(today, -DAY_BACK_DAYS_) };
    const fromH = bf ? bf.hrv : addDays_(today, -RECENT_DAYS_), fromD = bf ? bf.day : addDays_(today, -RECENT_DAYS_);
    // krok s chybou nezastaví ostatní; vrací true jen při úspěchu (backfill se posune jen po úspěšném kroku)
    const step = (name, fn) => { if (Date.now() - ctx.t0 > RUN_BUDGET_MS_) { ctx.partial = true; return false; } try { fn(); return !ctx.partial; } catch (e) { if (e.stop) throw e; if (/HTTP 401|GARMIN_API_KEY/.test(e)) throw e; ctx.errs.push(name + ': ' + String(e.message || e).slice(0, 200)); return false; } };

    const okH = step('hrv', () => gpRange_(null, 'hrv', fromH, today, { path: (a, b) => '/hrv-service/hrv/daily/' + a + '/' + b }, ctx)
      .forEach(x => histPut_(H, dateOf_(x), 'h', hrvOf_(x))));
    if (bf && okH) bf.hrv = today;
    const okD = [];
    okD.push(step('souhrny', () => gpRange_('/usersummary-service/v2/dailysummaries', 'sum', fromD, today, { params: (a, b) => ({ startDate: a, endDate: b }) }, ctx)
      .forEach(x => histPut_(H, dateOf_(x), 'd', dailyOf_(x)))));
    okD.push(step('spánek', () => gpRange_('/sleep-service/sleep/dailySleepSummariesByDate', 'sleep', fromD, today, { params: (a, b) => ({ startDate: a, endDate: b }) }, ctx)
      .forEach(x => histPut_(H, dateOf_(x), 's', sleepOf_(x)))));
    // poslední noc podrobně (skóre spánku a fáze bývají v denním detailu úplnější)
    step('spánek dnes', () => [today, addDays_(today, -1)].forEach(dd => { const j = gpGet_('/sleep-service/sleep/dailySleep', { date: dd }, ctx); if (j) histPut_(H, dateOf_(j) || dd, 's', sleepOf_(j)); }));
    okD.push(step('body battery', () => gpRange_('/wellness-service/wellness/bodyBattery/reports/daily', 'bb', fromD, today, { params: (a, b) => ({ startDate: a, endDate: b }) }, ctx)
      .forEach(x => { const dd = dateOf_(x), b = bbOf_(x); if (!dd) return;
        const s = (H.days[dd] || {}).s || {}, d = (H.days[dd] || {}).d || {};
        let wake = null; if (b.pts && s.sleep_end_gmt) { const before = b.pts.filter(q => q[0] <= s.sleep_end_gmt); if (before.length) wake = before[before.length - 1][1]; }
        histPut_(H, dd, 'd', { body_battery_highest: d.body_battery_highest ?? b.highest, body_battery_lowest: d.body_battery_lowest ?? b.lowest,
          body_battery_most_recent: d.body_battery_most_recent ?? b.most_recent, body_battery_at_wake: d.body_battery_at_wake ?? wake }); })));
    if (bf && okD.every(Boolean)) bf.day = today;
    step('fitness věk', () => { const j = gpGet_('/fitnessage-service/fitnessage/v2/' + today, null, ctx); if (j) H.fit = { calendar_date: today, chronological_age: num_(pick_(j, ['chronologicalAge'])), fitness_age: num_(pick_(j, ['fitnessAge', 'achievableFitnessAge'])) }; });
    step('aktivita', () => { const j = listOf_(gpGet_('/activitylist-service/activities/search/activities', { start: 0, limit: 1 }, ctx)); if (j[0]) H.act = actOf_(j[0]); });

    // úklid a zápis
    const keepFrom = addDays_(today, -HIST_KEEP_DAYS_);
    Object.keys(H.days).forEach(k => { if (k < keepFrom) delete H.days[k]; });
    H.sync = { at: new Date().toISOString(), calls: ctx.calls, errs: ctx.errs, partial: ctx.partial };
    writeFile_(HIST_FILE, JSON.stringify(H), MimeType.PLAIN_TEXT);
    const out = buildData_(H);
    if (out.nights.length || out.hrv_history.length) writeFile_(DATA_FILE, JSON.stringify(out), MimeType.PLAIN_TEXT);
    // backfill hotový jen když obě části došly až do dneška; jinak pokračuje příští běh od uloženého místa
    if (bf) { if (bf.hrv === today && bf.day === today) { p.setProperty('BF_DONE', new Date().toISOString()); p.deleteProperty('BF_STATE'); } else p.setProperty('BF_STATE', JSON.stringify(bf)); }
    if (ctx.samples && Object.keys(ctx.samples).length) { writeFile_(SAMPLES_FILE, JSON.stringify({ at: new Date().toISOString(), samples: ctx.samples }, null, 1), MimeType.PLAIN_TEXT); p.setProperty('SAMPLES_DONE', new Date().toISOString()); }
    p.setProperty('SYNC_AT', H.sync.at);
    if (ctx.errs.length) p.setProperty('SYNC_ERR', H.sync.at + ' ' + ctx.errs.join(' | ').slice(0, 800)); else p.deleteProperty('SYNC_ERR');
    return { ok: true, calls: ctx.calls, days: Object.keys(H.days).length, nights: out.nights.length, partial: ctx.partial, backfill: !!bf, errs: ctx.errs };
  } catch (e) {
    const m = String(e && e.message || e);
    p.setProperty('SYNC_ERR', new Date().toISOString() + ' ' + m.slice(0, 800));
    return { ok: false, error: m, calls: ctx.calls };
  } finally { lock.releaseLock(); }
}

// Výstup pro stránku = stejný tvar jako local/garmin_data.py → load_data (stránka nepozná, odkud data jsou)
function buildData_(H) {
  const ds = Object.keys(H.days).sort(), last = part => { for (let i = ds.length - 1; i >= 0; i--) if (H.days[ds[i]][part]) return ds[i]; return null; };
  const lbl = d => +d.slice(8, 10) + '.' + +d.slice(5, 7) + '.';
  const dD = last('d'), dH = last('h'), dS = last('s');
  const daily = dD ? Object.assign({ calendar_date: dD }, H.days[dD].d) : {};
  const hrv = dH ? Object.assign({ calendar_date: dH }, H.days[dH].h) : {};
  let sleep = {};
  if (dS) { const s = H.days[dS].s; sleep = Object.assign({ calendar_date: dS }, s, { sleep_hours: s.sleep_time_seconds != null ? Math.round(s.sleep_time_seconds / 36) / 100 : null,
    deep_min: s.deep_sleep_seconds != null ? Math.round(s.deep_sleep_seconds / 60) : null, light_min: s.light_sleep_seconds != null ? Math.round(s.light_sleep_seconds / 60) : null,
    rem_min: s.rem_sleep_seconds != null ? Math.round(s.rem_sleep_seconds / 60) : null, awake_min: s.awake_sleep_seconds != null ? Math.round(s.awake_sleep_seconds / 60) : null }); }
  const from = addDays_(ymd_(new Date()), -NIGHTS_DAYS_);
  const nights = ds.filter(d => d >= from && H.days[d].s).map(d => { const x = H.days[d], s = x.s, dd = x.d || {}, h = x.h || {}, m = v => v != null ? Math.round(v / 60) : null;
    return { calendar_date: d, date: d, label: lbl(d), hours: s.sleep_time_seconds != null ? Math.round(s.sleep_time_seconds / 36) / 100 : null, score: s.sleep_score_overall ?? null,
      hr: s.resting_heart_rate ?? dd.resting_heart_rate ?? null, bb: dd.body_battery_at_wake ?? null, bb_change: s.body_battery_change ?? null, stress: s.avg_sleep_stress ?? null,
      resp: s.average_respiration ?? null, hrv: h.last_night_avg ?? s.avg_overnight_hrv ?? null, deep_min: m(s.deep_sleep_seconds), rem_min: m(s.rem_sleep_seconds),
      light_min: m(s.light_sleep_seconds), awake_min: m(s.awake_sleep_seconds) }; });
  const hrv_history = ds.filter(d => H.days[d].h && H.days[d].h.last_night_avg != null).map(d => { const h = H.days[d].h;
    return { date: d, label: lbl(d), hrv: h.last_night_avg, avg7: h.weekly_avg ?? null, status: h.status ?? null, baseline_low: h.baseline_low ?? null, baseline_upper: h.baseline_upper ?? null }; });
  return { v: 1, source: 'garmin-personal-api', exported_at: new Date().toISOString(), updated_at: Utilities.formatDate(new Date(), 'Europe/Prague', 'HH:mm:ss'),
    date: dD || dS || ymd_(new Date()), daily: daily, hrv: hrv, sleep_latest: sleep,
    readiness: {}, training_status: {},   // Personal API je nevrací (training readiness / status „not found“) — stránka připravenost odhadne sama
    fitness: H.fit || {}, nights: nights, hrv_history: hrv_history, last_activity: H.act || {} };
}

// Připomínka vypršení klíče: od 30 dní předem 1× týdně e-mail (datum vypršení zadává Pavel do GARMIN_KEY_EXP)
function keyExpWatch_() {
  const p = props_(), exp = p.getProperty('GARMIN_KEY_EXP'); if (!exp || !isYmd_(exp)) return;
  const left = Math.round((Date.parse(exp + 'T00:00:00Z') - Date.now()) / 864e5);
  if (left > 30) return;
  const wk = Utilities.formatDate(new Date(), 'Europe/Prague', 'YYYY-ww');
  if (p.getProperty('KEYEXP_MAIL_WK') === wk) return;
  MailApp.sendEmail(p.getProperty('ALERT_EMAIL') || Session.getEffectiveUser().getEmail(), 'Garmin Health: klíč Personal API vyprší ' + (left > 0 ? 'za ' + left + ' dní' : 'už vypršel'),
    'Klíč Garmin Personal API ' + (left > 0 ? 'vyprší ' + exp : 'vypršel ' + exp) + '.\n1) Garmin Connect (web) → Nastavení → Personal API Key → Create Key (platnost 1 rok)\n2) Apps Script „Garmin Health“ → Nastavení projektu → Vlastnosti skriptu: GARMIN_API_KEY = nový klíč, GARMIN_KEY_EXP = nové datum vypršení\n3) Starý klíč v Garmin Connect zruš.');
  p.setProperty('KEYEXP_MAIL_WK', wk);
}

// Ověření v editoru: token + jeden dotaz na každý endpoint za včerejšek, do protokolu klíče odpovědí, vzorky na Disk
function testGarmin() {
  const ctx = { t0: Date.now(), calls: 0, samples: {}, partial: false };
  try { gpToken_(true); Logger.log('✓ Token Personal API OK'); } catch (e) { Logger.log('✖ ' + e); return; }
  const y = addDays_(ymd_(new Date()), -1), w = addDays_(y, -6);
  [['HRV', '/hrv-service/hrv/daily/' + w + '/' + y, null], ['souhrny', '/usersummary-service/v2/dailysummaries', { startDate: w, endDate: y }],
   ['spánek (rozsah)', '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: w, endDate: y }], ['spánek (den)', '/sleep-service/sleep/dailySleep', { date: y }],
   ['body battery', '/wellness-service/wellness/bodyBattery/reports/daily', { startDate: w, endDate: y }], ['fitness věk', '/fitnessage-service/fitnessage/v2/' + y, null],
   ['aktivity', '/activitylist-service/activities/search/activities', { start: 0, limit: 1 }]].forEach(t => {
    try { const j = gpGet_(t[1], t[2], ctx); const l = listOf_(j); Logger.log('✓ %s: %s záznamů, 1. datum %s, klíče: %s', t[0], j == null ? 0 : l.length, l[0] ? dateOf_(l[0]) : '—', l[0] && typeof l[0] === 'object' ? Object.keys(l[0]).slice(0, 25).join(', ') : '—'); }
    catch (e) { Logger.log('✖ %s: %s', t[0], e.message || e); }
  });
  writeFile_(SAMPLES_FILE, JSON.stringify({ at: new Date().toISOString(), samples: ctx.samples }, null, 1), MimeType.PLAIN_TEXT);
  Logger.log('Vzorky odpovědí: Garmin Data/%s (%s volání)', SAMPLES_FILE, ctx.calls);
}
