"""Pilot: Hamburger B-Pläne erkunden und für 3 Testkacheln alles herunterladen.

Läuft in GitHub Actions (dort ist Internet frei). Ergebnis in pilot/daten/.
"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.parse
from collections import Counter
from pyproj import Transformer

API = "https://api.hamburg.de/datasets/v1"
OUT = os.path.join(os.path.dirname(__file__), "daten")
os.makedirs(OUT, exist_ok=True)
to_utm = Transformer.from_crs(4326, 25832, always_xy=True)
to_wgs = Transformer.from_crs(25832, 4326, always_xy=True)

# Testkacheln: Mittelpunkt (lon, lat), Kantenlänge 500 m
KACHELN = {
    "A_StGeorg_Steindamm": (10.0130, 53.5545),
    "B_Eimsbuettel_Osterstrasse": (9.9530, 53.5755),
    "C_Farmsen": (10.1135, 53.6015),
}
SIZE = 500


def get(url, tries=4, timeout=120):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "PlanX24-Pilot"}), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            print("  Fehler", e, url[:120]); time.sleep(5 * (i + 1))
    raise RuntimeError("nicht erreichbar: " + url)


def items(coll, bbox=None, limit=1000):
    feats, url = [], f"{API}/{coll}/items?f=json&limit={limit}" + (f"&bbox={bbox}" if bbox else "")
    while url:
        d = json.loads(get(url))
        feats += d.get("features", [])
        url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
    return feats


def planart(name):
    if name.startswith("TB"): return "Teilbebauungsplan"
    if re.match(r"^D\d", name): return "Durchführungsplan"
    if "Baustufenplan" in name or name.startswith("BS"): return "Baustufenplan"
    return "Bebauungsplan"


# 1) Alle festgestellten Pläne
print("Lade alle Pläne …")
alle = items("bplaene/collections/hh_hh_festgestellt")
json.dump({"type": "FeatureCollection", "features": alle}, open(f"{OUT}/bplaene_alle.geojson", "w"))
arten = Counter(planart(f["properties"]["geltendes_planrecht"]) for f in alle)
jahre = Counter((f["properties"].get("feststellungsdatum") or "????")[:3] + "0er" for f in alle)
stat = {"stand": time.strftime("%Y-%m-%d"), "anzahl": len(alle), "arten": arten, "jahrzehnte": dict(sorted(jahre.items()))}
print(json.dumps(stat, ensure_ascii=False, indent=1))

# 2) Je Kachel: Pläne, ALKIS, Referenz-Rasterplan, PDFs
for name, (lon, lat) in KACHELN.items():
    print("Kachel", name)
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    x, y = to_utm.transform(lon, lat)
    x0, y0, x1, y1 = round(x - SIZE / 2), round(y - SIZE / 2), round(x + SIZE / 2), round(y + SIZE / 2)
    lo0, la0 = to_wgs.transform(x0, y0); lo1, la1 = to_wgs.transform(x1, y1)
    bbox = f"{lo0:.6f},{la0:.6f},{lo1:.6f},{la1:.6f}"
    meta = {"utm_bbox": [x0, y0, x1, y1], "wgs_bbox": bbox}
    plaene = items("bplaene/collections/hh_hh_festgestellt", bbox)
    json.dump({"type": "FeatureCollection", "features": plaene}, open(f"{d}/plaene.geojson", "w"))
    for coll in ["alkis_vereinfacht/collections/Flurstueck", "alkis_vereinfacht/collections/GebaeudeBauwerk"]:
        f = items(coll, bbox)
        json.dump({"type": "FeatureCollection", "features": f}, open(f"{d}/{coll.split('/')[-1]}.geojson", "w"))
    # Referenz: amtlicher Rasterplan der Stadt (0,25 m je Pixel)
    px = int(SIZE / 0.25)
    wms = ("https://geodienste.hamburg.de/HH_WMS_Cache_Rasterplan?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=bp_raster&STYLES="
           f"&CRS=EPSG:25832&BBOX={x0},{y0},{x1},{y1}&WIDTH={px}&HEIGHT={px}&FORMAT=image/png")
    try:
        open(f"{d}/referenz_rasterplan.png", "wb").write(get(wms))
        open(f"{d}/referenz_rasterplan.pgw", "w").write(f"0.25\n0\n0\n-0.25\n{x0 + 0.125}\n{y1 - 0.125}\n")
    except Exception as e:
        meta["referenz_fehler"] = str(e)
    meta["plaene"] = []
    for p in plaene:
        pr = p["properties"]; pn = pr["geltendes_planrecht"]
        info = {"name": pn, "art": planart(pn), "datum": pr.get("feststellungsdatum"), "pdf": pr.get("planrecht")}
        try:
            pdf = get(pr["planrecht"], timeout=300)
            info["pdf_mb"] = round(len(pdf) / 1e6, 1)
            if len(pdf) < 45e6:
                open(f"{d}/{pn}.pdf", "wb").write(pdf)
            # Seitenbilder zum Ansehen (100 dpi)
            open("/tmp/p.pdf", "wb").write(pdf)
            subprocess.run(["pdftoppm", "-r", "60", "-png", "/tmp/p.pdf", f"{d}/{pn}_seite"], check=False, timeout=600)
            info["seiten"] = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", "/tmp/p.pdf"], capture_output=True, text=True).stdout).group(1))
            info["seite1"] = subprocess.run(["pdfinfo", "-f", "1", "-l", "3", "/tmp/p.pdf"], capture_output=True, text=True).stdout[-600:]
        except Exception as e:
            info["fehler"] = str(e)
        meta["plaene"].append(info)
        print("  ", info.get("name"), info.get("pdf_mb"), info.get("seiten"), info.get("fehler", ""))
    json.dump(meta, open(f"{d}/kachel.json", "w"), ensure_ascii=False, indent=1)
    stat.setdefault("kacheln", {})[name] = {"plaene": len(plaene), "namen": [p["name"] for p in meta["plaene"]]}

json.dump(stat, open(f"{OUT}/statistik.json", "w"), ensure_ascii=False, indent=1, default=dict)
print("fertig")
