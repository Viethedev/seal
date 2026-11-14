# Terrain file for the website (`frontend/data/terrain.bin` + `terrain.json`)

From LOLA `LDEM_80S_80MPP_ADJ.TIF` (or 20MPP), downsampled to ~240 m/px (block-average 3×3), covering 80-90°S.

`terrain.bin`: int16 little-endian, heights in metres relative to the 1737.4 km sphere, row-major, row 0 = top. No-data = -32768.

`terrain.json`:
```json
{ "file": "terrain.bin", "pixel_m": 240, "width": 2527, "height": 2527,
  "x0_m": -303240, "y0_m": 303240,          // centre of the top-left pixel, metres
  "x_axis_lon": 90, "y_axis_lon": 0,        // longitude that +x and +y point toward
  "nodata": -32768, "source": "LRO LOLA LDEM_80S_80MPP_ADJ (PGDA product 90)" }
```
Projection: south polar stereographic on a 1737.4 km sphere, ρ = 2R·tan(π/4 + φ/2);
x = ρ·cos(λ − x_axis_lon), y = ρ·cos(λ − y_axis_lon). Columns go +x, rows go −y.
(Check the TIF's own header for its axis directions and set x_axis_lon / y_axis_lon to match.)

Sanity check: the height at Mons Mouton (−84.6°, 31.0°E) should be clearly higher than the land around it (it is a mountain).
