#!/usr/bin/env python3
"""
Export a browser-sized terrain grid from the LOLA south-pole DEM.

  python export_terrain.py LDEM_80S_80MPP_ADJ.TIF [out_dir] [--factor 3]

Writes:
  terrain.bin   raw int16, little-endian, row-major, row 0 = top, metres
                above the 1737.4 km sphere, nodata = -32768
  terrain.json  metadata (see below)

Needs:  pip install rasterio numpy
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import rasterio

R_MOON_M = 1_737_400.0
NODATA_OUT = -32768


def south_polar_stereo(lat_deg, lon_deg):
    """Same formula as seal_science::south_polar_stereo (metres)."""
    rho = 2 * R_MOON_M * math.tan(math.pi / 4 + math.radians(lat_deg) / 2)
    lon = math.radians(lon_deg)
    return rho * math.sin(lon), rho * math.cos(lon)


def block_average(a, nodata_mask, f):
    """f x f block mean ignoring nodata; all-nodata blocks stay NaN."""
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    a = a[:h, :w].astype(np.float32)
    m = nodata_mask[:h, :w]
    a[m] = np.nan
    blocks = a.reshape(h // f, f, w // f, f)
    valid = np.sum(~np.isnan(blocks), axis=(1, 3))
    total = np.nansum(blocks, axis=(1, 3))
    out = np.full(valid.shape, np.nan, dtype=np.float32)
    ok = valid > 0
    out[ok] = total[ok] / valid[ok]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tif")
    ap.add_argument("out_dir", nargs="?", default=".")
    ap.add_argument("--factor", type=int, default=3, help="block-average factor (3 -> 240 m)")
    args = ap.parse_args()
    f = args.factor
    os.makedirs(args.out_dir, exist_ok=True)

    with rasterio.open(args.tif) as src:
        print("CRS        :", src.crs)
        print("size       :", src.width, "x", src.height)
        print("transform  :", src.transform)
        print("dtype      :", src.dtypes[0], " nodata:", src.nodata)
        print("scales/offs:", src.scales, src.offsets)
        t = src.transform
        if abs(t.b) > 1e-9 or abs(t.d) > 1e-9:
            sys.exit("Rotated geotransform - not handled.")
        if t.e > 0:
            sys.exit("North-up flag unexpected (positive y pixel size).")
        dx, dy = t.a, -t.e  # dy positive: rows go down

        data = src.read(1)
        scale, offset = src.scales[0], src.offsets[0]
        nd = src.nodata

        mask = ~np.isfinite(data.astype(np.float64))
        if nd is not None:
            mask |= data == nd
        vals = data.astype(np.float32) * scale + offset

        # --- block average ---
        avg = block_average(vals, mask, f)
        nanmask = np.isnan(avg)
        out = np.full(avg.shape, NODATA_OUT, dtype="<i2")
        rounded = np.rint(avg[~nanmask])
        if rounded.min() < -32767 or rounded.max() > 32767:
            sys.exit(f"Heights out of int16 range: {rounded.min()}..{rounded.max()} "
                     "(are the file's heights really metres?)")
        out[~nanmask] = rounded.astype("<i2")

        h, w = out.shape
        pix = dx * f
        # centre of the top-left OUTPUT pixel (covers f x f input pixels)
        x0 = t.c + (f * dx) / 2
        y0 = t.f - (f * dy) / 2

        bin_path = os.path.join(args.out_dir, "terrain.bin")
        out.tofile(bin_path)  # little-endian int16, row-major, row 0 = top
        meta = {
            "file": "terrain.bin",
            "pixel_m": pix,
            "width": w,
            "height": h,
            "x0_m": x0,
            "y0_m": y0,
            "x_axis_lon": 90,
            "y_axis_lon": 0,
            "nodata": NODATA_OUT,
        }
        json_path = os.path.join(args.out_dir, "terrain.json")
        with open(json_path, "w") as fh:
            json.dump(meta, fh, indent=2)
        print(f"\nWrote {bin_path} ({os.path.getsize(bin_path)/1e6:.1f} MB), {json_path}")
        print(json.dumps(meta, indent=2))

        # --- checks ---
        def sample_out(x, y):
            c = round((x - x0) / pix)
            r = round((y0 - y) / pix)
            if 0 <= r < h and 0 <= c < w and out[r, c] != NODATA_OUT:
                return int(out[r, c])
            return None

        def sample_src(x, y):
            # nearest pixel of the original file
            c = int((x - t.c) // dx)
            r = int((t.f - y) // dy)
            if 0 <= r < data.shape[0] and 0 <= c < data.shape[1] and not mask[r, c]:
                return float(vals[r, c])
            return None

        print("\nProjection check (SEAL formula, axes: +x=lon 90, +y=lon 0):")
        for name, lat, lon in [("IM-2 site", -84.7906, 29.1957),
                               ("Mons Mouton", -84.6, 31.0),
                               ("Shackleton-ish", -89.9, 129.0)]:
            x, y = south_polar_stereo(lat, lon)
            print(f"  {name:15s} x={x:12.1f} y={y:12.1f}  src={sample_src(x, y)}  out={sample_out(x, y)}")
        print("  -> If these are None, or look wrong, the axes are swapped/flipped;")
        print("     try other lon assignments and report back before sending the file.")

        # Mons Mouton should stand above its surroundings
        x, y = south_polar_stereo(-84.6, 31.0)
        centre = sample_out(x, y)
        ring = []
        for ang in range(0, 360, 15):
            for rad_km in (20, 30, 40):
                px = x + rad_km * 1000 * math.cos(math.radians(ang))
                py = y + rad_km * 1000 * math.sin(math.radians(ang))
                v = sample_out(px, py)
                if v is not None:
                    ring.append(v)
        if centre is not None and ring:
            print(f"\nMons Mouton: {centre} m vs mean of 20-40 km ring {np.mean(ring):.0f} m "
                  f"-> {'OK (higher)' if centre > np.mean(ring) else 'CHECK THIS'}")

        # Global stats
        good = out[out != NODATA_OUT]
        print(f"\nHeights: min {good.min()} m, max {good.max()} m, "
              f"nodata pixels: {(out == NODATA_OUT).sum()}")


if __name__ == "__main__":
    main()
