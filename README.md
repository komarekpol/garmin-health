# Garmin Health

Dashboard zdraví a regenerace z hodinek Garmin (HRV, klidová TF, Body Battery, dýchání, spánek, připravenost) na PC, iPadu i iPhonu. Běží celý v cloudu: Google Apps Script stahuje data z oficiálního **Garmin Connect Personal API** na Google Disk a servíruje stránku z tohoto repa. PC není potřeba. Architektura a pravidla vývoje v `CLAUDE.md`.

## Nastavení (jednorázově, ~10 minut)

**1. Klíč Garmin Personal API**
1. connect.garmin.com (web, přihlášení) → Nastavení → **Personal API Key** → **Create Key** → souhlas s podmínkami → platnost **1 rok** → Create.
2. Klíč se zobrazí jen jednou — zkopíruj ho rovnou do kroku 2.4 (do chatu ani nikam jinam ho nevkládej).

**2. Google Apps Script**
1. script.google.com → **Nový projekt** → přejmenovat na **Garmin Health**.
2. Soubor `Kód.gs` přejmenovat na **garmin** a vložit obsah `apps-script/garmin-apps-script.gs`.
3. Nastavení projektu (⚙) → zaškrtnout **Zobrazit soubor manifestu appsscript.json** → vložit obsah `apps-script/appsscript.json`.
4. Nastavení projektu → **Vlastnosti skriptu**:
   - `GARMIN_API_KEY` = klíč z kroku 1
   - `GARMIN_KEY_EXP` = datum vypršení klíče ve tvaru `RRRR-MM-DD` (připomínka e-mailem 30 dní předem)
   - `GH_REPO` = `komarekpol/garmin-health`
   - `GH_TOKEN` = token GitHubu s přístupem k tomuto repu (fine-grained, Contents: Read)
5. Apps Script API musí být zapnuté: script.google.com/home/usersettings (kvůli samoaktualizaci; pro Tradelog už zapnuté je).
6. **Implementovat → Nová implementace → Webová aplikace** (spouštět jako: já, přístup: jen já) → Implementovat.
7. V editoru spustit **testGarmin** (povolit oprávnění) → protokol ukáže, které údaje Garmin vrací.
8. Spustit **syncNow** → první stažení historie (HRV 2 roky, ostatní ~7 měsíců; když to nestihne najednou, doběhne samo během pár hodin).
9. Spustit **setup** → v protokolu je adresa dashboardu `…/exec?key=…`.
10. Spustit **setupSelfUpdate** (hodinový časovač: sync z Garminu ~každé 2 h, aktualizace z GitHubu, hlídání).
11. Adresu otevřít na iPhonu / iPadu v Safari → Sdílet → **Přidat na plochu**.

**Obnova klíče (1× ročně)**: nový klíč v Garmin Connect → Vlastnosti skriptu `GARMIN_API_KEY` a `GARMIN_KEY_EXP` → starý klíč zrušit.

## Offline (volitelné, PC)
`local/` + zástupce **Start Garmin Dashboard**: stáhne data do lokální databáze (garmin-givemydata) a otevře dashboard s lokálním serverem. Prahy sdílí s cloudem přes Disk.

## Testy
```
npm install
node tests/t_gas_sync.js
node tests/t_dashboard.js
python3 tests/test_local.py
```
