// ══════════════ GARMIN HEALTH — Google Apps Script ══════════════
// Stejný vzor jako Tradelog (EdgePilot):
//   • stránku dashboardu načítá při každém otevření z GitHubu (větev GH_BRANCH) → push do main = nasazení na PC, iPad i iPhone
//   • data čte z Google Disku „Můj disk/Garmin Data/garmin-data.json“ — zapisuje je PC (local/garmin_export.py přes Disk pro počítače);
//     přihlášení ke Garminu zůstává jen na PC, v cloudu žádné heslo ani token Garminu není
//   • prahy a zóny dashboardu ukládá na Disk (garmin-settings.json) → stejné na všech zařízeních
//   • kód se aktualizuje sám: selfUpdateTick 1× za hodinu stáhne apps-script/garmin-apps-script.gs z GitHubu
// Vlastnosti skriptu: SYNC_KEY (vytvoří setup), GH_REPO = komarekpol/garmin-health, GH_TOKEN (fine-grained, Contents: read),
// GH_BRANCH (výchozí main), volitelně SELF_FILE (výchozí „garmin“), ALERT_EMAIL (výchozí vlastník skriptu).
// Pojistka samoaktualizace: soubor musí obsahovat function selfUpdate( a function doGet(.

const UA = 'garmin-health-apps-script';
const DATA_FOLDER_NAME = 'Garmin Data';
const DATA_FILE = 'garmin-data.json';
const SETTINGS_FILE = 'garmin-settings.json';
const HTML_COPY_FILE = 'garmin-dashboard-zaloha.html';   // poslední dobrá stránka z GitHubu (výpadek GitHubu = stránka dál běží)
const HEALTH_FILE = 'garmin-health-stav.json';            // stav částí systému (čte Claude při kontrole) — malý soubor
const SETTINGS_MAX_ = 50000;                               // prahy + zóny dnes ~1 tis. znaků
const DATA_MAX_ = 8000000;                                 // google.script.run a stránka; export dnes ~0,1–0,2 MB
const STALE_H_ = 30;                                       // data starší = PC 3× denně nesynchronizuje → e-mail 1× denně
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
  if (!f) return { ok: false, error: 'Na Disku zatím není ' + DATA_FOLDER_NAME + '/' + DATA_FILE + ' — na PC spusť „Nastavit automaticky sync.bat“ nebo „Start Garmin Dashboard“.' };
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
    selfSha: p.getProperty('SELF_SHA'), selfAt: p.getProperty('SELF_AT'), selfErr: p.getProperty('SELF_ERR'), staleMail: p.getProperty('STALE_MAIL_DAY'),
    triggers: (() => { try { return ScriptApp.getProjectTriggers().map(x => x.getHandlerFunction()); } catch (e) { return null; } })() };
}
function staleWatch_() {
  const d = dataRead_(), p = props_(), day = Utilities.formatDate(new Date(), 'Europe/Prague', 'yyyy-MM-dd');
  const bad = !d.ok ? d.error : d.ageH > STALE_H_ ? 'Data na Disku jsou stará ' + Math.round(d.ageH) + ' h (poslední export ' + d.at + '). Běží PC a úloha „Garmin Health\\Sync a export“ v Plánovači úloh? Výstup posledního běhu: C:\\Garmin Dashboard\\sync_log.txt' : null;
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
  try { staleWatch_(); } catch (e) { console.warn('staleWatch_: ' + e); }
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
