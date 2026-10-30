// ══════════ BĚH — běžecké aktivity z Garminu (Pavel 30.10.2026: „aktivity běhání zvlášť do nové záložky“; cíl projektu = osobní trenér běhu) ══════════
// Data: DAYS[].a z Apps Scriptu (actMini_: n název, k typ, t čas, km, s s, mv pohyb s, sp m/s, hr / hrx TF, cad kroky/min, str cm, el m, l zátěž, te / tea, vo2).
// Vše orientační — jen z toho, co Garmin vrátí; chybějící pole = „—“.
const isRun = a => /run/.test(String(a && a.k || ''));
function runsAll() { const out = []; DAYS.forEach(x => (x.a || []).forEach(a => { if (isRun(a)) out.push(Object.assign({ d: x.d }, a)); })); return out.sort((a, b) => (a.d + (a.t || '')) < (b.d + (b.t || '')) ? 1 : -1); }
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
let CHB = null, CHE = null;
function renderBeh() {
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
  $('p-beh').innerHTML = `
  <div class="page-head"><div><div class="page-t">Běh</div><div class="page-s">Běhy z hodinek Garmin — objem, tempo, tepovka a efektivita. Orientační.</div></div></div>
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
    ${runs.length > (UI.runN || 20) ? '<div style="margin-top:var(--sp-3)"><button class="btn" id="bmore">Další běhy</button></div>' : ''}</div>`
    : '<div class="card empty">Zatím žádné běhy. Po synchronizaci hodinek se tu objeví běhy z Garminu (aktivity typu běh, trail, pás).</div>'}`;
  if (!runs.length) return;
  $('blist').addEventListener('click', e => { const r = e.target.closest('.run'); if (r) r.classList.toggle('open'); });
  if ($('bmore')) $('bmore').onclick = () => { UI.runN = (UI.runN || 20) + 30; renderBeh(); };
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
