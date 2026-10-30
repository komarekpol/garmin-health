# Garmin Health

Dashboard zdraví a regenerace z hodinek Garmin (HRV, klidová TF, Body Battery, dýchání, spánek, readiness). Běží na PC, iPadu i iPhonu přes Google Apps Script; data stahuje PC z Garmin Connect a ukládá na Google Disk. Architektura a pravidla vývoje v `CLAUDE.md`.

## Nastavení (jednorázově)

**1. PC — automatický sync na Disk**
1. Ve složce `C:\Garmin Dashboard` dvojklik na **Nastavit automaticky sync.bat**. Založí úlohu v Plánovači (07:40, 12:40, 21:40; když je PC vypnuté, doběhne po zapnutí) a hned jednou stáhne data a zapíše `G:\Můj disk\Garmin Data\garmin-data.json`.

**2. Google Apps Script**
1. script.google.com → **Nový projekt** → přejmenovat na **Garmin Health**.
2. Soubor `Kód.gs` přejmenovat na **garmin** a vložit obsah `apps-script/garmin-apps-script.gs`.
3. Nastavení projektu (⚙) → zaškrtnout **Zobrazit soubor manifestu appsscript.json** → vložit obsah `apps-script/appsscript.json`.
4. Nastavení projektu → **Vlastnosti skriptu**: `GH_REPO` = `komarekpol/garmin-health`, `GH_TOKEN` = token GitHubu s přístupem k tomuto repu (fine-grained, Contents: Read).
5. Zapnout Apps Script API: script.google.com/home/usersettings (kvůli samoaktualizaci; pro Tradelog už zapnuté je).
6. **Implementovat → Nová implementace → Webová aplikace** (spouštět jako: já, přístup: jen já) → Implementovat.
7. V editoru spustit **setup** (povolit oprávnění) → v protokolu je adresa dashboardu `…/exec?key=…`.
8. Spustit **setupSelfUpdate** (hodinový časovač: aktualizace z GitHubu + hlídání starých dat).
9. Adresu otevřít na iPhonu / iPadu v Safari → Sdílet → **Přidat na plochu**.

## Lokálně (offline)
Zástupce **Start Garmin Dashboard** na ploše: stáhne data, zapíše export na Disk a otevře `garmin-dashboard.html` s lokálním serverem. Prahy se ukládají na Disk stejně jako v cloudu.

## Testy
```
npm install
python3 tests/test_local.py
node tests/t_dashboard.js
```
