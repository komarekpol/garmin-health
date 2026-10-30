r"""
Garmin Local Server
===================
Čte data z garmin.db (garmin_data.py) a servíruje je jako JSON na localhost:8765.
Dashboard běží hlavně z Google Apps Scriptu (data z Disku); lokální server zůstává pro práci offline
a pro tlačítko „Sync Garmin“ na tomto PC.
Spouštěj přes Start Garmin Dashboard.bat nebo přímo:
  C:\Python314\python.exe garmin_server.py
"""

import json, os, sys, tempfile, threading, webbrowser, subprocess
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from garmin_data import DB_PATH, load_data
from garmin_export import EXPORT_DIR

# Prahy a zóny dashboardu: stejný soubor, který čte a zapisuje Apps Script (Disk je synchronizuje) → stejné na všech zařízeních
SETTINGS_PATH = EXPORT_DIR / "garmin-settings.json"
SETTINGS_KEYS = ("garmin_thresholds", "garmin_vst_zones", "garmin_hr_zones", "garmin_bb_zones", "garmin_resp_zones")
SETTINGS_MAX = 50_000


def settings_read():
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def settings_write(inp):
    cur = settings_read()
    for k in SETTINGS_KEYS:
        if k in inp:
            if inp[k] is None: cur.pop(k, None)
            else: cur[k] = str(inp[k])[:10_000]
    cur["_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".garmin-settings-", suffix=".tmp", dir=str(SETTINGS_PATH.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(cur, ensure_ascii=False))
    os.replace(tmp, SETTINGS_PATH)
    return cur["_at"]

HERE = Path(__file__).parent
DASHBOARD_PATH = HERE / "garmin-dashboard.html"
PORT = 8765


def run_sync():
    # stažení nových dat z Garmin Connect a hned export na Disk (ať je mají i ostatní zařízení)
    subprocess.run([sys.executable, "-m", "garmin_givemydata"], capture_output=True)
    subprocess.run([sys.executable, str(HERE / "garmin_export.py")], capture_output=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/settings":
            self.send_response(404); self.end_headers(); return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > SETTINGS_MAX:
                raise ValueError(f"nastavení je větší než {SETTINGS_MAX} znaků")
            inp = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            if not isinstance(inp, dict):
                raise ValueError("čekám objekt")
            self.send_json({"ok": True, "at": settings_write(inp)})
        except Exception as e:
            self.send_json({"ok": False, "error": str(e)})

    def do_GET(self):
        if self.path == "/settings":
            self.send_json(settings_read())

        elif self.path == "/data":
            data = load_data()
            body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_cors()
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/sync":
            threading.Thread(target=run_sync, daemon=True).start()
            body = json.dumps({"status": "sync_started"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors()
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/ping":
            self.send_response(200)
            self.send_cors()
            self.end_headers()
            self.wfile.write(b"ok")

        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    if not DB_PATH.exists():
        print(f"CHYBA: Databaze nenalezena na {DB_PATH}")
        print("Spust nejdrive: C:\\Python314\\python.exe -m garmin_givemydata")
        input("Stiskni Enter pro zavreni...")
        sys.exit(1)

    print(f"[OK] Garmin databaze: {DB_PATH}")
    print(f"[OK] Server spusten na http://localhost:{PORT}")
    print(f"[OK] Otviram dashboard v prohlizeci...")
    print()
    print("  Toto okno nechej otevrene. Zavri ho az skoncis s dashboardem.")

    def open_browser():
        import time; time.sleep(0.8)
        webbrowser.open(DASHBOARD_PATH.resolve().as_uri())

    threading.Thread(target=open_browser, daemon=True).start()

    server = HTTPServer(("localhost", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer zastaven.")
