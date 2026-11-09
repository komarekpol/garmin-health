// ══════════ ZDRAVÍ — zdravotní agent: Imunita · CLL · Zdroje (9.11.2026, podnět Pavla) ══════════
// Obecné poznatky (ověřené zdroje) jsou tady v kódu. Osobní věci (laboratoř, nálezy, otázky pro lékaře, novinky, denní rutina)
// jsou jen na Disku: Garmin Data/garmin-zdravi.json + garmin-zdravi-novinky *.json (týdenní úloha) → Apps Script zdraviRead_ → DATA_Z.
// Nic z toho není diagnóza ani doporučení léčby — rozhoduje lékař. Úroveň důkazu je u každé položky.
let DATA_Z = null, ZCH = null;
const ZD_LVL = { silne: ['silné důkazy', 'good'], stredni: ['střední důkazy', 'info'], slabe: ['slabé / nejisté', 'amber'], ne: ['nepodložené', 'bad'], doporuc: ['rada lékaře', 'ok'], info: ['informace', 'ok'] };
const zdLvl = k => { const x = ZD_LVL[k] || ZD_LVL.info; return pill(x[0], x[1]); };
const ZD_SYM = ['nemoc', 'ryma', 'krk', 'kasel', 'teplota'];   // štítky deníku = známky infekce

// Co pomáhá imunitě — jen to, co se dá doložit studií; řazeno od nejsilnějšího důkazu
const ZD_EVID = [
  { id: 'ock', t: 'Očkování (neživé vakcíny)', lvl: 'silne',
    co: 'U CLL odborné společnosti doporučují chřipku (inaktivovanou) každý podzim, pneumokoka (konjugovaná vakcína), Shingrix proti pásovému oparu a COVID. Živé vakcíny se u CLL nedávají. Odpověď na očkování bývá u CLL slabší, proto co nejdřív, ještě před případnou léčbou.',
    jak: 'Probrat s hematologem při kontrole (otázka je v záložce CLL).',
    src: [['CLL Society – očkování u CLL', 'https://cllsociety.org/?p=29290']] },
  { id: 'spanek', t: 'Spánek aspoň 7 hodin', lvl: 'stredni',
    co: 'Lidé, kteří týden před kontaktem s virem rýmy spali méně než 6 h (měřeno náramkem), onemocněli 4,2× častěji než ti s více než 7 h. Krátký spánek oslabuje i odpověď na očkování.',
    jak: 'Garmin měří sám — níže „Spánek ≥ 7 h“, v Dnes spánkový dluh a ideální čas usínání.',
    src: [['Prather a kol., SLEEP 2015', 'https://doi.org/10.5665/sleep.4968']] },
  { id: 'pohyb', t: 'Pravidelný aerobní pohyb', lvl: 'stredni',
    co: '1 002 dospělých 12 týdnů v zimě: kdo se hýbal aerobně ≥ 5 dní v týdnu, měl o 43 % méně dní s nachlazením než ti, kdo ≤ 1 den. Observační studie — aktivní lidé žijí i jinak zdravěji.',
    jak: 'Garmin počítá sám — níže „Aerobní pohyb“ (dny s aktivitou ≥ 20 min).',
    src: [['Nieman a kol., Br J Sports Med 2011', 'https://doi.org/10.1136/bjsm.2010.077875']] },
  { id: 'vitd', t: 'Vitamin D (hlídat hladinu)', lvl: 'stredni',
    co: 'U CLL: nedostatek vitaminu D při diagnóze souvisel s kratším časem do léčby (Mayo Clinic) a užívání vitaminu D během sledování s delším časem do léčby (Izrael, 3 474 pacientů, medián 400 IU). Obojí observační. Proti nachlazení: nejnovější metaanalýza (2025) už statisticky významnou ochranu nenašla.',
    jak: 'Nech si změřit 25(OH)D — pak víš, jestli dávka sedí.',
    src: [['Parikh & Shanafelt, Blood Adv 2024', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11369631'], ['Jolliffe a kol., Lancet D&E 2025', 'https://researchonline.lshtm.ac.uk/id/eprint/4677068']] },
  { id: 'kvas', t: 'Kvašené potraviny', lvl: 'stredni',
    co: 'Randomizovaná studie Stanfordu (17 týdnů): strava bohatá na kvašené potraviny (jogurt, kefír, kysané zelí, kimchi, kombucha) zvýšila pestrost střevních bakterií a snížila 19 zánětlivých markerů včetně IL-6. Strava jen s vlákninou to nedokázala. Malá studie (18 lidí ve skupině).',
    jak: 'Denně 1–2 porce kvašeného, postupně víc. Zapíšeš je v Jídle.',
    src: [['Wastyk a kol., Cell 2021', 'https://doi.org/10.1016/j.cell.2021.06.019']] },
  { id: 'chlad', t: 'Studená sprcha na konci', lvl: 'stredni',
    co: '3 018 Nizozemců, 30 dní 30–90 s studené vody na konci sprchy: o 29 % méně absence v práci, ale stejně dní nemoci — nemoc snášeli lépe. Delší než 30 s nebylo lepší.',
    jak: 'Otužování z hodinek se počítá samo (níže); stačí 30 s na konci sprchy.',
    src: [['Buijze a kol., PLOS ONE 2016', 'https://doi.org/10.1371/journal.pone.0161749']] },
  { id: 'zinek', t: 'Zinek až při nachlazení (pastilky)', lvl: 'slabe',
    co: 'Cochrane 2024 (34 studií): preventivně zinek nachlazení nebrání; při začínajícím nachlazení zkracuje průběh asi o 2 dny (nízká jistota, víc vedlejších účinků). Horní bezpečná hranice EFSA pro dospělé je 25 mg zinku denně ze všech zdrojů — dlouhodobý nadbytek vyčerpává měď.',
    jak: 'Ne denně preventivně; pastilky do 24 h od prvních příznaků, pár dní.',
    src: [['Cochrane 2024 (Nault a kol.)', 'https://cochranelibrary.com/cdsr/doi/10.1002/14651858.CD014914.pub2/pdf/CDSR/CD014914/CD014914_abstract.pdf'], ['EFSA – horní limity', 'https://www.efsa.europa.eu/sites/default/files/2024-05/ul-summary-report.pdf']] },
  { id: 'nos', t: 'Proplach nosu a kloktání slanou vodou', lvl: 'slabe',
    co: 'Pilotní randomizovaná studie (66 dospělých, do 48 h od začátku rýmy): hypertonický solný proplach a kloktání zkrátily nemoc asi o 2 dny a snížily spotřebu léků. U dětí potvrdila větší studie s kapkami.',
    jak: 'Proplachy už děláš — při rýmě častěji (až několikrát denně) a přidat kloktání.',
    src: [['Ramalingam a kol., Sci Rep 2019', 'https://doi.org/10.1038/s41598-018-37703-3']] },
  { id: 'vitc', t: 'Vitamin C', lvl: 'slabe',
    co: 'Cochrane (29 srovnání, 11 306 lidí): pravidelný vitamin C výskyt nachlazení u běžné populace nesnižuje; délku zkracuje asi o 8 %. Víc pomohl jen při krátké extrémní zátěži (maraton, zimní cvičení vojáků).',
    jak: 'Neškodí, ale nečekej ochranu; víc má smysl spánek a pohyb.',
    src: [['Hemilä & Chalker, Cochrane 2013', 'https://doi.org/10.1002/14651858.CD000980.pub4']] },
  { id: 'egcg', t: 'Extrakt zeleného čaje (EGCG) u CLL', lvl: 'slabe',
    co: 'Mayo Clinic, studie fáze 2 bez kontrolní skupiny (42 pacientů, 2 000 mg 2× denně): trvalý pokles lymfocytů o ≥ 20 % u 31 %, zmenšení uzlin u většiny. EFSA: od 800 mg EGCG denně v doplňcích stoupají jaterní testy, bezpečnou dávku nestanovila.',
    jak: 'Při doplňcích kolem 800 mg EGCG denně hlídat ALT/AST a probrat s hematologem.',
    src: [['Shanafelt a kol., Cancer 2013', 'https://pubmed.ncbi.nlm.nih.gov/22760587/'], ['EFSA 2018 – katechiny', 'https://www.efsa.europa.eu/en/press/news/180418']] },
];

// Videa a kanály, které Pavel sleduje — co z nich obstojí
const ZD_SRC = [
  { kdo: 'Huberman & Seheult: 8 pilířů imunity (2025)', url: 'https://youtu.be/xOuUrziY5hQ', lvl: 'stredni',
    tvrz: 'Rámec NEWSTART: výživa, pohyb, voda, slunce, střídmost, vzduch, odpočinek, důvěra.',
    verd: 'Pilíře odpovídají tomu, co má oporu (spánek, pohyb, vitamin D). Konkrétní dávky a čísla ověřuj zvlášť.' },
  { kdo: 'Jan Černý (imunolog): Neprůstřelná imunita? (podcast 3/2026)', url: 'https://youtu.be/PcwRJYcQd_0', lvl: 'info',
    tvrz: 'Hygiena a mikroby, proč někdo onemocní a jiný ne, co imunitě škodí.',
    verd: 'Přepis YouTube nepustil — obsah zatím nehodnotím. Autor je vědec-imunolog; až ho poslechneš, napiš mi, co zaujalo, a ověřím to.' },
  { kdo: 'Dr. Eric Berg: Bulletproof immune system (kurz, 2020)', url: 'https://youtu.be/RHjX7A02rqc', lvl: 'ne',
    tvrz: 'Bezplatný kurz přes Messenger, odměna za sdílení; autor (chiropraktik) prodává vlastní doplňky.',
    verd: 'Marketing, žádná data. „Neprůstřelnou“ imunitu nic neudělá.' },
  { kdo: 'Dr. Eric Berg: 7 nejdůležitějších živin (A, E, D, C, zinek, selen, měď)', url: 'https://www.youtube.com/watch?v=YuO2FwBrmqY', lvl: 'slabe',
    tvrz: 'Bez těchto živin imunita nefunguje; zdroje máslo z pastvy, žloutky, játra, mořské plody.',
    verd: 'Pravda je, že nedostatek škodí. Doplňování bez nedostatku má ale slabé výsledky (vitamin C −8 % délky nachlazení, zinek preventivně nic, vitamin D 2025 bez průkazné ochrany).' },
  { kdo: 'Dr. William Li: „Jez a poraz nemoc“', url: 'https://www.youtube.com/@DrWilliamLi', lvl: 'slabe',
    tvrz: 'Titulky typu „lžička denně ničí rakovinné buňky a buduje imunitu“ — houby, kvašené, olivový olej, brukvovitá zelenina.',
    verd: 'Hodnoceno podle názvů videí. Jídla jsou rozumná součást stravy (kvašené má RCT), ale „ničí rakovinu“ jde z laboratorních a zvířecích studií, u lidí neprokázáno.' },
  { kdo: 'Dr. Sten Ekberg: imunita, NAC, vitamin D', url: 'https://www.youtube.com/@drekberg', lvl: 'slabe',
    tvrz: '„10 tajemství, jak už nikdy neonemocnět“, NAC, vitamin D.',
    verd: 'Hodnoceno podle názvů videí. Spánek, pohyb a vitamin D sedí s výzkumem; „nikdy neonemocnět“ ne. Konkrétní doplněk mi pošli a ověřím.' },
];

// ── data z Disku ──
function zdInit(r) { DATA_Z = r && r.zdravi && !r.zdravi.error ? r.zdravi : null; if (r && r.zdravi && r.zdravi.error) DATA_Z = { error: r.zdravi.error }; }
const zLabs = () => ((DATA_Z && DATA_Z.cll && DATA_Z.cll.labs) || []).filter(x => x && x.d).slice().sort((a, b) => a.d < b.d ? -1 : 1);
const zD = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? +m[3] + '. ' + +m[2] + '. ' + m[1] : ''; };   // laboratoř je přes roky → vždy s rokem
const dDiff = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

// Zdvojení lymfocytů (LDT): lineární regrese ln(ALC) v čase, jako v iwCLL; null = málo bodů nebo nerostou
function ldtOf(labs, sinceD) {
  const p = labs.filter(x => num(x.alc) > 0 && (!sinceD || x.d >= sinceD)); if (p.length < 3) return null;
  const t0 = p[0].d, xs = p.map(x => dDiff(t0, x.d)), ys = p.map(x => Math.log(num(x.alc))), mx = avg(xs), my = avg(ys);
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) * (x - mx); });
  if (!sxx) return null; const k = sxy / sxx; if (!(k > 0)) return { m: null, n: p.length, from: t0, to: p[p.length - 1].d, flat: true };
  return { m: Math.log(2) / k / 30.44, n: p.length, from: t0, to: p[p.length - 1].d };
}
// Úbytek váhy za 6 měsíců z deníku (kritérium iwCLL ≥ 10 %)
function kgDrop6m() {
  const from = addD(TODAY(), -183), ks = Object.keys(JR.days).filter(d => d >= from && JR.days[d].kg != null).sort(); if (ks.length < 2) return null;
  const mx = Math.max(...ks.map(d => +JR.days[d].kg)), last = +JR.days[ks[ks.length - 1]].kg; return { pct: (mx - last) / mx * 100, mx, last, n: ks.length };
}
const tagDays = (ids, n) => { const from = addD(TODAY(), -n + 1); return Object.keys(JR.days).filter(d => d >= from && ids.some(id => ((JR.days[d].t || {})[id] || 0) > 0)).length; };
function illDays(n) { const ref = (DATA && DATA.date) || TODAY(); let c = 0; for (let i = 0; i < n; i++) { const a = illDevs(addD(ref, -i)); if (a && a.length >= 2) c++; } return c; }

// ── Imunita tento týden: jen z hodinek a deníku, nic se nevyplňuje ──
function immWeek() {
  const ref = (DATA && DATA.date) || TODAY(), L = n => { const o = []; for (let i = 0; i < n; i++) { const x = BYD[addD(ref, -i)]; if (x) o.push(x); } return o; };
  const w = L(7), m = L(30), rows = [];
  const sl = w.map(x => num(x.sh)).filter(v => v != null);
  if (sl.length) { const ok = sl.filter(v => v >= 7).length; rows.push({ l: 'Spánek ≥ 7 h', v: ok + ' z ' + sl.length + ' nocí', s: 'Ø ' + hm(avg(sl)), k: ok >= Math.ceil(sl.length * 0.7) ? 'good' : ok >= sl.length / 2 ? 'amber' : 'crit', ev: 'spanek' }); }
  const aer = w.filter(x => (x.a || []).some(a => num(a.m) >= 20 && sportOf(a) !== 'otuz')).length;
  rows.push({ l: 'Aerobní pohyb ≥ 20 min', v: aer + ' z 7 dní', s: 'cíl 5 dní v týdnu', k: aer >= 5 ? 'good' : aer >= 3 ? 'amber' : 'crit', ev: 'pohyb' });
  const cold = w.reduce((s, x) => s + (x.a || []).filter(a => sportOf(a) === 'otuz').length, 0);
  rows.push({ l: 'Otužování', v: cold + '× za 7 dní', s: 'z hodinek (Cold Plunge / Shower)', k: cold >= 3 ? 'good' : cold ? 'ok' : 'ok', ev: 'chlad' });
  const rs = k => (k || []).map(x => num(x.rsN ?? x.rs)).filter(v => v != null), r7 = rs(w), r30 = rs(m);
  if (r7.length >= 3 && r30.length >= 10) { const d = avg(r7) - avg(r30); rows.push({ l: 'Dýchání v noci', v: fmt(avg(r7), 1) + ' /min', s: 'proti Ø 30 dní ' + sgn(d, 1), k: d >= 0.7 ? 'amber' : 'good' }); }
  const st = k => (k || []).map(x => num(x.st)).filter(v => v != null), s7 = st(w), s30 = st(m);
  if (s7.length >= 3 && s30.length >= 10) { const d = avg(s7) - avg(s30); rows.push({ l: 'Stres dne', v: 'Ø ' + fmt(avg(s7)), s: 'proti Ø 30 dní ' + sgn(d, 0), k: d >= 5 ? 'amber' : 'good' }); }
  const il = illOf(), id30 = illDays(30);
  rows.push({ l: 'Ranní signál nemoci', v: il ? (il.lvl === 'crit' ? 'výrazné známky' : 'drobné známky') : 'klid', s: id30 ? id30 + ' rán za 30 dní se 2+ odchylkami' : 'za 30 dní žádné', k: il ? (il.lvl === 'crit' ? 'crit' : 'amber') : 'good' });
  const sy = tagDays(ZD_SYM, 90);
  rows.push({ l: 'Příznaky v deníku', v: sy + ' dní za 90 dní', s: 'štítky nemoc, rýma, krk, kašel, teplota', k: sy >= 10 ? 'amber' : 'ok' });
  return rows;
}

// ── vykreslení ──
function renderZdravi() {
  const tab = UI.zd || 'imun';
  $('p-zdravi').innerHTML = `
  <div class="page-head"><div><div class="page-t">Zdraví</div><div class="page-s">Tvůj zdravotní agent: co z hodinek a deníku vypovídá o imunitě, sledování CLL a co z videí obstojí.</div></div>
    <div class="seg" id="zdseg">${[['imun', 'Imunita'], ['cll', 'CLL'], ['zdroje', 'Zdroje']].map(([k, l]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  <div id="zdbody">${tab === 'cll' ? zdCll() : tab === 'zdroje' ? zdZdroje() : zdImun()}</div>
  <div class="card xs muted">Orientační přehled ze studií a tvých dat — není to diagnóza ani doporučení léčby. Změny doplňků a léčby vždy s lékařem.</div>`;
  $('zdseg').querySelectorAll('button').forEach(b => b.onclick = () => { UI.zd = b.dataset.k; renderZdravi(); });
  $('p-zdravi').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('p-zdravi').querySelectorAll('[data-zd]').forEach(b => b.addEventListener('click', () => { UI.zd = b.dataset.zd; renderZdravi(); }));
  if (tab === 'cll') zdChart();
}
const zdRow = r => `<tr><td>${esc(r.l)}</td><td>${pill(r.v, r.k)}</td><td class="t2">${esc(r.s)}</td></tr>`;
function zdImun() {
  const W = immWeek(), R = (DATA_Z && DATA_Z.imun && DATA_Z.imun.rutina) || [];
  const groups = ['silne', 'stredni', 'slabe'].map(k => ({ k, it: ZD_EVID.filter(e => e.lvl === k) })).filter(g => g.it.length);
  return `
  <div class="card"><div class="card-h"><div class="card-t">Imunita tento týden</div><span class="card-s">z hodinek a deníku · nic nevyplňuješ</span></div>
    <div class="tbl-wrap"><table data-nogrid id="zdweek"><thead><tr><th>Co</th><th>Stav</th><th>Detail</th></tr></thead><tbody>${W.map(zdRow).join('')}</tbody></table></div>
    <div class="xs muted" style="margin-top:var(--sp-2)">Rýmu, krk, kašel nebo teplotu odklikneš v Deníku (skupina Příznaky) — stačí jen dny, kdy něco je.</div></div>
  ${R.length ? `<div class="card"><div class="card-h"><div class="card-t">Tvoje denní rutina pro imunitu</div><span class="card-s">navázaná na tvůj den</span></div>
    <div class="zd-rut">${R.map(x => `<div class="zd-r"><b class="zd-h">${esc(x.h)}</b><div><div>${esc(x.co)} ${zdLvl(x.lvl)}</div><div class="xs t2">${esc(x.proc)}</div></div></div>`).join('')}</div></div>`
    : `<div class="card sm t2">Osobní rutina se načítá z Disku (garmin-zdravi.json)${DATA_Z && DATA_Z.error ? ': ' + esc(DATA_Z.error) : ' — v offline režimu na PC není.'}</div>`}
  ${groups.map(g => `<div class="card"><div class="card-h"><div class="card-t">Co pomáhá — ${esc(ZD_LVL[g.k][0])}</div></div>
    <div class="zd-ev">${g.it.map(e => `<div class="zd-e" id="zd-${e.id}"><div class="zd-et"><b>${esc(e.t)}</b>${zdLvl(e.lvl)}</div><div class="sm">${esc(e.co)}</div>
      <div class="sm t2" style="margin-top:4px"><b class="t2">U tebe:</b> ${esc(e.jak)}</div>
      <div class="xs">${e.src.map(s => `<a class="lnk" href="${esc(s[1])}" target="_blank" rel="noopener">${esc(s[0])}</a>`).join(' · ')}</div></div>`).join('')}</div></div>`).join('')}`;
}
function zdZdroje() {
  return `<div class="card"><div class="card-h"><div class="card-t">Videa a kanály — co obstojí</div><span class="card-s">ověřeno proti studiím v záložce Imunita</span></div>
    <div class="zd-ev">${ZD_SRC.map(s => `<div class="zd-e"><div class="zd-et"><a class="lnk" href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.kdo)}</b></a>${zdLvl(s.lvl)}</div>
      <div class="sm t2">${esc(s.tvrz)}</div><div class="sm" style="margin-top:4px">${esc(s.verd)}</div></div>`).join('')}</div>
    <div class="xs muted" style="margin-top:var(--sp-3)">Celé kanály projít nejde (stovky videí a YouTube nepouští přepisy). Pošli mi konkrétní video nebo tvrzení a ověřím ho stejně.</div></div>`;
}
function zdCll() {
  const C = DATA_Z && DATA_Z.cll;
  if (!C) return `<div class="card empty">Údaje o CLL se načítají z Disku (Garmin Data/garmin-zdravi.json)${DATA_Z && DATA_Z.error ? ' — ' + esc(DATA_Z.error) : ' a v offline režimu na PC nejsou'}.</div>`;
  const L = zLabs(), last = L.filter(x => num(x.alc) != null).pop() || L[L.length - 1] || {}, lastAny = L[L.length - 1] || {};
  const ldtAll = ldtOf(L), ldt12 = ldtOf(L, addD(TODAY(), -460)), kd = kgDrop6m(), sweat = tagDays(['teplota', 'poceni'], 30), tired = tagDays(['unava'], 30);
  const ldtTxt = r => !r ? 'málo odběrů' : r.flat ? 'neroste' : r.m >= 24 ? (r.m / 12).toFixed(1).replace('.', ',') + ' roku' : Math.round(r.m) + ' měs.';
  const ldtK = r => !r || r.flat ? 'good' : r.m < 6 ? 'crit' : r.m < 12 ? 'amber' : 'good';
  const hb = num(lastAny.hb) ?? num(last.hb), plt = num(lastAny.plt) ?? num(last.plt);
  // Kritéria iwCLL 2018 pro zahájení léčby (stačí jedno) — co jde, se vyhodnotí z dat; zbytek posoudí lékař
  const crit = [
    { l: 'Hemoglobin < 100 g/l nebo destičky < 100', v: hb == null ? '—' : 'Hb ' + fmt(hb) + ' · PLT ' + fmt(plt), k: hb == null ? 'ok' : hb < 100 || plt < 100 ? 'crit' : hb < 120 || plt < 130 ? 'amber' : 'good', s: 'z posledního odběru ' + (lastAny.d ? zD(lastAny.d) : '') },
    { l: 'Zdvojení lymfocytů < 6 měsíců', v: 'celkem ' + ldtTxt(ldtAll) + ' · posledních 15 měs. ' + ldtTxt(ldt12), k: ldtK(ldt12 || ldtAll), s: 'regrese ALC ' + (ldtAll ? ldtAll.n + ' odběrů' : '') + '; při ALC < 30 jen orientačně' },
    { l: 'Úbytek váhy ≥ 10 % za 6 měsíců', v: kd ? (kd.pct > 0 ? '−' + fmt(kd.pct, 1) + ' %' : 'bez úbytku') : 'málo vážení', k: !kd ? 'ok' : kd.pct >= 10 ? 'crit' : kd.pct >= 5 ? 'amber' : 'good', s: kd ? 'z deníku: max ' + fmt(kd.mx, 1) + ' → ' + fmt(kd.last, 1) + ' kg' : 'zapisuj váhu (Jídlo nebo chat)' },
    { l: 'Teplota ≥ 38 °C 2+ týdny / noční pocení > 1 měsíc', v: sweat ? sweat + ' dní za 30' : 'nezapsáno', k: sweat >= 14 ? 'crit' : sweat ? 'amber' : 'good', s: 'štítky Teplota a Noční pocení v Deníku' },
    { l: 'Únava bránící práci', v: tired ? tired + ' dní za 30' : 'nezapsáno', k: tired >= 14 ? 'amber' : 'good', s: 'štítek Výrazná únava; Body Battery a spánek v Dnes' },
    { l: 'Velké / rostoucí uzliny, zvětšená slezina', v: 'posoudí lékař', k: 'ok', s: 'poslední nález: ' + (C.prog || []).filter(p => /Uzliny/.test(p.l)).map(p => p.v).join('') },
  ];
  const nov = ((DATA_Z && DATA_Z.nov) || []).slice().sort((a, b) => a.d < b.d ? 1 : -1);
  const kon = C.kontrola || {}, dLeft = kon.d ? Math.round(dDiff(TODAY(), kon.d)) : null;
  const cell = (x, k, dec) => x[k] == null ? '<td class="num muted">—</td>' : `<td class="num">${fmt(x[k], dec)}</td>`;
  return `
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Stav</div>${pill('sledování (watch & wait)', 'good')}</div>
      <div class="sm">${esc(C.zaver || '')}</div>
      <div class="sm t2" style="margin-top:var(--sp-2)">Diagnóza ${esc(zD(C.dg || ''))} · ${esc([C.stadium, C.lekar].filter(Boolean).join(' · '))}</div>
      ${kon.d ? `<div class="kpi-v" style="margin-top:var(--sp-3)">${dLeft >= 0 ? 'za ' + dLeft + ' dní' : 'proběhla'}<small> kontrola ${esc(zD(kon.d))}</small></div><div class="xs muted">${esc(kon.co || '')}</div>` : ''}</div>
    <div class="card"><div class="card-h"><div class="card-t">Prognostické nálezy</div><span class="card-s">ze zpráv hematologie</span></div>
      <div class="tbl-wrap"><table data-nogrid><tbody>${(C.prog || []).map(p => `<tr><td>${esc(p.l)}${p.pozn ? `<div class="xs muted">${esc(p.pozn)}</div>` : ''}</td><td>${pill(p.v, p.k)}</td></tr>`).join('')}</tbody></table></div></div>
  </div>
  <div class="card"><div class="card-h"><div class="card-t">Lymfocyty a leukocyty</div><span class="card-s">×10⁹/l · poslední ${last.d ? esc(zD(last.d)) : '—'}: ALC ${fmt(last.alc, 2)}</span></div>
    <div class="chart-box" style="height:240px"><canvas id="zdch"></canvas></div>
    <div class="tbl-wrap" style="margin-top:var(--sp-3)"><table data-nogrid id="zdlabs"><thead><tr><th>Odběr</th><th>Leu</th><th>Lymfo</th><th>Neutro</th><th>Hb</th><th>PLT</th><th>Kreat.</th><th>ALT</th><th>CRP</th></tr></thead>
      <tbody>${L.slice().reverse().map(x => `<tr><td>${esc(zD(x.d))}<div class="xs muted">${esc(x.src || '')}</div></td>${cell(x, 'wbc', 2)}${cell(x, 'alc', 2)}${cell(x, 'neu', 2)}${cell(x, 'hb')}${cell(x, 'plt')}${cell(x, 'crea')}${cell(x, 'alt', 2)}${cell(x, 'crp', 1)}</tr>`).join('')}</tbody></table></div>
    <div class="xs muted" style="margin-top:var(--sp-2)">Samotný počet lymfocytů není důvod k léčbě (iwCLL); rozhoduje rychlost růstu, krevní obraz, uzliny a příznaky.</div></div>
  <div class="card"><div class="card-h"><div class="card-t">Kritéria iwCLL pro zahájení léčby</div><span class="card-s">stačí jedno · hlídám z dat, co jde</span></div>
    <div class="tbl-wrap"><table data-nogrid id="zdcrit"><thead><tr><th>Kritérium</th><th>Teď</th><th>Odkud</th></tr></thead><tbody>${crit.map(r => `<tr><td>${esc(r.l)}</td><td>${pill(r.v, r.k)}</td><td class="t2 sm">${esc(r.s)}</td></tr>`).join('')}</tbody></table></div>
    <div class="xs"><a class="lnk" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6913497/table/T1" target="_blank" rel="noopener">iwCLL 2018 – kritéria (Hallek a kol.)</a></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><div class="card-t">Otázky pro hematologa</div><span class="card-s">na kontrolu</span></div>
      <ol class="zd-q">${(C.otazky || []).map(q => `<li class="sm">${esc(q)}</li>`).join('')}</ol>
      ${(C.doklady || []).length ? `<div class="xs" style="margin-top:var(--sp-2)">${C.doklady.map(x => `<a class="lnk" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.l)}</a>`).join(' · ')}</div>` : ''}</div>
    <div class="card"><div class="card-h"><div class="card-t">Novinky výzkumu</div><span class="card-s">každý týden (pondělí)</span></div>
      ${nov.length ? `<div class="zd-ev">${nov.slice(0, 8).map(n => `<div class="zd-e"><div class="zd-et"><b>${esc(n.t)}</b>${zdLvl(n.lvl)}</div><div class="xs muted">${esc(zD(n.d))}</div>
        <div class="sm">${esc(n.co)}</div>${n.proMe ? `<div class="sm t2" style="margin-top:4px"><b class="t2">Pro tebe:</b> ${esc(n.proMe)}</div>` : ''}${n.url ? `<div class="xs"><a class="lnk" href="${esc(n.url)}" target="_blank" rel="noopener">zdroj</a></div>` : ''}</div>`).join('')}</div>`
      : '<div class="muted sm">Zatím nic — první přehled přijde v pondělí.</div>'}</div>
  </div>
  <div class="card sm t2">Imunita je u CLL důležitá kvůli infekcím — co jí pomáhá a jak to hlídat z hodinek, je v záložce <button class="lnk" data-zd="imun">Imunita</button>.</div>`;
}
function zdChart() {
  const el = $('zdch'); if (!el || typeof Chart === 'undefined') return;
  if (ZCH) { try { ZCH.destroy(); } catch (e) {} ZCH = null; }
  const L = zLabs().filter(x => num(x.wbc) != null || num(x.alc) != null), t3 = tok('--text3'), font = { size: 11 };
  const ds = [['Leukocyty', 'wbc', '--blue', []], ['Lymfocyty', 'alc', '--crit', []], ['Neutrofily', 'neu', '--teal', [4, 3]]].map(([l, k, c, dash]) => ({
    label: l, data: L.map(x => num(x[k])), borderColor: tok(c), backgroundColor: tok(c), borderDash: dash, spanGaps: true, tension: 0.2, pointRadius: 3, borderWidth: 2 }));
  ZCH = new Chart(el, { type: 'line', data: { labels: L.map(x => zD(x.d)), datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: t3, font, boxWidth: 10 } } },
      scales: { x: { ticks: { color: t3, font }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: t3, font }, grid: { color: tok('--border') } } } } });
}
