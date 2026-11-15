#!/usr/bin/env python3
"""Compare SEAL's Sun/Earth table (frontend/data/ephemeris.json) with the JPL Horizons answer keys in docs/validation/.
Uses the same interpolation and az/el maths as the website. Standard library only.

    python scripts/validate_answer_keys.py
"""
import sys, json, math
from pathlib import Path
from datetime import datetime, timezone
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "science" / "ephemeris"))
import build_ephemeris as B

KEYS = [("im2_horizons_6h", -84.7906, 29.1957), ("haworth_horizons_12h", -86.72621, 338.36131), ("nobile_rim_1_horizons_12h", -85.45638, 36.36065)]
D = math.pi / 180
j = json.loads((ROOT / "frontend" / "data" / "ephemeris.json").read_text())
t0 = datetime.fromisoformat(j["t0"].replace("Z", "+00:00")).timestamp()
tab = {"sun": B.decode(j["sun"], j["sun_scale"]), "earth": B.decode(j["earth"], j["earth_scale"])}

def sep(a1, e1, a2, e2):
    c = math.sin(e1 * D) * math.sin(e2 * D) + math.cos(e1 * D) * math.cos(e2 * D) * math.cos((a1 - a2) * D)
    return math.acos(max(-1, min(1, c))) / D

for name, lat, lon in KEYS:
    rows = [r for r in (ROOT / "docs" / "validation" / f"{name}.csv").read_text().splitlines() if r[:1].isdigit()]
    worst = {"sun": 0.0, "earth": 0.0}
    for r in rows:
        t, sa, se, ea, ee = r.split(",")
        tt = datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp()
        for body, (a, e) in (("sun", (float(sa), float(se))), ("earth", (float(ea), float(ee)))):
            a2, e2 = B.az_el(lat, lon, B.interp(tab[body], t0, j["step_hours"] * 3600, tt))
            worst[body] = max(worst[body], sep(a, e, a2, e2))
    print(f"{name:28s} {len(rows)} times {rows[0][:10]} to {rows[-1][:10]}  worst: Sun {worst['sun']:.7f} deg, Earth {worst['earth']:.7f} deg")
