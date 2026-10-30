r"""
Garmin data — sdílené dotazy nad garmin.db
==========================================
Jediný zdroj pravdy pro obsah dat dashboardu. Používá ho:
  - garmin_server.py  (lokální server http://localhost:8765/data)
  - garmin_export.py  (export na Google Disk -> Apps Script -> dashboard na všech zařízeních)
Databázi plní balíček garmin_givemydata (C:\Python314\python.exe -m garmin_givemydata).
"""

import sqlite3, json, os
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(os.environ.get("GARMIN_DB") or (Path.home() / ".garmin-givemydata" / "garmin.db"))
DATA_VERSION = 1

def get_conn():
    # jen pro čtení — export a server nikdy nezamknou databázi pro zápis garmin_givemydata
    conn = sqlite3.connect(DB_PATH.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn

def fetch_one(conn, sql, params=()):
    try:
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else {}
    except Exception as e:
        return {}

def fetch_all(conn, sql, params=()):
    try:
        cur = conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        return []

def load_data():
    if not DB_PATH.exists():
        return {"error": f"Databaze nenalezena: {DB_PATH}"}

    conn = get_conn()
    days_30 = (datetime.now() - timedelta(days=31)).date().isoformat()

    try:
        # daily_summary - spravne nazvy sloupcu
        daily = fetch_one(conn, """
            SELECT calendar_date, total_steps, resting_heart_rate,
                   avg_resting_heart_rate_7day,
                   average_stress_level, max_stress_level,
                   body_battery_highest, body_battery_lowest,
                   body_battery_most_recent, body_battery_at_wake,
                   body_battery_during_sleep,
                   avg_waking_respiration,
                   total_kilocalories, active_kilocalories
            FROM daily_summary
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # HRV - spravne nazvy sloupcu
        hrv = fetch_one(conn, """
            SELECT calendar_date, weekly_avg, last_night_avg,
                   last_night_5min_high, status,
                   baseline_low, baseline_upper
            FROM hrv
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # Sleep - spravne nazvy sloupcu
        sleep_latest = fetch_one(conn, """
            SELECT calendar_date,
                   ROUND(sleep_time_seconds / 3600.0, 2) AS sleep_hours,
                   deep_sleep_seconds / 60 AS deep_min,
                   light_sleep_seconds / 60 AS light_min,
                   rem_sleep_seconds / 60 AS rem_min,
                   awake_sleep_seconds / 60 AS awake_min,
                   average_hr_sleep, resting_heart_rate,
                   average_respiration, avg_sleep_stress,
                   body_battery_change, sleep_score_overall,
                   sleep_score_feedback, sleep_score_insight
            FROM sleep
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # Training readiness - spravne nazvy sloupcu
        readiness = fetch_one(conn, """
            SELECT calendar_date, score, level,
                   hrv_factor_percent, hrv_factor_feedback,
                   hrv_weekly_average,
                   sleep_history_factor_percent,
                   stress_history_factor_percent,
                   recovery_time_factor_percent,
                   acwr_factor_percent,
                   feedback_short, feedback_long
            FROM training_readiness
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # Training status
        train_status = fetch_one(conn, """
            SELECT calendar_date, training_status,
                   acute_load, chronic_load
            FROM training_status
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # Fitness vek
        fitness = fetch_one(conn, """
            SELECT calendar_date, chronological_age, fitness_age
            FROM fitness_age
            ORDER BY calendar_date DESC LIMIT 1
        """)

        # Spánek 200 dni pro grafy (vsechny zalozky)
        nights = fetch_all(conn, """
            SELECT s.calendar_date,
                   s.calendar_date AS date,
                   ROUND(s.sleep_time_seconds / 3600.0, 2) AS hours,
                   s.sleep_score_overall AS score,
                   s.resting_heart_rate AS hr,
                   d.body_battery_at_wake AS bb,
                   s.body_battery_change AS bb_change,
                   s.avg_sleep_stress AS stress,
                   s.average_respiration AS resp,
                   h.last_night_avg AS hrv,
                   ROUND(s.deep_sleep_seconds / 60.0) AS deep_min,
                   ROUND(s.rem_sleep_seconds / 60.0) AS rem_min,
                   ROUND(s.light_sleep_seconds / 60.0) AS light_min,
                   ROUND(s.awake_sleep_seconds / 60.0) AS awake_min
            FROM sleep s
            LEFT JOIN hrv h ON s.calendar_date = h.calendar_date
            LEFT JOIN daily_summary d ON s.calendar_date = d.calendar_date
            WHERE s.calendar_date >= date('now', '-200 days')
            ORDER BY s.calendar_date ASC
        """)

        # HRV celá historie pro VST záložku
        hrv_history_raw = fetch_all(conn, """
            SELECT h.calendar_date,
                   h.last_night_avg AS hrv,
                   h.weekly_avg AS avg7,
                   h.status,
                   h.baseline_low,
                   h.baseline_upper
            FROM hrv h
            WHERE h.last_night_avg IS NOT NULL
            ORDER BY h.calendar_date ASC
        """)

        # Posledni aktivita (drive novym spojenim, ktere se nezaviralo)
        last_activity = fetch_one(conn, """
            SELECT start_time_local, activity_name, activity_type,
                   ROUND(elapsed_time / 60.0, 1) AS duration_min,
                   ROUND(distance / 1000.0, 2) AS distance_km,
                   avg_hr, training_load_value
            FROM activity
            ORDER BY start_time_local DESC LIMIT 1
        """)

        conn.close()

        def fmt_label(d):
            if not d: return ""
            try:
                dt = datetime.strptime(d[:10], "%Y-%m-%d")
                return f"{dt.day}.{dt.month}."
            except:
                return d

        for n in nights:
            cd = n.get("calendar_date", "")
            n["date"] = cd[:10] if cd else ""
            n["label"] = fmt_label(cd)
            # bb is already body_battery_at_wake from query

        # Format HRV history labels
        hrv_history = []
        for r2 in hrv_history_raw:
            d = r2.get("calendar_date", "")
            hrv_history.append({
                "date": d[:10] if d else "",
                "label": fmt_label(d),
                "hrv": r2.get("hrv"),
                "avg7": r2.get("avg7"),
                "status": r2.get("status"),
                "baseline_low": r2.get("baseline_low"),
                "baseline_upper": r2.get("baseline_upper"),
            })

        return {
            "v": DATA_VERSION,
            "updated_at": datetime.now().strftime("%H:%M:%S"),
            "date": daily.get("calendar_date", datetime.now().date().isoformat()),
            "daily": daily,
            "hrv": hrv,
            "sleep_latest": sleep_latest,
            "readiness": readiness,
            "training_status": train_status,
            "fitness": fitness,
            "nights": nights,
            "hrv_history": hrv_history,
            "last_activity": last_activity,
        }

    except Exception as e:
        try: conn.close()
        except: pass
        return {"error": str(e)}

