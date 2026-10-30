"""Sestaví garmin-dashboard.html (jeden soubor, který Apps Script načítá z GitHubu) ze src/shell.html + src/app.js.
Spuštění: python3 tools/build.py   (testy ověřují, že garmin-dashboard.html odpovídá zdrojům)"""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
shell = (ROOT / "src/shell.html").read_text(encoding="utf-8")
app = (ROOT / "src/app.js").read_text(encoding="utf-8")
if shell.count("/*__APP__*/") != 1:
    sys.exit("src/shell.html musí obsahovat právě jeden /*__APP__*/")
if "</script" in app.lower():
    sys.exit("src/app.js nesmí obsahovat </script")
out = shell.replace("/*__APP__*/", "/* sestaveno tools/build.py ze src/app.js — needitovat zde */\n" + app.rstrip() + "\n")
dst = ROOT / "garmin-dashboard.html"
if "--check" in sys.argv:
    sys.exit(0 if dst.exists() and dst.read_text(encoding="utf-8") == out else "garmin-dashboard.html neodpovídá src/ — spusť python3 tools/build.py")
dst.write_text(out, encoding="utf-8")
print(f"garmin-dashboard.html: {len(out):,} znaků")
