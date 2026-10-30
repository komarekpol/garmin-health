// ══════════ TRÉNINK (záložka beh) — aktivity z Garminu po sportech (Pavel 30.10.2026: „aktivity běhání zvlášť do nové záložky“, pak „stačí ty moje používané — kolo, trenažér…“) ══════════
// Sporty podle Pavlovy Garmin DB (4/2025–10/2026): běh / trail, otužování (typ other „Cold Plunge | 15.0°C“, „Cold Shower“), veslo (indoor_rowing),
// SkiErg (fitness_equipment / cross_country_indoor_skiing / hiit s „SkiErg“ v názvu), MTB / kolo, posilovna, dech. Jediná klasifikace = sportOf(a).
// Data: DAYS[].a z Apps Scriptu (actMini_: n název, k typ, t čas, km, s s, mv pohyb s, sp m/s, hr / hrx TF, cad kroky/min, str cm, el m, l zátěž, te / tea, vo2,
//   pw / pwx výkon W, bcad kadence kola, spm záběry / min, stk počet záběrů).
// Vše orientační — jen z toho, co Garmin vrátí; chybějící pole = „—“.
const SPORTS = [['run', 'Běh', '--blue'], ['bike', 'Kolo', '--teal'], ['erg', 'Trenažéry', '--purple'], ['otuz', 'Otužování', '--ice'], ['other', 'Ostatní', '--text3']];
function sportOf(a) {
  const k = String(a && a.k || ''), n = String(a && a.n || '');
  if (/cold|plunge|otu[žz]|ledov/i.test(n)) return 'otuz';
  if (/run/.test(k)) return 'run';
  if (/cycl|bik|ride/.test(k)) return 'bike';
  if (/rowing/.test(k) || /skierg/i.test(n) || k === 'cross_country_indoor_skiing') return 'erg';
  return 'other';
}
const ergKind = a => /rowing/.test(String(a.k || '')) || /\brow\b/i.test(a.n || '') ? 'Veslo' : 'SkiErg';
const waterC = a => { const m = String(a.n || '').match(/(-?\d+(?:[.,]\d+)?)\s*°\s*C/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
const isRun = a => sportOf(a) === 'run';
function actsAll(sp) { const out = []; DAYS.forEach(x => (x.a || []).forEach(a => { if (!sp || sportOf(a) === sp) out.push(Object.assign({ d: x.d }, a)); })); return out.sort((a, b) => (a.d + (a.t || '')) < (b.d + (b.t || '')) ? 1 : -1); }
const actMin = a => a.s != null ? a.s / 60 : (a.m || 0);
const runsAll = () => actsAll('run');
const paceS = r => r.sp > 0 ? 1000 / r.sp : (r.km > 0 && r.s > 0 ? r.s / r.km : null);   // s / km
const paceF = s => { if (s == null || !isFinite(s)) return '—'; const m = Math.floor(s / 60), x = Math.round(s - m * 60); return x === 60 ? (m + 1) + ':00' : m + ':' + String(x).padStart(2, '0'); };
const durF = s => { if (s == null) return '—'; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const effOf = r => r.sp > 0 && r.hr > 0 ? r.sp * 60 / r.hr : null;   // metry na jeden tep (rychlost / TF) — vyšší = efektivnější
const mondayOf = d => { const dt = new Date(d + 'T12:00:00'); return addD(d, -((dt.getDay() + 6) % 7)); };
const RUN_TYPE = { running: 'silnice', trail_running: 'trail', treadmill_running: 'pás', track_running: 'dráha', indoor_running: 'uvnitř', virtual_run: 'virtuální', street_running: 'silnice' };
// zátěž všech aktivit (Garmin activityTrainingLoad): posledních 7 dní vs Ø týden posledních 28 dní (poměr akutní / chronické zátěže)
function loadRatio() {
  const sum = (a, b) => { let s = 0; for (let i = a; i < b; i++) { const x = BYD[addD(TODAY(), -i)]; if (x) (x.a || []).forEach(z => { s += z.l || 0; }); } return s; };
  const l7 = sum(0, 7), l28 = sum(0, 28) / 4; return { l7: l7, l28: l28, r: l28 > 0 ? l7 / l28 : null };
}
// doporučení na dnešek (I-006): odhad připravenosti + zátěž; prahy zátěže podle pásma 0,8–1,3 (Gabbett 2016, Br J Sports Med) — orientační
function runAdvice() {
  const R = readinessOf(), sc = R.score, L = loadRatio(), rt = L.r == null ? '' : ` Zátěž posledních 7 dní je ${fmt(L.r, 1)}× tvého průměru.`;
  if (sc == null) return { k: 'ok', h: 'Bez dat', t: 'Chybí data z hodinek pro odhad připravenosti — synchronizuj hodinky.' };
  if (sc < T.ready_warn.val) return { k: 'crit', h: 'Volno', t: `Regenerace je nízko (odhad ${sc}). Dnes jen procházka nebo protažení.` + rt };
  if (L.r != null && L.r > 1.5) return { k: 'amber', h: 'Lehce nebo volno', t: `Zátěž rychle roste.${rt} Lehký běh v konverzačním tempu, nebo volno.` };
  if (sc < T.ready_ok.val) return { k: 'amber', h: 'Lehký běh', t: `Regenerace průměrná (odhad ${sc}). Lehký běh v nízké tepovce.` + rt };
  if (L.r != null && L.r < 0.8) return { k: 'good', h: 'Můžeš přitlačit', t: `Regenerace je dobrá (odhad ${sc}) a zátěž je pod průměrem.${rt} Vhodný den na kvalitnější trénink.` };
  return { k: 'good', h: 'Normální trénink', t: `Regenerace je dobrá (odhad ${sc}).${rt} Běž podle plánu.` };
}
let CHB = null, CHE = null, CHT = [];
function chartBase() {
  const grid = tok('--grid'), t3 = tok('--text3'), font = { family: tok('--sans') || 'Inter', size: 11 };
  return { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: tok('--bg4'), borderColor: tok('--border2'), borderWidth: 1, titleColor: tok('--text'), bodyColor: tok('--text2'), padding: 10, titleFont: font, bodyFont: font } },
    scales: { x: { ticks: { color: t3, font, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: t3, font }, grid: { color: grid } } } };
}
const kpiT = (l, v, u, sub) => `<div class="card kpi"><div class="kpi-top"><span class="lbl">${l}</span></div><div class="kpi-v">${v}<small>${u}</small></div><div class="kpi-s">${sub}</div></div>`;
const weeks = n => { const tw = mondayOf(TODAY()), ws = []; for (let i = n - 1; i >= 0; i--) ws.push(addD(tw, -7 * i)); return ws; };
// ── záložka Trénink: souhrn týdenní zátěže všech sportů + přepínač sportu ──
function renderBeh() {
  CHT.forEach(c => { try { c.destroy(); } catch (e) {} }); CHT = []; if (CHB) { CHB.destroy(); CHB = null; } if (CHE) { CHE.destroy(); CHE = null; }
  const sp = UI.sport || 'run', met = UI.tmet2 || 'min', all = actsAll(), cnt = {}; all.forEach(a => { const k = sportOf(a); cnt[k] = (cnt[k] || 0) + 1; });
  $('p-beh').innerHTML = `
  <div class="page-head"><div><div class="page-t">Trénink</div><div class="page-s">Aktivity z hodinek Garmin po sportech. Orientační.</div></div></div>
  <div class="card"><div class="card-h"><div class="card-t">Týdenní zátěž všech sportů</div><div class="seg" id="tmet2"><button data-v="min" class="${met === 'min' ? 'on' : ''}">Minuty</button><button data-v="load" class="${met === 'load' ? 'on' : ''}">Zátěž</button></div></div>
    <div class="chart-box chart-sm"><canvas id="tsum"></canvas></div>
    <div class="legend">${SPORTS.map(([k, l, c]) => `<span><i style="background:${tok(c)}"></i>${l}</span>`).join('')}</div></div>
  <div class="seg seg-scroll" id="tsport" style="margin:var(--sp-4) 0">${SPORTS.map(([k, l]) => `<button data-v="${k}" class="${k === sp ? 'on' : ''}">${l}<small class="muted"> ${cnt[k] || 0}</small></button>`).join('')}</div>
  <div id="tbody"></div>`;
  $('tsport').querySelectorAll('button').forEach(b => b.onclick = () => { UI.sport = b.dataset.v; UI.runN = 20; renderBeh(); });
  $('tmet2').querySelectorAll('button').forEach(b => b.onclick = () => { UI.tmet2 = b.dataset.v; renderBeh(); });
  drawSum(all, met);
  ({ run: runSection, bike: bikeSection, erg: ergSection, otuz: otuzSection, other: otherSection })[sp]();
}
function drawSum(all, met) {
  if (typeof Chart === 'undefined') return;
  const ws = weeks(12), v = {}; all.forEach(a => { const w = mondayOf(a.d), k = sportOf(a); (v[k] = v[k] || {})[w] = ((v[k] || {})[w] || 0) + (met === 'load' ? (a.l || 0) : actMin(a)); });
  const b = chartBase();
  CHT.push(new Chart($('tsum'), { type: 'bar', data: { labels: ws.map(dShort), datasets: SPORTS.map(([k, l, c]) => ({ label: l, data: ws.map(w => Math.round((v[k] || {})[w] || 0)), backgroundColor: tok(c), stack: 's', borderRadius: 2 })) },
    options: { ...b, plugins: { ...b.plugins, tooltip: { ...b.plugins.tooltip, mode: 'index', intersect: false } }, scales: { x: { ...b.scales.x, stacked: true }, y: { ...b.scales.y, stacked: true, title: { display: true, text: met === 'load' ? 'zátěž (Garmin)' : 'minuty', color: tok('--text3') } } } } }));
}
function listCard(title, arr, rowFn, more) {
  const n = UI.runN || 20;
  return `<div class="card"><div class="card-h"><div class="card-t">${title} <span class="muted">${arr.length}</span></div><span class="card-s">klepni pro detail</span></div>
    <div class="runs" id="blist">${arr.slice(0, n).map(rowFn).join('') || '<div class="muted sm">Zatím nic.</div>'}</div>
    ${arr.length > n ? '<div style="margin-top:var(--sp-3)"><button class="btn" id="bmore">Další</button></div>' : ''}</div>`;
}
function bindList() {
  if ($('blist')) $('blist').addEventListener('click', e => { const r = e.target.closest('.run'); if (r) r.classList.toggle('open'); });
  if ($('bmore')) $('bmore').onclick = () => { UI.runN = (UI.runN || 20) + 30; renderBeh(); };
}
function actRow(a, cols, det, sub) {
  return `<div class="run" tabindex="0"><div class="run-s"><div class="run-n"><b>${esc(a.n || '—')}</b><span class="xs muted">${esc(dShort(a.d))}${a.t ? ' · ' + esc(a.t) : ''}${sub ? ' · ' + esc(sub) : ''}</span></div>
    ${cols.map(([v, u]) => `<div class="run-v"><b>${v}</b><small>${u}</small></div>`).join('')}</div>
    <div class="run-d">${det.map(([l, v]) => `<div><span class="lbl">${l}</span><span>${v}</span></div>`).join('')}</div></div>`;
}
const wkSum = (arr, f) => { const w = {}; arr.forEach(a => { const m = mondayOf(a.d); w[m] = (w[m] || 0) + (f(a) || 0); }); return w; };
const in28 = arr => arr.filter(a => a.d > addD(TODAY(), -28));
const hrAvg = arr => { const h = arr.filter(a => a.hr && a.s); return h.length ? h.reduce((x, a) => x + a.hr * a.s, 0) / h.reduce((x, a) => x + a.s, 0) : null; };
function barWeeks(id, w, label, col, n) { if (typeof Chart === 'undefined' || !$(id)) return; const ws = weeks(n || 16);
  CHT.push(new Chart($(id), { type: 'bar', data: { labels: ws.map(dShort), datasets: [{ label: label, data: ws.map(x => Math.round((w[x] || 0) * 10) / 10), backgroundColor: tok(col), borderRadius: 3 }] }, options: chartBase() })); }
// ── Kolo ──
function bikeSection() {
  const A = actsAll('bike'), r = in28(A), tw = mondayOf(TODAY()), wk = wkSum(A, a => a.km), km28 = r.reduce((x, a) => x + (a.km || 0), 0), s28 = r.reduce((x, a) => x + (a.km > 0 && a.s ? a.s : 0), 0);
  const pw = r.filter(a => a.pw), lastPw = A.find(a => a.pw);
  $('tbody').innerHTML = A.length ? `<div class="grid g-kpi">
    ${kpiT('Tento týden', fmt(wk[tw] || 0, 1), 'km', `Ø 4 předchozí týdny ${fmt(avg([1, 2, 3, 4].map(i => wk[addD(tw, -7 * i)] || 0)), 1)} km`)}
    ${kpiT('Jízd za 28 dní', fmt(r.length), '', `${fmt(km28, 1)} km · ${fmt(r.reduce((x, a) => x + (a.el || 0), 0))} m převýšení`)}
    ${kpiT('Ø rychlost 28 dní', s28 > 0 ? fmt(km28 / (s28 / 3600), 1) : '—', 'km/h', 'vzdálenost ÷ čas')}
    ${kpiT('Ø TF 28 dní', fmt(hrAvg(r)), 'bpm', 'vážené časem')}
    ${kpiT('Ø výkon 28 dní', pw.length ? fmt(avg(pw.map(a => a.pw))) : '—', 'W', pw.length ? 'z jízd s měřičem výkonu' : (lastPw ? 'poslední ' + lastPw.pw + ' W' : 'bez měřiče výkonu'))}
    ${kpiT('Ø kadence 28 dní', r.some(a => a.bcad) ? fmt(avg(r.filter(a => a.bcad).map(a => a.bcad))) : '—', 'ot/min', 'když ji hodinky měří')}
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Kilometry po týdnech</div><span class="card-s">16 týdnů</span></div><div class="chart-box chart-sm"><canvas id="bkkm"></canvas></div></div>
  ${listCard('Jízdy', A, a => actRow(a, [[a.km != null ? fmt(a.km, 1) : '—', 'km'], [durF(a.s), 'čas'], [a.km > 0 && a.s ? fmt(a.km / (a.s / 3600), 1) : '—', 'km/h'], [a.hr || '—', 'TF']],
    [['Převýšení', a.el != null ? a.el + ' m' : '—'], ['Výkon Ø / max', (a.pw ? a.pw + ' W' : '—') + ' / ' + (a.pwx ? a.pwx + ' W' : '—')], ['Kadence', a.bcad ? a.bcad + ' ot/min' : '—'], ['Max TF', a.hrx ? a.hrx + ' bpm' : '—'], ['Zátěž', a.l != null ? fmt(a.l) : '—'], ['TE aerobní', a.te != null ? fmt(a.te, 1) : '—']],
    a.k === 'mountain_biking' ? 'MTB' : 'kolo'))}` : '<div class="card empty">Zatím žádné jízdy na kole z Garminu.</div>';
  barWeeks('bkkm', wk, 'km', '--teal'); bindList();
}
// ── Trenažéry (veslo, SkiErg) ──
const p500 = a => a.sp > 0 ? 500 / a.sp : (a.km > 0 && a.s ? a.s / (a.km * 2) : null);   // s / 500 m
function ergSection() {
  const A = actsAll('erg'), r = in28(A), tw = mondayOf(TODAY()), wk = wkSum(A, actMin);
  const kind = k => r.filter(a => ergKind(a) === k), pAvg = k => { const x = kind(k).map(p500).filter(v => v != null); return x.length ? avg(x) : null; };
  $('tbody').innerHTML = A.length ? `<div class="grid g-kpi">
    ${kpiT('Tento týden', fmt(wk[tw] || 0), 'min', `Ø 4 předchozí týdny ${fmt(avg([1, 2, 3, 4].map(i => wk[addD(tw, -7 * i)] || 0)))} min`)}
    ${kpiT('Tréninků za 28 dní', fmt(r.length), '', `veslo ${kind('Veslo').length} · SkiErg ${kind('SkiErg').length}`)}
    ${kpiT('Veslo Ø tempo 28 dní', paceF(pAvg('Veslo')), '/500 m', 'z průměrné rychlosti')}
    ${kpiT('SkiErg Ø tempo 28 dní', paceF(pAvg('SkiErg')), '/500 m', 'z průměrné rychlosti')}
    ${kpiT('Ø TF 28 dní', fmt(hrAvg(r)), 'bpm', 'vážené časem')}
    ${kpiT('Zátěž 28 dní', fmt(r.reduce((x, a) => x + (a.l || 0), 0)), '', 'součet zátěže z Garminu')}
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Minuty po týdnech</div><span class="card-s">16 týdnů</span></div><div class="chart-box chart-sm"><canvas id="ergm"></canvas></div></div>
  ${listCard('Trenažéry', A, a => actRow(a, [[a.km != null ? fmt(a.km, 2) : '—', 'km'], [durF(a.s), 'čas'], [paceF(p500(a)), '/500 m'], [a.hr || '—', 'TF']],
    [['Záběry / min', a.spm ? fmt(a.spm, 1) : '—'], ['Záběrů', a.stk ? fmt(a.stk) : '—'], ['Max TF', a.hrx ? a.hrx + ' bpm' : '—'], ['Zátěž', a.l != null ? fmt(a.l) : '—'], ['TE aerobní', a.te != null ? fmt(a.te, 1) : '—'], ['Typ v Garminu', esc(a.k || '—')]],
    ergKind(a)))}` : '<div class="card empty">Zatím žádné trenažéry (veslo, SkiErg) z Garminu.</div>';
  barWeeks('ergm', wk, 'min', '--purple'); bindList();
}
// ── Otužování ──
function otuzSection() {
  const A = actsAll('otuz'), tw = mondayOf(TODAY()), m0 = TODAY().slice(0, 7) + '-01', wkN = wkSum(A, () => 1);
  const mon = A.filter(a => a.d >= m0), r = in28(A), tc = A.map(waterC).filter(v => v != null), last = A.find(a => waterC(a) != null);
  $('tbody').innerHTML = A.length ? `<div class="grid g-kpi">
    ${kpiT('Tento týden', fmt(wkN[tw] || 0), '×', `Ø 4 předchozí týdny ${fmt(avg([1, 2, 3, 4].map(i => wkN[addD(tw, -7 * i)] || 0)), 1)}×`)}
    ${kpiT('Tento měsíc', fmt(mon.length), '×', `${fmt(mon.reduce((x, a) => x + actMin(a), 0), 1)} min celkem`)}
    ${kpiT('Ø délka 28 dní', r.length ? fmt(avg(r.map(actMin)), 1) : '—', 'min', `${r.length}× za 28 dní`)}
    ${kpiT('Voda naposledy', last ? fmt(waterC(last), 1) : '—', '°C', last ? dShort(last.d) + (tc.length ? ' · min ' + fmt(Math.min(...tc), 1) + ' °C' : '') : 'teplota z názvu aktivity')}
    ${kpiT('Ø TF 28 dní', fmt(hrAvg(r)), 'bpm', 'během otužování')}
    ${kpiT('Celkem', fmt(A.length), '×', `od ${esc(dShort(A[A.length - 1].d))}`)}
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Teplota vody a délka</div><span class="card-s">teplota z názvu aktivity v Garminu</span></div><div class="chart-box chart-sm"><canvas id="otzc"></canvas></div>
    <div class="legend"><span><i style="background:${tok('--blue')}"></i>Teplota vody (°C)</span><span><i style="background:${tok('--ice')}"></i>Délka (min)</span></div>
    <div class="xs muted">Vliv otužování na HRV a spánek najdeš ve Vlivech (faktor „Otužování“).</div></div>
  ${listCard('Otužování', A, a => actRow(a, [[waterC(a) != null ? fmt(waterC(a), 1) : '—', '°C'], [durF(a.s != null ? a.s : (a.m || 0) * 60), 'čas'], [a.hr || '—', 'TF']],
    [['Max TF', a.hrx ? a.hrx + ' bpm' : '—'], ['Zátěž', a.l != null ? fmt(a.l, 1) : '—']], /shower/i.test(a.n || '') ? 'sprcha' : 'ponor'))}` : '<div class="card empty">Zatím žádné otužování z Garminu.</div>';
  if (A.length && typeof Chart !== 'undefined') {
    const e = A.slice(0, 120).reverse(), b = chartBase();
    CHT.push(new Chart($('otzc'), { data: { labels: e.map(a => dShort(a.d)), datasets: [
      { type: 'bar', label: 'Délka (min)', data: e.map(a => Math.round(actMin(a) * 10) / 10), backgroundColor: tok('--ice'), yAxisID: 'y2', borderRadius: 2, barPercentage: .5 },
      { type: 'line', label: 'Teplota vody (°C)', data: e.map(waterC), borderColor: tok('--blue'), backgroundColor: tok('--blue'), pointRadius: 2, borderWidth: 2, spanGaps: true, tension: 0, yAxisID: 'y', order: 0 }] },
      options: { ...b, scales: { x: b.scales.x, y: { ...b.scales.y, beginAtZero: false, title: { display: true, text: '°C', color: tok('--text3') } }, y2: { position: 'right', beginAtZero: true, ticks: { color: tok('--text3') }, grid: { display: false } } } } }));
  }
  bindList();
}
// ── Ostatní (posilovna, dech, …) ──
const OTH_T = { strength_training: 'posilovna', breathwork: 'dech', hiit: 'HIIT', fitness_equipment: 'stroj', yoga: 'jóga', walking: 'chůze', hiking: 'turistika' };
function otherSection() {
  const A = actsAll('other');
  $('tbody').innerHTML = A.length ? listCard('Ostatní aktivity', A, a => actRow(a, [[durF(a.s != null ? a.s : (a.m || 0) * 60), 'čas'], [a.hr || '—', 'TF'], [a.l != null ? fmt(a.l) : '—', 'zátěž']],
    [['Max TF', a.hrx ? a.hrx + ' bpm' : '—'], ['TE aerobní', a.te != null ? fmt(a.te, 1) : '—'], ['Typ v Garminu', esc(a.k || '—')]], OTH_T[a.k] || a.k || '')) : '<div class="card empty">Zatím žádné další aktivity.</div>';
  bindList();
}
// ── Běh ──
function runSection() {
  const runs = runsAll(), tw = mondayOf(TODAY());
  const wk = {}; runs.forEach(r => { const m = mondayOf(r.d), w = wk[m] = wk[m] || { km: 0, n: 0, s: 0 }; w.km += r.km || 0; w.n++; w.s += r.s || 0; });
  const prev4 = [1, 2, 3, 4].map(i => (wk[addD(tw, -7 * i)] || { km: 0 }).km), avg4 = avg(prev4), cur = wk[tw] || { km: 0, n: 0 };
  const r28 = runs.filter(r => r.d > addD(TODAY(), -28)), kmS = r28.reduce((a, r) => a + (r.km || 0), 0), sS = r28.reduce((a, r) => a + (r.km > 0 && r.s ? r.s : 0), 0);
  const hrW = r28.filter(r => r.hr && r.s), hrA = hrW.length ? hrW.reduce((a, r) => a + r.hr * r.s, 0) / hrW.reduce((a, r) => a + r.s, 0) : null;
  const A = runAdvice(), acol = A.k === 'crit' ? '--crit' : A.k === 'amber' ? '--amber' : '--green';
  const tile = (l, v, u, sub) => `<div class="card kpi"><div class="kpi-top"><span class="lbl">${l}</span></div><div class="kpi-v">${v}<small>${u}</small></div><div class="kpi-s">${sub}</div></div>`;
  const eff = runs.filter(r => effOf(r) != null && !(r.el > 20 * (r.km || 0)));   // bez kopcovitých běhů (> 20 m převýšení / km zkresluje)
  const effNow = eff.filter(r => r.d > addD(TODAY(), -28)).map(effOf), effPrev = eff.filter(r => r.d <= addD(TODAY(), -28) && r.d > addD(TODAY(), -56)).map(effOf);
  const effCh = effNow.length >= 3 && effPrev.length >= 3 ? (avg(effNow) / avg(effPrev) - 1) * 100 : null;
  const list = runs.slice(0, UI.runN || 20).map((r, i) => runRow(r, i)).join('');
  $('tbody').innerHTML = `
  <div class="card adv adv-${A.k}" style="border-left-color:${tok(acol)}"><div class="lbl">Dnes</div><div class="adv-h" style="color:${tok(acol)}">${esc(A.h)}</div><div class="t2">${esc(A.t)}</div>
    <div class="xs muted" style="margin-top:var(--sp-2)">Z odhadu připravenosti (HRV, spánek, Body Battery, klidová TF) a zátěže z Garminu; pásmo zátěže 0,8–1,3× průměru podle Gabbett 2016.</div></div>
  ${runs.length ? `<div class="grid g-kpi">
    ${tile('Tento týden', fmt(cur.km, 1), 'km', `Ø 4 předchozí týdny ${fmt(avg4, 1)} km · ${cur.n || 0} ${cur.n === 1 ? 'běh' : cur.n >= 2 && cur.n <= 4 ? 'běhy' : 'běhů'}`)}
    ${tile('Běhů za 28 dní', fmt(r28.length), '', `${fmt(kmS, 1)} km celkem`)}
    ${tile('Ø tempo 28 dní', paceF(kmS > 0 ? sS / kmS : null), '/km', 'čas ÷ vzdálenost')}
    ${tile('Ø TF 28 dní', fmt(hrA), 'bpm', 'vážené časem běhu')}
    ${tile('Efektivita', effNow.length ? fmt(avg(effNow), 2) : '—', 'm / tep', effCh == null ? 'málo běhů pro srovnání' : `${sgn(effCh, 1)} % proti předchozím 4 týdnům`)}
    ${tile('VO2max', fmt((runs.find(r => r.vo2 != null) || {}).vo2, 0), '', 'poslední hodnota z běhu')}
  </div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Kilometry po týdnech</div><span class="card-s">16 týdnů</span></div><div class="chart-box chart-sm"><canvas id="bkm"></canvas></div></div>
    <div class="card"><div class="card-h"><div class="card-t">Efektivita (rychlost ÷ TF)</div><span class="card-s">vyšší = rychleji při stejné tepovce</span></div><div class="chart-box chart-sm"><canvas id="beff"></canvas></div>
      <div class="xs muted">Bez kopcovitých běhů (převýšení nad 20 m / km). Roste-li, zlepšuje se aerobní kondice.</div></div>
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Běhy <span class="muted">${runs.length}</span></div><span class="card-s">klepni pro detail</span></div>
    <div class="runs" id="blist">${list}</div>
    ${runs.length > (UI.runN || 20) ? '<div style="margin-top:var(--sp-3)"><button class="btn" id="bmore">Další</button></div>' : ''}</div>`
    : '<div class="card empty">Zatím žádné běhy. Po synchronizaci hodinek se tu objeví běhy z Garminu (aktivity typu běh, trail, pás).</div>'}`;
  if (!runs.length) return;
  bindList();
  drawBeh(wk, tw, eff);
}
function runRow(r, i) {
  const det = [['Čas v pohybu', r.mv ? durF(r.mv) : '—'], ['Max TF', r.hrx ? r.hrx + ' bpm' : '—'], ['Kadence', r.cad ? r.cad + ' kroků/min' : '—'], ['Délka kroku', r.str ? fmt(r.str / 100, 2) + ' m' : '—'],
    ['Převýšení', r.el != null ? r.el + ' m' : '—'], ['Zátěž', r.l != null ? fmt(r.l) : '—'], ['TE aerobní / anaerobní', (r.te != null ? fmt(r.te, 1) : '—') + ' / ' + (r.tea != null ? fmt(r.tea, 1) : '—')],
    ['Efektivita', effOf(r) != null ? fmt(effOf(r), 2) + ' m / tep' : '—'], ['VO2max', r.vo2 != null ? fmt(r.vo2) : '—']];
  return `<div class="run" tabindex="0"><div class="run-s"><div class="run-n"><b>${esc(r.n || 'Běh')}</b><span class="xs muted">${esc(dShort(r.d))}${r.t ? ' · ' + esc(r.t) : ''} · ${esc(RUN_TYPE[r.k] || r.k || '')}</span></div>
    <div class="run-v"><b>${r.km != null ? fmt(r.km, 2) : '—'}</b><small>km</small></div><div class="run-v"><b>${durF(r.s)}</b><small>čas</small></div>
    <div class="run-v"><b>${paceF(paceS(r))}</b><small>/km</small></div><div class="run-v"><b>${r.hr || '—'}</b><small>TF</small></div></div>
    <div class="run-d">${det.map(([l, v]) => `<div><span class="lbl">${l}</span><span>${v}</span></div>`).join('')}</div></div>`;
}
function drawBeh(wk, tw, eff) {
  if (CHB) { CHB.destroy(); CHB = null; } if (CHE) { CHE.destroy(); CHE = null; }
  if (typeof Chart === 'undefined') return;
  const grid = tok('--grid'), t3 = tok('--text3'), font = { family: tok('--sans') || 'Inter', size: 11 };
  const base = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: tok('--bg4'), borderColor: tok('--border2'), borderWidth: 1, titleColor: tok('--text'), bodyColor: tok('--text2'), padding: 10, titleFont: font, bodyFont: font } },
    scales: { x: { ticks: { color: t3, font, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: t3, font }, grid: { color: grid } } } };
  const ws = []; for (let i = 15; i >= 0; i--) ws.push(addD(tw, -7 * i));
  CHB = new Chart($('bkm'), { type: 'bar', data: { labels: ws.map(dShort), datasets: [{ label: 'km', data: ws.map(w => wk[w] ? Math.round(wk[w].km * 10) / 10 : 0), backgroundColor: tok('--blue'), borderRadius: 3 }] }, options: base });
  const e = eff.filter(r => r.d > addD(TODAY(), -120)).slice().reverse(), v = e.map(effOf);
  const roll = v.map((_, i) => { const a = v.slice(Math.max(0, i - 4), i + 1); return Math.round(avg(a) * 100) / 100; });
  CHE = new Chart($('beff'), { type: 'line', data: { labels: e.map(r => dShort(r.d)), datasets: [
    { label: 'běh', data: v.map(x => Math.round(x * 100) / 100), borderColor: 'transparent', backgroundColor: tok('--blue'), pointRadius: 3, showLine: false },
    { label: 'Ø 5 běhů', data: roll, borderColor: tok('--text2'), pointRadius: 0, borderWidth: 1.6, tension: .3 }] },
    options: { ...base, scales: { ...base.scales, y: { ...base.scales.y, beginAtZero: false } } } });
}
