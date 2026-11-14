#!/usr/bin/env python3
"""
SEAL: rebuild the Sun and Earth table (frontend/data/ephemeris.json) from NASA JPL Horizons,
and check the table against fresh Horizons answers for real landing sites.

Only the Python standard library is needed.

    python build_ephemeris.py build      # downloads 2025 to 2028, writes ephemeris.json next to this file
    python build_ephemeris.py validate   # compares the table + SEAL's maths with Horizons for real sites

How the table is made
1. Ask Horizons where the Sun (10) and Earth (399) appear from a point on the Moon
   (lat -85, lon 0, height 0, Moon ME frame): apparent azimuth, elevation and distance, no atmosphere,
   every 6 hours from 2025-01-01 to 2029-01-01.
2. Turn each (azimuth, elevation, distance) into an x, y, z vector from the Moon's centre, in km,
   in the Moon-fixed frame. A vector from the centre works for every site on the Moon, which is how
   the website can analyse any latitude and longitude from one table.
3. Store the vectors as whole numbers (Sun in km, Earth in 0.01 km), each one as the difference
   from the previous step, so the file stays small (about 260 KB).

The website reads the table and interpolates between the 6 hour steps (cubic Lagrange, frontend/engine.js).
"""
import json, math, sys, urllib.parse, urllib.request, random
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
R_KM = 1737.4                 # Moon radius used by SEAL (same as LOLA)
AU_KM = 149597870.7
D = math.pi / 180
BASE_SITE = (-85.0, 0.0)      # lat, lon of the observing point used to build the table
START, STOP, STEP_H = "2025-01-01 00:00", "2029-01-01 00:00", 6
SUN_SCALE, EARTH_SCALE = 1, 100
HERE = Path(__file__).resolve().parent


def horizons(body, lat, lon, start, stop, step):
    """Apparent az/el (deg) and distance (km) of a body seen from a point on the Moon."""
    q = {
        "format": "json", "COMMAND": f"'{body}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},0'", "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'", "QUANTITIES": "'4,20'", "APPARENT": "'AIRLESS'",
        "ANG_FORMAT": "'DEG'", "CSV_FORMAT": "'YES'", "TIME_DIGITS": "'MINUTES'", "EXTRA_PREC": "'YES'",
    }
    url = API + "?" + urllib.parse.urlencode(q, safe="'@,:")
    with urllib.request.urlopen(url, timeout=120) as r:
        text = json.load(r)["result"]
    if "$$SOE" not in text:
        raise RuntimeError("Horizons did not return a table:\n" + text[:2000])
    rows = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        # columns: date, solar flag, lunar flag, azimuth, elevation, delta (AU), deldot (km/s)
        nums = [x for x in f[1:] if x and _isnum(x)]
        az, el, delta_au = float(nums[0]), float(nums[1]), float(nums[2])
        rows.append((f[0], az, el, delta_au * AU_KM))
    return rows


def _isnum(x):
    try:
        float(x); return True
    except ValueError:
        return False


def frame(lat, lon):
    la, lo = lat * D, lon * D
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    e = (-math.sin(lo), math.cos(lo), 0.0)
    n = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    return tuple(R_KM * u for u in up), up, e, n


def to_vector(lat, lon, az, el, dist):
    """Horizons az is measured from north towards east. Returns the body's position from the Moon's centre (km)."""
    s, up, e, n = frame(lat, lon)
    a, h = az * D, el * D
    d = (math.cos(h) * math.sin(a), math.cos(h) * math.cos(a), math.sin(h))  # east, north, up
    return tuple(s[k] + dist * (d[0] * e[k] + d[1] * n[k] + d[2] * up[k]) for k in range(3))


def az_el(lat, lon, v):
    s, up, e, n = frame(lat, lon)
    r = [v[k] - s[k] for k in range(3)]
    z, ee, nn = sum(r[k] * up[k] for k in range(3)), sum(r[k] * e[k] for k in range(3)), sum(r[k] * n[k] for k in range(3))
    return (math.atan2(ee, nn) / D) % 360, math.atan2(z, math.hypot(ee, nn)) / D


def encode(vectors, scale):
    out, prev = [], [0, 0, 0]
    for v in vectors:
        q = [round(c * scale) for c in v]
        out += [q[k] - prev[k] for k in range(3)]
        prev = q
    return out


def decode(arr, scale):
    out, p = [], [0, 0, 0]
    for i in range(0, len(arr), 3):
        p = [p[k] + arr[i + k] for k in range(3)]
        out.append(tuple(c / scale for c in p))
    return out


def build(path=HERE / "ephemeris.json"):
    lat, lon = BASE_SITE
    vec = {}
    for name, body in (("sun", 10), ("earth", 399)):
        rows = horizons(body, lat, lon, START, STOP, f"{STEP_H} h")
        vec[name] = [to_vector(lat, lon, az, el, d) for _, az, el, d in rows]
        print(f"{name}: {len(rows)} rows, {rows[0][0]} to {rows[-1][0]}")
    n = len(vec["sun"])
    assert n == len(vec["earth"]), "Sun and Earth tables have different lengths"
    j = {
        "source": "NASA JPL Horizons API (DE441), airless apparent az/el from site (-85,0) converted to Moon-fixed (MEAN_ME) vectors, km",
        "t0": START.replace(" ", "T") + ":00Z", "step_hours": STEP_H, "n": n,
        "sun_scale": SUN_SCALE, "earth_scale": EARTH_SCALE,
        "sun": encode(vec["sun"], SUN_SCALE), "earth": encode(vec["earth"], EARTH_SCALE),
    }
    path.write_text(json.dumps(j, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


def interp(table, t0, step_s, t):
    """Same cubic Lagrange interpolation as frontend/engine.js."""
    x = (t - t0) / step_s
    i = max(0, min(len(table) - 4, math.floor(x) - 1))
    u = x - i
    L = [(u - 1) * (u - 2) * (u - 3) / -6, u * (u - 2) * (u - 3) / 2, u * (u - 1) * (u - 3) / -2, u * (u - 1) * (u - 2) / 6]
    return tuple(sum(L[j] * table[i + j][k] for j in range(4)) for k in range(3))


def validate(path=HERE.parent.parent / "frontend" / "data" / "ephemeris.json", per_site=20):
    from datetime import datetime, timezone
    j = json.loads(Path(path).read_text())
    t0 = datetime.fromisoformat(j["t0"].replace("Z", "+00:00")).timestamp()
    step = j["step_hours"] * 3600
    tab = {"sun": decode(j["sun"], j["sun_scale"]), "earth": decode(j["earth"], j["earth_scale"])}
    sites = {"IM-2 (Mons Mouton)": (-84.7906, 29.1957), "Haworth": (-86.726, -21.639), "de Gerlache Rim 2": (-88.328, -69.896),
             "Apollo 11": (0.67408, 23.47297), "Chang'e 4 (far side)": (-45.4446, 177.5991)}
    random.seed(1)
    worst = 0.0
    for name, (lat, lon) in sites.items():
        # random minutes inside the table, away from the very ends
        day = random.randint(30, 1400)
        start = datetime.fromtimestamp(t0 + day * 86400, timezone.utc).strftime("%Y-%m-%d %H:%M")
        stop = datetime.fromtimestamp(t0 + (day + 20) * 86400, timezone.utc).strftime("%Y-%m-%d %H:%M")
        for body_name, body in (("sun", 10), ("earth", 399)):
            rows = horizons(body, lat, lon, start, stop, "17 h")[:per_site]
            err = 0.0
            for date, az, el, _ in rows:
                t = datetime.strptime(date, "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()
                a2, e2 = az_el(lat, lon, interp(tab[body_name], t0, step, t))
                # angle between the two directions on the sky
                c = math.sin(el * D) * math.sin(e2 * D) + math.cos(el * D) * math.cos(e2 * D) * math.cos((az - a2) * D)
                err = max(err, math.acos(max(-1, min(1, c))) / D)
            worst = max(worst, err)
            print(f"{name:24s} {body_name:5s} worst error {err:.6f} deg over {len(rows)} times")
    print(f"overall worst {worst:.6f} deg")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build()
    elif cmd == "validate":
        validate()
    else:
        print(__doc__)
