"""
Test volitelného offline režimu bez osobních dat: syntetická garmin.db se stejnými tabulkami a sloupci,
které čte garmin_data.py → load_data() (tvar dat = stejný jako výstup Apps Scriptu buildData_). Spuštění: python tests/test_local.py
Volitelně zapíše vzorová data pro test dashboardu: python tests/test_local.py --sample tests/out/sample.json
"""
import json, os, sqlite3, subprocess, sys, tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / "local"

SCHEMA = {
    "daily_summary": "calendar_date TEXT, total_steps INT, resting_heart_rate INT, avg_resting_heart_rate_7day INT, average_stress_level INT, max_stress_level INT, body_battery_highest INT, body_battery_lowest INT, body_battery_most_recent INT, body_battery_at_wake INT, body_battery_during_sleep INT, avg_waking_respiration REAL, total_kilocalories INT, active_kilocalories INT",
    "hrv": "calendar_date TEXT, weekly_avg INT, last_night_avg INT, last_night_5min_high INT, status TEXT, baseline_low INT, baseline_upper INT",
    "sleep": "calendar_date TEXT, sleep_time_seconds INT, deep_sleep_seconds INT, light_sleep_seconds INT, rem_sleep_seconds INT, awake_sleep_seconds INT, average_hr_sleep REAL, resting_heart_rate INT, average_respiration REAL, avg_sleep_stress REAL, body_battery_change INT, sleep_score_overall INT, sleep_score_feedback TEXT, sleep_score_insight TEXT",
    "training_readiness": "calendar_date TEXT, score INT, level TEXT, hrv_factor_percent INT, hrv_factor_feedback TEXT, hrv_weekly_average INT, sleep_history_factor_percent INT, stress_history_factor_percent INT, recovery_time_factor_percent INT, acwr_factor_percent INT, feedback_short TEXT, feedback_long TEXT",
    "training_status": "calendar_date TEXT, training_status TEXT, acute_load INT, chronic_load INT",
    "fitness_age": "calendar_date TEXT, chronological_age INT, fitness_age REAL",
    "activity": "start_time_local TEXT, activity_name TEXT, activity_type TEXT, elapsed_time REAL, distance REAL, avg_hr INT, training_load_value REAL",
}


def make_db(path, days=260):
    c = sqlite3.connect(path)
    for t, cols in SCHEMA.items():
        c.execute(f"CREATE TABLE {t} ({cols})")
    today = date.today()
    for i in range(days):
        d = (today - timedelta(days=days - 1 - i)).isoformat()
        w = i % 7
        c.execute("INSERT INTO daily_summary VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (d, 8000 + w * 300, 52 + w % 3, 53, 30 + w, 80, 90 - w, 20 + w, 60, 55 + w * 3, 40, 14.5, 2400, 500))
        c.execute("INSERT INTO hrv VALUES (?,?,?,?,?,?,?)", (d, 30, 26 + w, 40, "BALANCED", 24, 36))
        c.execute("INSERT INTO sleep VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (d, 7 * 3600 + w * 600, 80 * 60, 220 * 60, 90 * 60, 20 * 60, 54, 51, 14.2, 18 + w, 40, 70 + w, "POSITIVE", "ok"))
        c.execute("INSERT INTO training_readiness VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (d, 60 + w * 4, "MODERATE", 80, "GOOD", 30, 70, 75, 90, 85, "ok", "ok"))
        c.execute("INSERT INTO training_status VALUES (?,?,?,?)", (d, "PRODUCTIVE", 300, 280))
        c.execute("INSERT INTO fitness_age VALUES (?,?,?)", (d, 50, 44.5))
    c.execute("INSERT INTO activity VALUES (?,?,?,?,?,?,?)",
              (today.isoformat() + " 07:00:00", "Běh", "running", 3600, 10000, 145, 120))
    c.commit(); c.close()


def main():
    sample = sys.argv[sys.argv.index("--sample") + 1] if "--sample" in sys.argv else None
    fails = 0
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "garmin.db"; make_db(db)
        env = dict(os.environ, GARMIN_DB=str(db), PYTHONUTF8="1")

        # 1) load_data: obsah a tvar
        code = "import json,garmin_data;print(json.dumps(garmin_data.load_data(),default=str))"
        r = subprocess.run([sys.executable, "-c", code], cwd=LOCAL, env=env, capture_output=True, text=True)
        d = json.loads(r.stdout)
        checks = [
            ("bez chyby", not d.get("error")),
            ("verze dat", d.get("v") == 1),
            ("noci za 200 dni", 195 <= len(d["nights"]) <= 201),
            ("cela historie HRV", len(d["hrv_history"]) == 260),
            ("posledni aktivita (driv neuzavrene spojeni)", d["last_activity"].get("activity_name") == "Běh"),
            ("readiness", d["readiness"].get("score") is not None),
            ("label noci", d["nights"][-1]["label"].endswith(".")),
        ]
        if sample:
            Path(sample).parent.mkdir(parents=True, exist_ok=True)
            Path(sample).write_text(json.dumps(d, ensure_ascii=False, default=str), encoding="utf-8")
    for name, ok in checks:
        print(("OK   " if ok else "FAIL ") + name)
        fails += 0 if ok else 1
    if fails:
        print(r.stderr[-2000:])
    print(f"{len(checks) - fails}/{len(checks)} OK")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
