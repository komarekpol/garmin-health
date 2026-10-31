// ══════════ INOVACE — backlog návrhů (píše Claude, hlasuje Pavel v záložce Inovace) ══════════
// Položka: id 'I-NNN', d = datum návrhu, t = název, co = co to přinese, jak = jak to bude fungovat,
// vypl = kolik vyplňování navíc (0 = žádné, 1 = jedno klepnutí denně, 2 = víc), zdroj + url = odkud nápad je (ověřené),
// st = 'navrh' | 'zavedeno' | 'zamitnuto', done = datum zavedení / uzavření, why = co přesně bylo uděláno (důkaz: commit / soubor),
// pavel = co musí Pavel udělat sám (např. vložit nový Apps Script), jinak prázdné.
// Hlasy a podněty Pavla jsou na Disku v garmin-settings.json → klíč garmin_ui → { inov: { 'I-001': { v: 'ano' | 'pozdeji' | 'ne', c, at } }, pod: [{ id, t, at }] }.
// Týdenní úloha Clauda: zavede schválené (v = 'ano'), doplní st / done / why, uzavře podněty v INOV_POD_DONE a přidá 2–3 nové návrhy. Nic se nemaže.
const INOV = [
  { id: 'I-001', d: '2026-10-30', t: 'Ranní pocit jedním klepnutím',
    co: 'Uvidíš, jestli se tvůj pocit shoduje s odhadem připravenosti, a Vlivy začnou počítat i s tím, jak se cítíš — ne jen s čísly z hodinek.',
    jak: 'Na stránce Dnes pět smajlíků (1 = mizerně … 5 = skvěle). Jedno klepnutí ráno, nic víc. V Trendech pocit vedle HRV, ve Vlivech jako další výsledek.',
    vypl: 1, zdroj: 'vlastní nápad', url: '', st: 'navrh' },
  { id: 'I-002', d: '2026-10-30', t: 'Stav regenerace podle trendu HRV',
    co: 'Místo jedné noci uvidíš, jak se tělo vyrovnává se zátěží za poslední týden: zvládáš / stabilní / riziko přetížení / nahromaděná únava.',
    jak: 'Z 7denního průměru HRV proti tvému normálnímu pásmu, kolísání HRV ze dne na den (CV) a klidové TF — stejný princip jako HRV4Training. Bez vyplňování.',
    vypl: 0, zdroj: 'HRV4Training — automatická detekce trendu', url: 'https://www.hrv4training.com/blog2/automatically-detected-physiological-trend-how-are-you-coping-with-your-training', st: 'navrh' },
  { id: 'I-003', d: '2026-10-30', t: 'Tvůj ideální čas usínání',
    co: 'Večer uvidíš okno, kdy jít spát, aby byl spánek nejlepší — odvozené z tvých vlastních nocí.',
    jak: 'Z nocí s nejlepším skóre spánku a nejnižší klidovou TF najde typický čas usínání (Oura potřebuje ~2 týdny pravidelných dat). Apps Script začne ukládat čas usnutí a probuzení.',
    vypl: 0, zdroj: 'Oura — Bedtime Guidance', url: 'https://support.ouraring.com/hc/en-us/articles/360025445154-Bedtime-Guidance', st: 'navrh', pavel: 'vložit nový Apps Script (pošlu)' },
  { id: 'I-004', d: '2026-10-30', t: 'Deník: „Jako včera“ a jen tvoje štítky',
    co: 'Méně klikání. Doplňky a běžné věci bývají denně stejné.',
    jak: 'Tlačítko „Jako včera“ zkopíruje štítky a doplňky z předchozího dne. Štítky, které nepoužíváš, se schovají pod „Další“. WHOOP doporučuje sledovat jen 5–10 věcí, které reálně zapisuješ, a vliv ukazuje už po 5 záznamech.',
    vypl: 0, zdroj: 'WHOOP Journal (the5krunner)', url: 'https://the5krunner.com/2023/04/15/whoop-new-recovery-behaviours/', st: 'navrh' },
  { id: 'I-005', d: '2026-10-30', t: 'Nedělní souhrn týdne e-mailem',
    co: 'Jednou týdně krátce do mailu: co se zlepšilo a zhoršilo, nejlepší a nejhorší noc, co ukázaly Vlivy. Nemusíš nic otevírat.',
    jak: 'Apps Script v neděli večer pošle e-mail se stejnými čísly jako karta Krátce + Vlivy. Bez vyplňování.',
    vypl: 0, zdroj: 'vlastní nápad', url: '', st: 'navrh', pavel: 'vložit nový Apps Script (pošlu)' },
  { id: 'I-006', d: '2026-10-30', t: 'Běh: doporučení na dnešek',
    co: 'Ráno jedna věta: volno / lehký běh / normální / můžeš přitlačit — podle regenerace i toho, kolik jsi naběhal.',
    jak: 'Spojí odhad připravenosti s tréninkovou zátěží posledních 7 dní proti průměru 4 týdnů (z aktivit Garminu). Krok k osobnímu trenérovi běhu.',
    vypl: 0, zdroj: 'vlastní nápad (cíl projektu: osobní trenér běhu); pásmo zátěže 0,8–1,3 (Gabbett 2016, The training—injury prevention paradox)', url: 'https://www.iat.uni-leipzig.de/datenbanken/iks/dfb/Record/4040728', st: 'zavedeno', done: '2026-10-30',
    why: 'Záložka Běh nahoře „Dnes“: runAdvice() v src/beh.js = odhad připravenosti + zátěž 7 dní vs Ø 28 dní (loadRatio)' },
  { id: 'I-007', d: '2026-10-31', t: 'Pravidelné doplňky se zapíšou samy',
    co: 'Doplněk, který bereš denně (např. EGCg ráno), nemusíš odklikávat — v deníku bude zaškrtnutý sám a odškrtneš ho jen ve dny, kdy ho vynecháš.',
    jak: 'U doplňku v Nastavení volba „každý den“ (+ čas). Vlivy pak porovnají jen dny, kdy jsi ho vynechal. Bez vyplňování.',
    vypl: 0, zdroj: 'podnět Pavla 31.10.2026 (EGCg 2 kapsle kolem 6:00)', url: '', st: 'navrh' },
];
// Vyřešené podněty Pavla: { id podnětu: { done: 'RRRR-MM-DD', why: 'co bylo uděláno' } }
const INOV_POD_DONE = {};
