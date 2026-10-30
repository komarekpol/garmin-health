// ══════════ JÍDLO — databáze jídel, kalorie a makroživiny, váha (Pavel 30.10.2026) ══════════
// Databáze JR.food { id: { l, por g, porL, k kcal / 100 g, p bílkoviny, f tuky, c sacharidy (g / 100 g), src, at } } — hodnoty dohledává Claude
// (kaloricketabulky.cz / USDA, zdroj v src), Pavel je opravuje. Jídlo dne: day.m[].it [{ f: id, g: gramy }], váha day.kg, cíle JR.cfg.goal { k, p, f, c }.
const NUT = [['k', 'Kalorie', 'kcal', 0], ['p', 'Bílkoviny', 'g', 0], ['f', 'Tuky', 'g', 0], ['c', 'Sacharidy', 'g', 0]];
const MEAL_BY_H = h => h < 10 ? 'sn' : h < 15 ? 'ob' : h < 18 ? 'sv' : 've';
const nowHM = () => { const n = new Date(); return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); };
const foodOf = id => (JR.food || {})[id] || null;
const itemNut = it => { const f = foodOf(it.f); if (!f) return null; const q = (+it.g || 0) / 100; return { k: (f.k || 0) * q, p: (f.p || 0) * q, f: (f.f || 0) * q, c: (f.c || 0) * q }; };
// součty dne z položek databáze (null = ten den žádné položky — Vlivy ho pak nepočítají)
function nutDay(d) {
  const j = JR.days[d]; if (!j || !(j.m || []).some(m => (m.it || []).length)) return null;
  const s = { k: 0, p: 0, f: 0, c: 0, n: 0, late: 0, eveC: 0, unk: 0 };
  (j.m || []).forEach(m => (m.it || []).forEach(it => { const v = itemNut(it); if (!v) { s.unk++; return; } s.n++;
    ['k', 'p', 'f', 'c'].forEach(k => { s[k] += v[k]; });
    if ((m.h || '') >= '20:00') s.late += v.k;
    if (m.s === 've' || (m.h || '') >= '18:00') s.eveC += v.c; }));
  return s;
}
const goals = () => (JR.cfg && JR.cfg.goal) || {};
function foodUse(days) {
  const u = {}, from = addD(TODAY(), -(days || 120));
  Object.keys(JR.days).forEach(d => { if (d < from) return; (JR.days[d].m || []).forEach(m => (m.it || []).forEach(it => { u[it.f] = (u[it.f] || 0) + 1; })); });
  return u;
}
const bfOf = d => { const j = JR.days[d]; return j && j.bf != null ? +j.bf : null; };
const kgOf = d => { const j = JR.days[d]; return j && j.kg != null ? +j.kg : null; };
function kgSeries(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = addD(TODAY(), -i); out.push(kgOf(d)); } return out; }
function lastKg() { const ks = Object.keys(JR.days).filter(d => JR.days[d].kg != null).sort(); return ks.length ? { d: ks[ks.length - 1], kg: +JR.days[ks[ks.length - 1]].kg } : null; }
const kc = v => v == null ? '—' : fmt(Math.round(v));
const g1 = v => v == null ? '—' : fmt(Math.round(v));

async function foodSave(id, obj) {
  try {
    const r = CLOUD ? await gsRun('ghFoodSet', CLOUD.key, id, obj == null ? null : JSON.stringify(obj))
      : await (await fetch(`${API}/food`, { method: 'POST', body: JSON.stringify({ id: id, food: obj }), headers: { 'Content-Type': 'text/plain' } })).json();
    if (!r.ok) throw new Error(r.error || 'neznámá chyba');
    JR.food = JR.food || {}; if (obj == null) delete JR.food[id]; else JR.food[id] = r.food || Object.assign({}, obj);
    toast(obj == null ? 'Jídlo smazáno' : 'Jídlo uloženo'); return true;
  } catch (e) { toast('Neuloženo: ' + (e.message || e)); return false; }
}
const foodIdOf = l => String(l || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// ── souhrn pro Dnes a Deník (jeden řádek) ──
function nutLine(d) {
  const N = nutDay(d), G = goals(); if (!N) return '';
  return `<b>${kc(N.k)}</b>${G.k ? ' / ' + kc(G.k) : ''} kcal · B ${g1(N.p)} g · T ${g1(N.f)} g · S ${g1(N.c)} g`;
}

// ── záložka Jídlo ──
function renderJidlo() {
  const d = UI.jday || TODAY(), j = jEdit(d), N = nutDay(d), G = goals(), x = BYD[d] || {}, use = foodUse(120);
  const tgt = UI.fmeal || MEAL_BY_H(new Date().getHours());
  const top = Object.keys(JR.food || {}).sort((a, b) => (use[b] || 0) - (use[a] || 0) || (JR.food[a].l > JR.food[b].l ? 1 : -1)).slice(0, 12);
  const tiles = NUT.map(([k, l, u]) => { const v = N ? N[k] : null, gl = G[k] || null, pct = v != null && gl ? Math.min(100, v / gl * 100) : null;
    const over = k === 'k' && gl && v > gl * 1.1, low = k === 'p' && gl && v != null && d < TODAY() && v < gl * 0.8;
    return `<div class="card nt"><div class="kpi-top"><span class="lbl">${l}</span>${over ? pill('nad cílem', 'amber') : low ? pill('málo', 'amber') : ''}</div>
      <div class="kpi-v">${v == null ? '—' : fmt(Math.round(v))}<small>${u}</small></div><div class="kpi-s">${gl ? 'cíl ' + fmt(gl) + ' ' + u : 'cíl nenastaven'}</div>
      <div class="nbar"><i style="width:${pct == null ? 0 : pct}%"></i></div></div>`; }).join('');
  const burn = num(x.kc), bal = N && burn != null ? N.k - burn : null;
  const en = N ? [['B', N.p * 4, '--blue'], ['T', N.f * 9, '--purple'], ['S', N.c * 4, '--teal']] : [], enT = en.reduce((a, e) => a + e[1], 0) || 1;
  const meals = j.m.map((m, i) => mealBlock(m, i)).join('') || '<div class="muted sm">Zatím nic. Klepni na jídlo nahoře nebo „+ Jídlo“.</div>';
  const lk = lastKg(), ks = kgSeries(90), k7 = (() => { const v = kgSeries(7).filter(v => v != null); return v.length ? avg(v) : null; })();
  const k30 = (() => { const a = kgSeries(37).slice(0, 7).filter(v => v != null); return a.length && k7 != null ? k7 - avg(a) : null; })();
  $('p-jidlo').innerHTML = `
  <div class="page-head"><div><div class="page-t">Jídlo</div><div class="page-s">Kalorie a makroživiny z tvé databáze jídel. Nadiktuj Claudovi v chatu, co jsi jedl — doplní to sem.</div></div>
    <div class="daynav"><button class="btn" id="fprev" aria-label="Předchozí den">‹</button><div class="daynav-t">${esc(cap(dLong(d)))}</div>
    <button class="btn" id="fnext" aria-label="Další den" ${d >= TODAY() ? 'disabled' : ''}>›</button>${d !== TODAY() ? '<button class="btn btn-ghost" id="ftoday">Dnes</button>' : ''}</div></div>
  <div class="grid g-nut">${tiles}</div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Bilance s Garminem</div><span class="save-st" id="jst"></span></div>
      ${burn == null ? '<div class="muted sm">Spálené kalorie z hodinek pro tento den zatím nejsou (doplní se po syncu).</div>' : `<div class="bal">
        <div><span class="lbl">Snědeno</span><b>${N ? kc(N.k) : '—'}</b></div><div><span class="lbl">Spáleno (Garmin)</span><b>${kc(burn)}</b><small class="xs muted">aktivní ${kc(num(x.ka))}</small></div>
        <div><span class="lbl">${bal == null ? 'Rozdíl' : bal < 0 ? 'Deficit' : 'Přebytek'}</span><b>${bal == null ? '—' : fmt(Math.abs(Math.round(bal)))}</b></div></div>`}
      ${N ? `<div class="lbl" style="margin-top:var(--sp-3)">Energie z makroživin</div><div class="ebar">${en.map(e => `<i style="width:${(e[1] / enT * 100).toFixed(1)}%;background:${tok(e[2])}" title="${e[0]}"></i>`).join('')}</div>
        <div class="legend">${en.map(e => `<span><i style="background:${tok(e[2])}"></i>${e[0] === 'B' ? 'Bílkoviny' : e[0] === 'T' ? 'Tuky' : 'Sacharidy'} ${fmt(Math.round(e[1] / enT * 100))} %</span>`).join('')}</div>` : ''}
      ${N && N.unk ? `<div class="xs" style="color:var(--amber);margin-top:var(--sp-2)">${N.unk} položek odkazuje na jídlo, které v databázi už není.</div>` : ''}</div>
    <div class="card"><div class="card-h"><div class="card-t">Váha</div><span class="card-s">${lk ? 'poslední ' + esc(dShort(lk.d)) : 'zatím žádná'}</span></div>
      <div class="kgrow"><label class="lbl" for="fkg">Váha ${esc(dShort(d))}</label><input type="number" id="fkg" step="0.1" min="30" max="250" inputmode="decimal" value="${j.kg != null ? j.kg : ''}" placeholder="kg"></div>
      <div class="sm t2" style="margin-top:var(--sp-2)">Ø 7 dní ${k7 == null ? '—' : fmt(k7, 1) + ' kg'}${k30 != null ? ' · za měsíc ' + sgn(k30, 1) + ' kg' : ''}${(() => { const b = Object.keys(JR.days).filter(x => JR.days[x].bf != null).sort().pop(); return b ? ' · tuk ' + fmt(JR.days[b].bf, 1) + ' % (' + esc(dShort(b)) + ')' : ''; })()}</div>${spark(ks, tok('--blue'))}</div>
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Jídla dne</div><button class="btn" id="faddm">+ Jídlo</button></div>
    <div class="lbl">Přidat do</div><div class="seg" id="ftgt">${MEAL_S.map(([k, l]) => `<button data-v="${k}" class="${k === tgt ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="chips" id="fquick" style="margin-top:var(--sp-3)">${top.length ? top.map(id => `<button type="button" class="chip" data-qf="${esc(id)}">${esc(JR.food[id].l)}<small class="muted">${esc(JR.food[id].porL || fmt(JR.food[id].por) + ' g')}</small></button>`).join('') : '<span class="muted sm">Databáze je prázdná — přidej jídla dole nebo je nadiktuj Claudovi.</span>'}</div>
    <div class="row-add" style="margin-top:var(--sp-3)"><input id="fsearch" list="fdl" placeholder="Hledat v databázi…" autocomplete="off"><button class="btn" id="fadd">Přidat</button></div>
    <datalist id="fdl">${Object.keys(JR.food || {}).map(id => `<option value="${esc(JR.food[id].l)}">`).join('')}</datalist>
    <div class="fmeals" id="fmeals">${meals}</div></div>
  ${foodDbHtml(use)}
  <div class="card"><div class="card-h"><div class="card-t">Denní cíle</div><span class="card-s">prázdné = bez cíle</span></div>
    <div class="goals">${NUT.map(([k, l, u]) => `<label><span class="lbl">${l}</span><input type="number" min="0" step="1" data-goal="${k}" value="${G[k] || ''}" placeholder="${u}"></label>`).join('')}</div>
    <div class="xs muted" style="margin-top:var(--sp-2)">Orientační — cíle nastavuješ ty${lk ? `; při ${fmt(lk.kg, 1)} kg je 1,6 g bílkovin / kg ≈ ${fmt(Math.round(lk.kg * 1.6))} g` : ''}.</div></div>`;
  bindJidlo(d);
}
function mealBlock(m, i) {
  const items = (m.it || []).map((it, k) => { const f = foodOf(it.f), v = itemNut(it);
    return `<div class="fit" data-k="${k}"><span class="fit-n">${f ? esc(f.l) : '<i class="muted">neznámé jídlo</i>'}</span>
      <input type="number" min="1" max="3000" step="1" inputmode="numeric" value="${it.g}" aria-label="Gramy"><span class="xs muted">g</span>
      <span class="fit-k">${v ? kc(v.k) + ' kcal' : '—'}</span><button class="btn btn-ghost" data-rmi="${k}" aria-label="Odebrat položku">✕</button></div>`; }).join('');
  const mk = (m.it || []).reduce((a, it) => { const v = itemNut(it); return a + (v ? v.k : 0); }, 0);
  return `<div class="fmeal" data-i="${i}"><div class="fmeal-h"><select aria-label="Jídlo">${MEAL_S.map(([k, l]) => `<option value="${k}"${m.s === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <input type="time" value="${esc(m.h || '')}" aria-label="Čas"><input class="fmeal-w" type="text" value="${esc(m.w || '')}" placeholder="poznámka (volitelně)" aria-label="Poznámka k jídlu">
    <span class="fit-k">${mk ? kc(mk) + ' kcal' : ''}</span><button class="btn btn-ghost" data-rmm="${i}" aria-label="Odebrat jídlo">✕</button></div>${items}</div>`;
}
function foodDbHtml(use) {
  const q = (UI.fq || '').toLowerCase(), ids = Object.keys(JR.food || {}).filter(id => !q || JR.food[id].l.toLowerCase().includes(q))
    .sort((a, b) => (use[b] || 0) - (use[a] || 0) || (JR.food[a].l > JR.food[b].l ? 1 : -1));
  const ed = UI.fed;
  const form = ed ? foodForm(ed === '+' ? { l: UI.fnew || '', por: 100 } : JR.food[ed] || {}, ed) : '';
  return `<div class="card" id="fdb"><div class="card-h"><div class="card-t">Databáze jídel <span class="muted">${Object.keys(JR.food || {}).length}</span></div><button class="btn" id="fnew">+ Nové jídlo</button></div>
    ${form}<div class="row-add"><input id="fq" placeholder="Filtrovat…" value="${esc(UI.fq || '')}" autocomplete="off"></div>
    ${ids.length ? `<div class="tbl-wrap"><table data-nogrid><thead><tr><th>Jídlo</th><th>Porce</th><th>kcal / 100 g</th><th>B</th><th>T</th><th>S</th><th>Použito</th><th></th></tr></thead><tbody>
    ${ids.map(id => { const f = JR.food[id]; return `<tr><td>${esc(f.l)}${f.src ? `<div class="xs muted">${/^https?:/.test(f.src) ? `<a class="lnk" href="${esc(f.src)}" target="_blank" rel="noopener">zdroj</a>` : esc(f.src)}</div>` : ''}</td>
      <td>${esc(f.porL ? f.porL + ' · ' : '')}${fmt(f.por)} g</td><td>${fmt(f.k)}</td><td>${fmt(f.p, 1)}</td><td>${fmt(f.f, 1)}</td><td>${fmt(f.c, 1)}</td><td>${use[id] || 0}×</td>
      <td><button class="btn btn-ghost" data-fed="${esc(id)}">Upravit</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="muted sm">Nic nenalezeno.</div>'}</div>`;
}
function foodForm(f, id) {
  const fld = (k, l, step) => `<label><span class="lbl">${l}</span><input type="${k === 'l' || k === 'porL' || k === 'src' ? 'text' : 'number'}" ${step ? `step="${step}" min="0"` : ''} data-ff="${k}" value="${esc(f[k] != null ? f[k] : '')}"></label>`;
  return `<div class="fform"><div class="fform-g">${fld('l', 'Název')}${fld('porL', 'Porce (popis)')}${fld('por', 'Porce (g)', '1')}${fld('k', 'kcal / 100 g', '1')}
    ${fld('p', 'Bílkoviny / 100 g', '0.1')}${fld('f', 'Tuky / 100 g', '0.1')}${fld('c', 'Sacharidy / 100 g', '0.1')}${fld('src', 'Zdroj (odkaz / etiketa)')}</div>
    <div class="fform-a"><button class="btn btn-primary" id="fsave">Uložit</button><button class="btn btn-ghost" id="fcancel">Zrušit</button>${id !== '+' ? '<button class="btn btn-ghost" id="fdel" style="margin-left:auto">Smazat</button>' : ''}</div></div>`;
}
function bindJidlo(d) {
  const P = $('p-jidlo');
  $('fprev').onclick = () => { UI.jday = addD(d, -1); renderJidlo(); };
  $('fnext').onclick = () => { if (d < TODAY()) { UI.jday = addD(d, 1); renderJidlo(); } };
  if ($('ftoday')) $('ftoday').onclick = () => { UI.jday = null; renderJidlo(); };
  $('ftgt').querySelectorAll('button').forEach(b => b.onclick = () => { UI.fmeal = b.dataset.v; $('ftgt').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  const addFood = id => { const f = foodOf(id); if (!f) return; const jj = jEdit(d), s = UI.fmeal || MEAL_BY_H(new Date().getHours());
    let m = jj.m.filter(x => x.s === s).pop();
    if (!m) { m = { s: s, h: d === TODAY() ? nowHM() : '', w: '' }; jj.m.push(m); }
    (m.it = m.it || []).push({ f: id, g: Math.round(f.por || 100) }); jPut(d, jj); renderJidlo(); };
  P.querySelectorAll('[data-qf]').forEach(b => b.onclick = () => addFood(b.dataset.qf));
  const search = () => { const v = $('fsearch').value.trim(); if (!v) return; const id = Object.keys(JR.food || {}).find(k => JR.food[k].l.toLowerCase() === v.toLowerCase());
    if (id) addFood(id); else { UI.fed = '+'; UI.fnew = v; renderJidlo(); const el = $('fdb'); if (el) el.scrollIntoView({ block: 'start' }); toast('„' + v + '“ v databázi není — doplň hodnoty'); } };
  $('fadd').onclick = search; $('fsearch').addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
  $('fsearch').addEventListener('change', () => { const v = $('fsearch').value.trim(); if (Object.keys(JR.food || {}).some(k => JR.food[k].l.toLowerCase() === v.toLowerCase())) search(); });
  $('faddm').onclick = () => { const jj = jEdit(d); jj.m.push({ s: UI.fmeal || MEAL_BY_H(new Date().getHours()), h: d === TODAY() ? nowHM() : '', w: '' }); jPut(d, jj); renderJidlo(); };
  // úpravy jídel dne
  const M = $('fmeals');
  M.addEventListener('change', e => { const mb = e.target.closest('.fmeal'); if (!mb) return; const i = +mb.dataset.i, jj = jEdit(d), m = jj.m[i]; if (!m) return;
    const fi = e.target.closest('.fit');
    if (fi) { const g = Math.round(+e.target.value); if (g > 0 && g <= 3000) m.it[+fi.dataset.k].g = g; else { e.target.value = m.it[+fi.dataset.k].g; return; } }
    else { m.s = mb.querySelector('select').value; m.h = mb.querySelector('input[type=time]').value; m.w = mb.querySelector('.fmeal-w').value.slice(0, 200); }
    jPut(d, jj); if (fi) renderJidlo(); });
  M.addEventListener('click', e => { const b = e.target.closest('[data-rmi],[data-rmm]'); if (!b) return; const mb = b.closest('.fmeal'), i = +mb.dataset.i, jj = jEdit(d);
    if (b.dataset.rmm != null) jj.m.splice(i, 1); else jj.m[i].it.splice(+b.dataset.rmi, 1);
    jPut(d, jj); renderJidlo(); });
  // váha
  $('fkg').addEventListener('change', e => { const v = parseFloat(String(e.target.value).replace(',', '.')), jj = jEdit(d);
    if (e.target.value === '') delete jj.kg; else if (v >= 30 && v <= 250) jj.kg = Math.round(v * 10) / 10; else { toast('Váha mimo rozsah 30–250 kg'); return; }
    jPut(d, jj); });
  // cíle
  P.querySelectorAll('[data-goal]').forEach(i => i.addEventListener('change', () => { const g = Object.assign({}, goals()), v = Math.round(+i.value);
    if (i.value === '' || !(v > 0)) delete g[i.dataset.goal]; else g[i.dataset.goal] = v; JR.cfg.goal = g; jCfgSave(); renderJidlo(); }));
  // databáze
  $('fq').addEventListener('input', e => { UI.fq = e.target.value; const pos = e.target.selectionStart; renderJidlo(); const q = $('fq'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) {} });
  $('fnew').onclick = () => { UI.fed = '+'; UI.fnew = ''; renderJidlo(); };
  P.querySelectorAll('[data-fed]').forEach(b => b.onclick = () => { UI.fed = b.dataset.fed; renderJidlo(); $('fdb').scrollIntoView({ block: 'start' }); });
  if ($('fsave')) {
    $('fcancel').onclick = () => { UI.fed = null; renderJidlo(); };
    $('fsave').onclick = async () => { const o = {}; P.querySelectorAll('[data-ff]').forEach(i => { const k = i.dataset.ff; o[k] = i.type === 'number' ? (i.value === '' ? null : +i.value) : i.value.trim(); });
      if (!o.l || o.k == null) { toast('Vyplň aspoň název a kcal / 100 g'); return; }
      const id = UI.fed === '+' ? foodIdOf(o.l) : UI.fed;
      if (!id) { toast('Neplatný název'); return; }
      if (UI.fed === '+' && JR.food && JR.food[id]) { toast('Jídlo „' + JR.food[id].l + '“ už v databázi je'); return; }
      if (await foodSave(id, o)) { UI.fed = null; renderJidlo(); } };
    if ($('fdel')) $('fdel').onclick = async () => { const id = UI.fed; if (await foodSave(id, null)) { UI.fed = null; renderJidlo(); } };
  }
}
