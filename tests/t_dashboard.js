// Test dashboardu bez osobních dat (Playwright + Chromium).
//   node tests/t_dashboard.js   (cloudová data = výstup Apps Scriptu z tests/t_gas_sync.js; spustí ho sám, když chybí)
// A) cloud: stránka projde stejným wrapScripts_ jako v Apps Scriptu (načtený z apps-script/garmin-apps-script.gs),
//    google.script.run je model (ghGet / ghSync / ghSet / ghJournalSet / ghJournalCfg) se záznamem volání.
// B) lokálně: file:// + skutečný garmin_server.py nad syntetickou DB (deník a prahy do souborů).
// Data pro Vlivy: do ukázky se vloží známý vliv (po dni s alkoholem HRV −8 ms) a test ověří, že ho analýza najde.
// CDN knihovny z node_modules (bez sítě), fonty se zahodí. Snímky stránek do tests/out/.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SAMPLE = path.join(OUT, 'sample-api.json');
if (!fs.existsSync(SAMPLE)) cp.execFileSync('node', [path.join(__dirname, 't_gas_sync.js')], { stdio: 'inherit' });
const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'garmin-dashboard.html'), 'utf8');

// známý vliv: každý 4. den z posledních 120 alkohol (2 skl.) → HRV dalšího rána −8 ms; každý 5. den hořčík bez vlivu
const add = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const journal = { v: 1, days: {}, cfg: { sup: [{ id: 'mg', l: 'Hořčík' }], tags: [{ id: 'masaz', l: 'Masáž' }] } };
const byD = {}; sample.days.forEach(x => { byD[x.d] = x; });
sample.days.slice(-121, -1).forEach((x, i) => {
  const j = { t: {}, sup: [], m: [] };
  if (i % 4 === 0) { j.t.alk = 2; const n = byD[add(x.d, 1)]; if (n && n.hrv != null) n.hrv -= 8; }
  if (i % 5 === 0) j.sup.push('mg');
  if (i % 3 === 0) j.m.push({ s: 've', h: '19:00', w: 'večeře' });
  j.n = 'den ' + i; journal.days[x.d] = j;
});

const gsCtx = {}; vm.createContext(gsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/garmin-apps-script.gs'), 'utf8'), gsCtx);
const LIB = { 'chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js' };
async function routes(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com/, r => { const f = Object.keys(LIB).find(k => r.request().url().endsWith(k)); return f ? r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, LIB[f])) }) : r.abort(); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
}
let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || info == null ? '' : ' — ' + info)); if (!cond) fails++; };
const watch = page => { const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); }); return errs; };
const PAGES = ['dnes', 'trendy', 'denik', 'vlivy', 'inov', 'nast'];

async function cloud(browser, opt) {
  const settings = { garmin_thresholds: JSON.stringify({ hrv_ok: { val: 31 } }) };
  const reply = Object.assign({ ok: true, data: sample, settings, journal, at: sample.exported_at, ageH: 2.5, stale: false }, opt.reply || {});
  const inj = '<script>window.__GH_CLOUD__=' + JSON.stringify({ key: 'testkey', build: { sha: 'abc1234', src: 'github' } }) + ';</script>'
    + '<script>window.__CALLS__=[];window.__REPLY__=' + JSON.stringify(reply).replace(/</g, '\\u003c') + ';'
    + 'window.google={script:{run:(function mk(ok,fail){return new Proxy({},{get:(t,k)=>k==="withSuccessHandler"?(f=>mk(f,fail)):k==="withFailureHandler"?(f=>mk(ok,f)):'
    + '(...a)=>setTimeout(()=>{window.__CALLS__.push([k].concat(a));if(k==="ghGet")ok(JSON.stringify(window.__REPLY__));else if(k==="ghSync")ok(JSON.stringify(Object.assign({},window.__REPLY__,{sync:{ok:true,calls:7,errs:[]}})));'
    + 'else if(k==="ghJournalSet"&&window.__CONFLICT__)ok(JSON.stringify({ok:false,conflict:true,day:window.__CONFLICT__}));'
    + 'else if(k==="ghSet"||k==="ghJournalSet"||k==="ghJournalCfg")ok(JSON.stringify({ok:true}));else fail(new Error("?"+k));},20)})})()}};</script>';
  const page_ = gsCtx.wrapScripts_(html).replace(/<head[^>]*>/i, m => m + inj);
  const ctx = await browser.newContext({ viewport: opt.vp || { width: 1400, height: 1000 } });
  await routes(ctx);
  const page = await ctx.newPage(), errs = watch(page);
  await page.setContent(page_, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  return { ctx, page, errs };
}
const calls = (page, k) => page.evaluate(k => window.__CALLS__.filter(c => c[0] === k), k);
const go = async (page, p) => { await page.evaluate(p => go(p), p); await page.waitForTimeout(250); };
const txt = (page, sel) => page.$eval(sel, e => e.innerText);

(async () => {
  const exe = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    ok('garmin-dashboard.html odpovídá src/ (tools/build.py)', cp.spawnSync('python3', [path.join(ROOT, 'tools/build.py'), '--check']).status === 0);
    // ── A) cloud, desktop ──
    {
      const { ctx, page, errs } = await cloud(browser, {});
      ok('desktop: boční panel viditelný, spodní lišta skrytá', await page.$eval('#sidenav', e => getComputedStyle(e).display !== 'none') && await page.$eval('#bnav', e => getComputedStyle(e).display === 'none'));
      const dn = await txt(page, '#p-dnes');
      ok('Dnes: připravenost (odhad) s číslem', /PŘIPRAVENOST \(ODHAD\)/i.test(dn) && /\d+\s*ze 100/.test(dn), dn.slice(0, 200));
      ok('Dnes: 6 KPI dlaždic', (await page.$$('#p-dnes .kpi')).length === 6);
      ok('Dnes: práh z Disku (HRV normál 31) ovlivní upozornění', /HRV (nízká|kritická|v normálu)/.test(dn));
      ok('Dnes: minigrafy', (await page.$$('#p-dnes .spark')).length >= 4);
      ok('Dnes: 6 budíků', (await page.$$('#p-dnes .gauge')).length === 6);
      const br = await page.$$eval('#p-dnes .brief .br', e => e.map(x => x.innerText));
      ok('Dnes: Krátce — aspoň 1 řádek, bez NaN / undefined', br.length >= 1 && !br.some(t => /NaN|undefined/.test(t)), br.join(' | '));
      ok('Dnes: co ovlivňuje HRV — najde alkohol', /Alkohol/.test(await txt(page, '#p-dnes')), (await txt(page, '#p-dnes')).slice(-400));
      ok('hlavička: čas syncu', /sync .* · před [23] h/.test(await txt(page, '#age')), await txt(page, '#age'));
      await page.screenshot({ path: path.join(OUT, 'd-dnes.png'), fullPage: true });
      // rychlý štítek z Dnes → ghJournalSet
      await page.click('#quick [data-t="kava_pozde"]'); await page.waitForTimeout(900);
      let js = await calls(page, 'ghJournalSet');
      const today = await page.evaluate(() => TODAY());
      ok('Dnes: rychlý štítek uloží deník (ghJournalSet)', js.length === 1 && js[0][2] === today && JSON.parse(js[0][3]).t.kava_pozde === 1, JSON.stringify(js).slice(0, 200));
      // souběh: mezitím přišel záznam z chatu → stránka převezme stav serveru, nic nepřepíše
      await page.evaluate(() => { window.__CONFLICT__ = { t: { alk: 1, kava_pozde: 1 }, m: [{ s: 'ob', h: '12:30', w: 'z chatu' }], src: 'chat', at: '2026-10-30T15:00:00.000Z' }; });
      await page.click('#quick [data-t="stres"]'); await page.waitForTimeout(900);
      const jc = await page.evaluate(() => JR.days[TODAY()]);
      ok('Dnes: souběh se záznamem z chatu → převezme stav serveru + hláška', jc && jc.src === 'chat' && jc.t.alk === 1 && !jc.t.stres && /mezitím změnil/.test(await txt(page, '#jst')), JSON.stringify(jc) + ' ' + await txt(page, '#jst'));
      await page.evaluate(() => { window.__CONFLICT__ = null; });
      await page.click('#quick [data-t="stres"]'); await page.waitForTimeout(900);
      const jl = (await calls(page, 'ghJournalSet')).pop();
      ok('Dnes: po převzetí další změna odejde s at serveru', JSON.parse(jl[3]).at === '2026-10-30T15:00:00.000Z' && JSON.parse(jl[3]).t.stres === 1 && JSON.parse(jl[3]).m[0].w === 'z chatu');
      // Sync = jedno tlačítko
      await page.click('#syncBtn'); await page.waitForTimeout(400);
      ok('Sync: jedno tlačítko → ghSync a znovu aktivní', (await calls(page, 'ghSync')).length === 1 && await page.$eval('#syncBtn', e => !e.disabled));
      // Trendy
      await go(page, 'trendy');
      for (const m of ['hrv', 'rhr', 'bb', 'resp', 'sleep', 'st']) {
        await page.click(`#tmet [data-k="${m}"]`); await page.waitForTimeout(150);
        const drawn = await page.evaluate(() => !!CH && CH.data.datasets.some(d => d.data.some(v => v != null)));
        ok(`Trendy: ${m} vykreslí data`, drawn);
      }
      await page.click('#tmet [data-k="hrv"]'); await page.click('#trng [data-v="90"]'); await page.waitForTimeout(150);
      ok('Trendy: rozsah 90 d', await page.evaluate(() => CH.data.labels.length >= 85 && CH.data.labels.length <= 91), await page.evaluate(() => CH.data.labels.length));
      await page.fill('#z1', '24'); await page.dispatchEvent('#z1', 'change'); await page.waitForTimeout(700);
      const zs = (await calls(page, 'ghSet')).map(c => JSON.parse(c[2])).find(o => o.garmin_vst_zones);
      ok('Trendy: změna zóny se uloží na Disk', zs && JSON.parse(zs.garmin_vst_zones).z1 === 24, JSON.stringify(zs));
      await page.screenshot({ path: path.join(OUT, 'd-trendy.png'), fullPage: true });
      await page.click('#tmet [data-k="sleep"]'); await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, 'd-trendy-spanek.png'), fullPage: true });
      // Deník
      await go(page, 'denik');
      ok('Deník: skupiny štítků a doplněk z nastavení', /Jídlo a pití/i.test(await txt(page, '#p-denik')) && /Hořčík/.test(await txt(page, '#p-denik')) && /Masáž/.test(await txt(page, '#p-denik')));
      ok('Deník: aktivity z Garminu', /Běh/.test(await txt(page, '#p-denik')));
      await page.click('#p-denik [data-t="alk"] [data-a="+"]'); await page.click('#p-denik [data-t="alk"] [data-a="+"]');
      await page.fill('#jmeals .meal:nth-child(3) input[type=time]', '21:15'); await page.fill('#jmeals .meal:nth-child(3) input[type=text]', 'těstoviny');
      await page.click('#jsup [data-s="mg"]');
      await page.fill('#jnote', 'unavený'); await page.waitForTimeout(1000);
      js = await calls(page, 'ghJournalSet'); const lastDay = JSON.parse(js[js.length - 1][3]);
      ok('Deník: alkohol 2, jídlo s časem, doplněk a poznámka se uloží', lastDay.t.alk === 2 && lastDay.m.some(m => m.h === '21:15' && m.w === 'těstoviny') && lastDay.sup.includes('mg') && lastDay.n === 'unavený', JSON.stringify(lastDay));
      ok('Deník: stav „Uloženo“', /Uloženo/.test(await txt(page, '#jst')));
      await page.click('#jprev'); await page.waitForTimeout(150);
      ok('Deník: předchozí den ukáže uložený záznam', /^den \d+$/.test(await page.$eval('#jnote', e => e.value)), await page.$eval('#jnote', e => e.value));
      await page.screenshot({ path: path.join(OUT, 'd-denik.png'), fullPage: true });
      // Vlivy
      await go(page, 'vlivy');
      const inf = await page.evaluate(() => influence('hrv').ok.map(r => [r.f.id, Math.round(r.e * 10) / 10, Math.round(r.t * 10) / 10, r.n1]));
      const alk = inf.find(r => r[0] === 't:alk');
      ok('Vlivy: alkohol −8 ms HRV nalezen jako průkazný a první', alk && alk[1] <= -6 && alk[1] >= -10 && Math.abs(alk[2]) >= 2 && inf[0][0].startsWith('t:alk'), JSON.stringify(inf.slice(0, 4)));
      const mg = inf.find(r => r[0] === 's:mg');
      ok('Vlivy: hořčík (bez vlivu) není průkazný', mg && Math.abs(mg[2]) < 2, JSON.stringify(mg));
      ok('Vlivy: faktory z Garminu (trénink, otužování)', inf.some(r => r[0] === 'g:train') && inf.some(r => r[0] === 'g:cold'), JSON.stringify(inf.map(r => r[0])));
      for (const k of ['sc', 'rhr', 'bb']) { await page.click(`#vout [data-k="${k}"]`); await page.waitForTimeout(100); }
      ok('Vlivy: přepínání výsledků bez chyb', /Body Battery ráno ráno po dni/.test(await txt(page, '#p-vlivy')));
      await page.click('#vout [data-k="hrv"]');
      await page.screenshot({ path: path.join(OUT, 'd-vlivy.png'), fullPage: true });
      // Inovace
      const nb0 = await page.$eval('#sidenav [data-nb="inov"]', e => +e.textContent || 0);
      await go(page, 'inov');
      const nIv = (await page.$$('#p-inov .iv')).length;
      ok('Inovace: návrhy k hlasování + odznak', nIv >= 3 && nb0 === nIv, nb0 + ' / ' + nIv);
      const id1 = await page.$eval('#p-inov .iv', e => e.dataset.id);
      await page.click(`#p-inov .iv[data-id="${id1}"] [data-vote="ano"]`); await page.waitForTimeout(700);
      const ui1 = (await calls(page, 'ghSet')).map(c => JSON.parse(c[2])).filter(o => o.garmin_ui).pop();
      ok('Inovace: hlas „Chci“ → garmin_ui na Disk', ui1 && JSON.parse(ui1.garmin_ui).inov[id1].v === 'ano', JSON.stringify(ui1));
      ok('Inovace: schválený se přesune a odznak klesne', /Schváleno — zavedu\s*1/.test(await txt(page, '#p-inov')) && await page.$eval('#sidenav [data-nb="inov"]', e => +e.textContent || 0) === nb0 - 1);
      await page.fill('#npod', 'Chci vidět vliv tréninku na spánek'); await page.click('#apod'); await page.waitForTimeout(700);
      const ui2 = (await calls(page, 'ghSet')).map(c => JSON.parse(c[2])).filter(o => o.garmin_ui).pop();
      ok('Inovace: podnět se uloží a hlas zůstane', ui2 && JSON.parse(ui2.garmin_ui).pod[0].t === 'Chci vidět vliv tréninku na spánek' && JSON.parse(ui2.garmin_ui).inov[id1].v === 'ano');
      await page.screenshot({ path: path.join(OUT, 'd-inov.png'), fullPage: true });
      // Nastavení
      await go(page, 'nast');
      await page.fill('[data-th="hr_warn"]', '58'); await page.dispatchEvent('[data-th="hr_warn"]', 'change'); await page.waitForTimeout(700);
      const th = (await calls(page, 'ghSet')).map(c => JSON.parse(c[2])).filter(o => o.garmin_thresholds).pop();
      ok('Nastavení: práh se uloží', th && JSON.parse(th.garmin_thresholds).hr_warn.val === 58);
      await page.fill('#nsup', 'Vitamín D3'); await page.click('#asup'); await page.waitForTimeout(200);
      const cf = await calls(page, 'ghJournalCfg');
      ok('Nastavení: nový doplněk → ghJournalCfg', cf.length === 1 && JSON.parse(cf[0][2]).sup.some(s => s.l === 'Vitamín D3' && s.id === 'vitamin_d3'), JSON.stringify(cf));
      await page.screenshot({ path: path.join(OUT, 'd-nast.png'), fullPage: true });
      await page.click('#theme [data-v="graphite"]'); await page.waitForTimeout(150);
      ok('Nastavení: motiv Grafit', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'graphite');
      await page.click('#theme [data-v="slate"]');
      ok('cloud desktop: bez chyb v konzoli', errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    }
    // ── telefon 390 px a tablet 900 px ──
    {
      const { ctx, page, errs } = await cloud(browser, { vp: { width: 390, height: 844 } });
      ok('telefon: spodní lišta, bez boční a horní', await page.$eval('#bnav', e => getComputedStyle(e).display === 'flex') && await page.$eval('#tabs', e => getComputedStyle(e).display === 'none') && await page.$eval('#sidenav', e => getComputedStyle(e).display === 'none'));
      for (const p of PAGES) {
        await page.click(`#bnav [data-p="${p}"]`); await page.waitForTimeout(250);
        const w = await page.evaluate(() => document.documentElement.scrollWidth);
        ok(`telefon: ${p} se vejde na šířku (390 px)`, w <= 390, w + ' px');
        await page.screenshot({ path: path.join(OUT, `m-${p}.png`), fullPage: true });
      }
      const tgt = await page.$$eval('#bnav .bnav-i', b => b.map(x => x.getBoundingClientRect().height));
      ok('telefon: dotykové plochy lišty ≥ 44 px', tgt.every(h => h >= 44), tgt.join(','));
      ok('telefon: bez chyb', errs.length === 0, errs.join(' | '));
      await ctx.close();
      const t = await cloud(browser, { vp: { width: 900, height: 1100 } });
      ok('tablet: horní pás sekcí', await t.page.$eval('#tabs', e => getComputedStyle(e).display === 'flex'));
      await t.page.screenshot({ path: path.join(OUT, 't-dnes.png'), fullPage: false });
      await t.ctx.close();
    }
    // ── stará data, chyba, chybějící deník ──
    {
      const { ctx, page, errs } = await cloud(browser, { reply: { ageH: 40, stale: true } });
      ok('stará data: upozornění + vykreslení', /stará 40 h/.test(await txt(page, '#note')) && (await page.$$('#p-dnes .kpi')).length === 6);
      ok('stará data: bez chyb', errs.length === 0, errs.join(' | '));
      await ctx.close();
      const e2 = await cloud(browser, { reply: { ok: false, data: null, error: 'Na Disku zatím není Garmin Data/garmin-data.json' } });
      ok('chybějící data: srozumitelná hláška', /Na Disku zatím není/.test(await txt(e2.page, '#note')));
      await e2.ctx.close();
      const e3 = await cloud(browser, { reply: { journal: undefined, journalErr: 'SyntaxError' } });
      ok('nečitelný deník: upozornění, zbytek běží', /Deník se nepodařilo načíst/.test(await txt(e3.page, '#note')) && (await e3.page.$$('#p-dnes .kpi')).length === 6);
      ok('nečitelný deník: bez chyb', e3.errs.length === 0, e3.errs.join(' | '));
      await e3.ctx.close();
    }
    // ── B) lokálně: file:// + garmin_server.py ──
    {
      const td = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-'));
      const db = path.join(td, 'garmin.db');
      cp.execFileSync('python3', ['-c', `import sys;sys.path.insert(0,${JSON.stringify(__dirname)});import test_local;test_local.make_db(${JSON.stringify(db)})`]);
      const exp = path.join(td, 'Garmin Data');
      const env = Object.assign({}, process.env, { GARMIN_DB: db, GARMIN_SETTINGS_DIR: exp, PYTHONUTF8: '1' });
      const srv = cp.spawn('python3', ['-c', 'import garmin_server as g;from http.server import HTTPServer;HTTPServer(("localhost",8765),g.Handler).serve_forever()'], { cwd: path.join(ROOT, 'local'), env });
      await new Promise(r => setTimeout(r, 1200));
      try {
        const fileHtml = path.join(td, 'garmin-dashboard.html'); fs.writeFileSync(fileHtml, html);
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); await routes(ctx);
        const page = await ctx.newPage(), errs = watch(page);
        await page.goto('file://' + fileHtml, { waitUntil: 'load' });
        await page.evaluate(() => localStorage.setItem('garmin_vst_zones', JSON.stringify({ z1: 25, z2: 29, avgDays: 7 })));
        await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
        const sf = path.join(exp, 'garmin-settings.json'), st0 = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : {};
        ok('lokálně: migrace zón z prohlížeče na Disk', st0.garmin_vst_zones && JSON.parse(st0.garmin_vst_zones).z1 === 25, JSON.stringify(st0).slice(0, 150));
        ok('lokálně: Dnes vykreslen', (await page.$$('#p-dnes .kpi')).length === 6 && /ze 100/.test(await txt(page, '#p-dnes')));
        await page.click('#quick [data-t="stres"]'); await page.waitForTimeout(1100);
        const jf = path.join(exp, 'garmin-journal.json'), jj = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, 'utf8')) : {};
        ok('lokálně: deník se uloží do garmin-journal.json', Object.values(jj.days || {}).some(d => d.t && d.t.stres === 1), JSON.stringify(jj).slice(0, 150));
        await go(page, 'trendy');
        ok('lokálně: Trendy HRV z nocí a historie', await page.evaluate(() => !!CH && CH.data.datasets[0].data.some(v => v != null)));
        await go(page, 'vlivy'); await go(page, 'denik'); await go(page, 'nast');
        ok('lokálně: bez chyb', errs.length === 0, errs.slice(0, 3).join(' | '));
        await ctx.close();
      } finally { srv.kill(); }
    }
    // ── Apps Script: pojistky ──
    {
      const gs = fs.readFileSync(path.join(ROOT, 'apps-script/garmin-apps-script.gs'), 'utf8');
      ok('gs: obsahuje function selfUpdate( a function doGet(', gs.includes('function selfUpdate(') && gs.includes('function doGet('));
      const w = gsCtx.wrapScripts_(html);
      ok('gs: obal nenechá ve skriptech „//“ ani „<“', !/s\.text="[^"]*\/\//.test(w) && !/s\.text="[^"]*</.test(w));
    }
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} FAIL` : '\nvše OK');
  process.exit(fails ? 1 : 0);
})();
