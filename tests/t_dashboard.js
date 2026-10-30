// Test dashboardu bez osobních dat (Playwright + Chromium).
//   node tests/t_dashboard.js   (cloudová data = výstup Apps Scriptu z tests/t_gas_sync.js; spustí ho sám, když chybí)
// A) cloud: stránka projde stejným wrapScripts_ jako v Apps Scriptu (načtený z apps-script/garmin-apps-script.gs),
//    google.script.run je model (ghGet / ghSet). B) lokálně: file:// + skutečný garmin_server.py nad syntetickou DB.
// CDN knihovny se servírují z node_modules (bez sítě), fonty se zahodí. Snímky do tests/out/.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SAMPLE = path.join(OUT, 'sample-api.json');
if (!fs.existsSync(SAMPLE)) cp.execFileSync('node', [path.join(__dirname, 't_gas_sync.js')], { stdio: 'inherit' });
const sample = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'garmin-dashboard.html'), 'utf8');

// skutečná funkce wrapScripts_ z Apps Scriptu
const gsCtx = {}; vm.createContext(gsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script/garmin-apps-script.gs'), 'utf8'), gsCtx);
const LIB = {
  'chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
  'hammer.min.js': 'node_modules/hammerjs/hammer.min.js',
  'chartjs-plugin-zoom.min.js': 'node_modules/chartjs-plugin-zoom/dist/chartjs-plugin-zoom.min.js',
};
async function routes(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com/, r => {
    const f = Object.keys(LIB).find(k => r.request().url().endsWith(k));
    return f ? r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, LIB[f])) }) : r.abort();
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
}

let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !info ? '' : ' — ' + info)); if (!cond) fails++; };
const watch = page => { const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errs.push(m.text()); }); return errs; };
const TABS = ['vst', 'hr', 'bb', 'resp', 'sleep'];

async function exerciseTabs(page, errs, tag) {
  for (const t of TABS) {
    await page.click(`.tab-btn[onclick*="'${t}'"]`);
    await page.waitForTimeout(250);
    const n = await page.$$eval(`#tab-${t} canvas`, cs => cs.filter(c => c.width > 0 && c.height > 0).length);
    ok(`${tag}: záložka ${t} vykreslí graf`, n > 0, 'canvasů ' + n);
  }
  ok(`${tag}: bez chyb v konzoli`, errs.length === 0, errs.slice(0, 3).join(' | '));
}

async function cloud(browser, opt) {
  const settings = { garmin_thresholds: JSON.stringify({ hrv_ok: { val: 31 } }) };
  const reply = Object.assign({ ok: true, data: sample, settings, at: sample.exported_at, ageH: 2.5, stale: false }, opt.reply || {});
  const inj = '<script>window.__GH_CLOUD__=' + JSON.stringify({ key: 'testkey', build: { sha: 'abc1234', src: 'github' } }) + ';</script>'
    + '<script>window.__SET__=[];window.google={script:{run:(function mk(ok,fail){return new Proxy({},{get:(t,k)=>k==="withSuccessHandler"?(f=>mk(f,fail)):k==="withFailureHandler"?(f=>mk(ok,f)):'
    + '(...a)=>setTimeout(()=>{if(k==="ghGet")ok(JSON.stringify(' + JSON.stringify(reply) + '));else if(k==="ghSync"){window.__SYNC__=(window.__SYNC__||0)+1;ok(JSON.stringify(Object.assign(' + JSON.stringify(reply) + ',{sync:{ok:true,calls:7,errs:[]}})));}else if(k==="ghSet"){window.__SET__.push(a);ok(JSON.stringify({ok:true}));}else fail(new Error("?"+k));},30)})})()}};</script>';
  const page_ = gsCtx.wrapScripts_(html).replace(/<head[^>]*>/i, m => m + inj);
  const ctx = await browser.newContext({ viewport: opt.vp || { width: 1400, height: 1000 } });
  await routes(ctx);
  const page = await ctx.newPage(), errs = watch(page);
  await page.setContent(page_, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { ctx, page, errs };
}

(async () => {
  const exe = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    // ── A) cloud ──
    {
      const { ctx, page, errs } = await cloud(browser, {});
      ok('cloud: banner readiness', (await page.$eval('#readinessBanner', e => e.innerText.trim().length)) > 0);
      ok('cloud: karty', (await page.$$eval('#tab-overview canvas, #tab-overview svg', e => e.length)) > 0);
      ok('cloud: hlavička ukazuje čas syncu', /sync .* · před [23] h/.test(await page.$eval('#lastUpdated', e => e.innerText)), await page.$eval('#lastUpdated', e => e.innerText));
      ok('cloud: připravenost = odhad (API readiness nemá)', /Připravenost \(odhad\)/i.test(await page.$eval('#cardsGrid', e => e.innerText)) && /odhad z HRV/.test(await page.$eval('#readinessBanner', e => e.innerText)), await page.$eval('#readinessBanner', e => e.innerText));
      ok('cloud: Sync Garmin viditelný', await page.$eval('#syncBtn', e => getComputedStyle(e).display !== 'none'));
      await page.click('#syncBtn'); await page.waitForTimeout(600);
      ok('cloud: Sync Garmin → ghSync a překreslení', (await page.evaluate(() => window.__SYNC__)) === 1 && await page.$eval('#syncBtn', e => !e.disabled) && await page.$eval('#serverError', e => getComputedStyle(e).display === 'none'));
      ok('cloud: bez hlášky chyby', await page.$eval('#serverError', e => getComputedStyle(e).display === 'none'));
      ok('cloud: prahy z Disku (HRV normál 31)', /31/.test(await page.$eval('.thresh-editable[data-key="hrv_ok"]', e => e.innerText)));
      await page.screenshot({ path: path.join(OUT, 'cloud-desktop.png'), fullPage: true });
      // úprava prahu → ghSet s klíčem garmin_thresholds
      await page.$eval('.thresh-editable[data-key="hr_warn"]', e => { e.textContent = '58'; e.dispatchEvent(new Event('blur')); });
      await page.waitForTimeout(900);
      const set = await page.evaluate(() => window.__SET__);
      ok('cloud: uložení prahu → ghSet', set.length === 1 && set[0][0] === 'testkey' && JSON.parse(JSON.parse(set[0][1]).garmin_thresholds).hr_warn.val === 58, JSON.stringify(set).slice(0, 200));
      // zóna VST → ghSet
      await exerciseTabs(page, errs, 'cloud');
      await ctx.close();
    }
    // ── staré data / chyba ──
    {
      const { ctx, page, errs } = await cloud(browser, { reply: { ageH: 40, stale: true } });
      ok('cloud: stará data = upozornění', /stará 40 h/.test(await page.$eval('#serverError', e => getComputedStyle(e).display !== 'none' ? e.innerText : '')));
      ok('cloud: stará data se i tak vykreslí', (await page.$eval('#readinessBanner', e => e.innerText.trim().length)) > 0);
      ok('cloud stará: bez chyb', errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page } = await cloud(browser, { reply: { ok: false, data: null, error: 'Na Disku zatím není Garmin Data/garmin-data.json' } });
      ok('cloud: chybějící data = srozumitelná hláška', /Na Disku zatím není/.test(await page.$eval('#serverError', e => e.innerText)));
      await ctx.close();
    }
    // ── telefon ──
    {
      const { ctx, page, errs } = await cloud(browser, { vp: { width: 390, height: 844 } });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      await page.screenshot({ path: path.join(OUT, 'cloud-phone.png'), fullPage: true });
      ok('telefon: bez chyb', errs.length === 0, errs.join(' | '));
      console.log('INFO telefon: šířka stránky ' + sw + ' px (viewport 390)');
      await ctx.close();
    }
    // ── B) lokálně: file:// + garmin_server.py ──
    {
      const td = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-'));
      const db = path.join(td, 'garmin.db');
      cp.execFileSync('python3', ['-c', `import sys;sys.path.insert(0,${JSON.stringify(__dirname)});import test_local;test_local.make_db(${JSON.stringify(db)})`]);
      const exp = path.join(td, 'Garmin Data');
      const env = Object.assign({}, process.env, { GARMIN_DB: db, GARMIN_SETTINGS_DIR: exp, PYTHONUTF8: '1', BROWSER: 'true' });
      // server bez otevírání prohlížeče: spustíme Handler přímo
      const srv = cp.spawn('python3', ['-c', 'import garmin_server as g;from http.server import HTTPServer;HTTPServer(("localhost",8765),g.Handler).serve_forever()'], { cwd: path.join(ROOT, 'local'), env });
      await new Promise(r => setTimeout(r, 1200));
      try {
        const fileHtml = path.join(td, 'garmin-dashboard.html'); fs.writeFileSync(fileHtml, html);
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
        await routes(ctx);
        const page = await ctx.newPage(), errs = watch(page);
        // stará verze měla prahy jen v localStorage prohlížeče → první otevření je nahraje na Disk
        await page.goto('file://' + fileHtml, { waitUntil: 'load' });
        await page.evaluate(() => localStorage.setItem('garmin_vst_zones', JSON.stringify({ z1: 25, z2: 29, avgDays: 7 })));
        await page.reload({ waitUntil: 'load' });
        await page.waitForTimeout(1500);
        {
          const sf0 = path.join(exp, 'garmin-settings.json');
          const st0 = fs.existsSync(sf0) ? JSON.parse(fs.readFileSync(sf0, 'utf8')) : {};
          ok('lokálně: migrace zón z prohlížeče na Disk', st0.garmin_vst_zones && JSON.parse(st0.garmin_vst_zones).z1 === 25, JSON.stringify(st0).slice(0, 200));
        }
        ok('lokálně: banner readiness', (await page.$eval('#readinessBanner', e => e.innerText.trim().length)) > 0);
        ok('lokálně: Sync Garmin viditelný', await page.$eval('#syncBtn', e => getComputedStyle(e).display !== 'none'));
        await page.$eval('.thresh-editable[data-key="bb_ok"]', e => { e.textContent = '47'; e.dispatchEvent(new Event('blur')); });
        await page.waitForTimeout(900);
        const sf = path.join(exp, 'garmin-settings.json');
        const st = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : {};
        ok('lokálně: práh uložen na Disk (garmin-settings.json)', st.garmin_thresholds && JSON.parse(st.garmin_thresholds).bb_ok.val === 47, JSON.stringify(st).slice(0, 200));
        await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1000);
        ok('lokálně: práh po načtení z Disku', /47/.test(await page.$eval('.thresh-editable[data-key="bb_ok"]', e => e.innerText)));
        await exerciseTabs(page, errs, 'lokálně');
        await ctx.close();
      } finally { srv.kill(); }
    }
    // ── Apps Script: pojistky samoaktualizace a obalu ──
    {
      const gs = fs.readFileSync(path.join(ROOT, 'apps-script/garmin-apps-script.gs'), 'utf8');
      ok('gs: obsahuje function selfUpdate( a function doGet(', gs.includes('function selfUpdate(') && gs.includes('function doGet('));
      ok('gs: délka nad pojistkou 5000', gs.length > 5000);
      const w = gsCtx.wrapScripts_(html);
      ok('gs: obal nenechá ve skriptech „//“ ani „<“', !/<script>\(function\(\)\{[^]*?s\.text="[^"]*\/\//.test(w));
    }
  } finally { await browser.close(); }
  console.log(fails ? `\n${fails} FAIL` : '\nvše OK');
  process.exit(fails ? 1 : 0);
})();
