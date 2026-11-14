#!/usr/bin/env python3
"""Fetch Sun and Earth apparent azimuth/elevation from JPL Horizons for a
site on the Moon, and write them to a CSV. Used as the validation
"answer key" (spec test T3) and to test the Horizons HTTP fallback.

Usage:
  python3 horizons_check.py --lat -84.7906 --lon 29.1957 \
      --start 2025-03-06 --stop 2025-04-06 --step 1h --out im2_horizons.csv

Notes:
- Longitude east-positive. Altitude in km above the reference surface (0 = surface).
- Horizons returns apparent az/el; refraction is ignored for non-Earth sites.
- Horizons is a best-effort public service: keep requests small.
"""
import argparse
import csv
import json
import urllib.parse
import urllib.request

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}


def fetch(body_id, lat, lon, alt_km, start, stop, step):
    params = {
        "format": "json",
        "COMMAND": f"'{body_id}'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},{alt_km}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
        "MAKE_EPHEM": "'YES'",
        "OBJ_DATA": "'NO'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as r:
        result = json.load(r)["result"]
    if "$$SOE" not in result:
        raise RuntimeError("Horizons returned no ephemeris:\n" + result[:2000])
    body = result.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in body.strip().splitlines():
        cols = [c.strip() for c in line.split(",")]
        # CSV columns: date, solar-presence flag, lunar-presence flag, azimuth, elevation, ...
        nums = [c for c in cols[1:] if _is_float(c)]
        rows.append((cols[0], float(nums[0]), float(nums[1])))
    return rows


def _is_float(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--alt-km", type=float, default=0.0)
    p.add_argument("--start", required=True)
    p.add_argument("--stop", required=True)
    p.add_argument("--step", default="1h")
    p.add_argument("--out", default="horizons.csv")
    a = p.parse_args()

    sun = fetch(BODIES["sun"], a.lat, a.lon, a.alt_km, a.start, a.stop, a.step)
    earth = fetch(BODIES["earth"], a.lat, a.lon, a.alt_km, a.start, a.stop, a.step)

    with open(a.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time_utc", "sun_az", "sun_el", "earth_az", "earth_el"])
        for (t, saz, sel), (_, eaz, eel) in zip(sun, earth):
            w.writerow([t, saz, sel, eaz, eel])
    print(f"wrote {len(sun)} rows to {a.out}")


if __name__ == "__main__":
    main()
