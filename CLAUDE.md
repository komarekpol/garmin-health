# Garmin Health — pokyny pro vývoj

Pavlův zdravotní dashboard z hodinek Garmin (HRV, klidová TF, Body Battery, dýchání, spánek, readiness). Komunikace česky, stručně, jen ověřená data. Stejná architektura jako Tradelog / EdgePilot (`komarekpol/tradelog`).

## Soubory
- `garmin-dashboard.html` — celá aplikace (jeden soubor, vanilla JS + Chart.js z cdnjs). **Živá verze**: Apps Script ji při každém otevření stránky načte z větve `main` → push do `main` = nasazení na PC, iPad i iPhone.
- `apps-script/garmin-apps-script.gs` — Google Apps Script (soubor `garmin` v projektu „Garmin Health“, manifest `apps-script/appsscript.json`). **Nasazuje se sám**: `selfUpdateTick` 1× za hodinu stáhne soubor z `main`, ověří syntaxi, přepíše `garmin` a přepne nasazení. Musí dál obsahovat `function selfUpdate(` a `function doGet(` (pojistka). Změna oprávnění v manifestu nebo nová setup funkce = napsat Pavlovi přesně, co spustit.
- `local/` — běží na Pavlově PC ve složce `C:\Garmin Dashboard` (Windows, `C:\Python314\python.exe`). **Nenasazuje se samo**: po změně je Claude zapíše přes propojení s počítačem (device bridge) do `C:\Garmin Dashboard` a řekne, co spustit.
  - `garmin_data.py` — **jediný zdroj obsahu dat** (dotazy nad `~/.garmin-givemydata/garmin.db`, jen čtení `mode=ro`). Server i export ho importují.
  - `garmin_export.py` — zapíše `G:\Můj disk\Garmin Data\garmin-data.json` (Disk pro počítače ho nahraje). Atomicky; chyba / prázdná data = poslední dobrý soubor zůstává, kód 1.
  - `garmin_server.py` — lokální server `localhost:8765` (`/data`, `/sync` = stažení + export, `/settings` GET/POST) pro práci offline z `file://`.
  - `garmin_sync_export.bat` (Plánovač úloh, log `sync_log.txt`), `Start Garmin Dashboard.bat` (ručně: sync → export → server), `Nastavit automaticky sync.bat` + `nastavit_sync.ps1` (úloha `\Garmin Health\Sync a export` 07:40 / 12:40 / 21:40, StartWhenAvailable).
- `tests/` — `python3 tests/test_local.py` (syntetická DB → load_data → export) a `node tests/t_dashboard.js` (Playwright: cloud se skutečným `wrapScripts_` z .gs + model google.script.run, lokálně file:// + skutečný server, telefon 390 px). Osobní data v repu nikdy nejsou.

## Architektura
- **Garmin Connect → PC**: `python -m garmin_givemydata` (přihlášení v prohlížeči jen na PC, žádné heslo ani token Garminu v cloudu ani v repu) → `garmin.db`.
- **PC → Disk**: `garmin_export.py` → `Můj disk/Garmin Data/garmin-data.json` (dnes ~0,1–0,2 MB; 200 nocí + celá historie HRV).
- **Disk → dashboard**: Apps Script `doGet` (`…/exec?key=SYNC_KEY`) → `page_` (HTML z GitHubu přes `GH_REPO` / `GH_TOKEN`, záloha poslední dobré stránky na Disku `garmin-dashboard-zaloha.html`, `wrapScripts_` proti minifikaci HtmlService) + `window.__GH_CLOUD__` → stránka volá `google.script.run.ghGet(key)` (data + nastavení + stáří) a `ghSet(key, json)` (jen klíče `KEEP_KEYS_`).
- **Prahy a zóny** (`garmin_thresholds`, `garmin_*_zones`): soubor `Garmin Data/garmin-settings.json` — v cloudu přes `ghSet`, lokálně přes `/settings` serveru; stránka je drží v paměti `ST` (`stGet` / `stSet` / `stDel`), localStorage jen kopie. Nový uložený klíč = `ST_KEYS` v HTML + `KEEP_KEYS_` v .gs + `SETTINGS_KEYS` v serveru.
- **Hlídání**: data starší než 30 h → žlutá hláška na stránce a e-mail 1× denně (`staleWatch_` v `selfUpdateTick`); stav `Garmin Data/garmin-health-stav.json` (čte Claude při kontrole).
- Sync z cloudu nejde (data stahuje jen PC) — tlačítko „Sync Garmin“ je v cloudu skryté.

## Pravidla
- **Nikdy** necommitovat osobní / zdravotní data (garmin.db, exporty, FIT, nastavení), SYNC_KEY, GH token ani URL webové aplikace s klíčem. Repo zůstává soukromé.
- Data dashboardu se mění jen v `garmin_data.py` (verze `DATA_VERSION`); dashboard musí zvládnout chybějící pole.
- Před pushem: `python3 tests/test_local.py && node tests/t_dashboard.js` (0 FAIL), u UI změn zkontrolovat snímky `tests/out/*.png` (desktop i telefon — stránka nesmí být širší než 390 px).
- Commity česky, krátce co a proč.
- Limity: `garmin-data.json` varování nad 2 MB, odmítnutí nad 8 MB (`garmin_export.py`, `DATA_MAX_`); nastavení < 50 tis. znaků. Překročení nikdy potichu.
- Zdravotní doporučení na stránce jsou orientační; prahy nastavuje Pavel.

## Kroky nastavení (jednorázově, dělá Pavel)
Viz README.md → „Nastavení“.
