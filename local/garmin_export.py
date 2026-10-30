r"""
Garmin export na Google Disk
============================
Zapíše stejná data, jaká vrací lokální server (/data), do souboru
  G:\Můj disk\Garmin Data\garmin-data.json
Google Drive pro počítače ho nahraje na Disk, Apps Script ho odtamtud servíruje dashboardu
na PC, iPadu i iPhonu (bez běžícího PC a bez přihlášení ke Garminu v cloudu).

Spouští ho Plánovač úloh (garmin_sync_export.bat) a lokální server po „Sync Garmin“.
Cílovou složku lze změnit proměnnou prostředí GARMIN_EXPORT_DIR.

Zápis je atomický (dočasný soubor -> přejmenování), takže Disk nikdy nenahraje rozepsaný soubor.
Při chybě zůstane poslední dobrý soubor a skript skončí s kódem 1 (Plánovač úloh to ukáže).
"""

import json, os, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

from garmin_data import load_data

EXPORT_DIR = Path(os.environ.get("GARMIN_EXPORT_DIR") or r"G:\Můj disk\Garmin Data")
EXPORT_FILE = "garmin-data.json"
# Apps Script čte soubor celý a posílá ho stránce přes google.script.run; dnes ~0,1–0,2 MB (200 nocí + celá historie HRV)
SIZE_WARN = 2_000_000
SIZE_MAX = 8_000_000


def main():
    data = load_data()
    if data.get("error"):
        print(f"CHYBA: {data['error']} — export se nezapsal, na Disku zůstává poslední dobrý soubor.")
        return 1
    if not data.get("nights"):
        print("CHYBA: v datech nejsou žádné noci — export se nezapsal (ochrana proti přepsání prázdnými daty).")
        return 1

    data["exported_at"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    data["source"] = os.environ.get("COMPUTERNAME", "pc")
    body = json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))
    size = len(body.encode("utf-8"))
    if size > SIZE_MAX:
        print(f"CHYBA: export má {size:,} B (> {SIZE_MAX:,} B) — nezapsáno, zkrať historii v garmin_data.py.")
        return 1
    if size > SIZE_WARN:
        data["warn"] = f"export {size:,} B je nad {SIZE_WARN:,} B — blíží se limit"
        body = json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))

    if not EXPORT_DIR.parent.exists():
        print(f"CHYBA: {EXPORT_DIR.parent} neexistuje — běží Google Drive pro počítače?")
        return 1
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".garmin-data-", suffix=".tmp", dir=str(EXPORT_DIR))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, EXPORT_DIR / EXPORT_FILE)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise

    print(f"[OK] Export {EXPORT_DIR / EXPORT_FILE}: {size:,} B, data za {data.get('date')}, "
          f"{len(data.get('nights') or [])} nocí, {len(data.get('hrv_history') or [])} dní HRV")
    if data.get("warn"):
        print("VAROVÁNÍ: " + data["warn"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
