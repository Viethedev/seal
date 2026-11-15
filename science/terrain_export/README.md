# Terrain export
Converts NASA's LOLA south-pole DEM (LDEM_80S_80MPP_ADJ.TIF, from https://pgda.gsfc.nasa.gov/products/90) into the 240 m browser grid (terrain.bin + terrain.json).

Setup: pip install rasterio numpy
Run:   python export_terrain.py data\LDEM_80S_80MPP_ADJ.TIF out

AI use: Claude helped write the python exporter
