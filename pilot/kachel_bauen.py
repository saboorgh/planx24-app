"""Pilot: eine Kachel des Rasterplans selbst bauen.

Für jeden B-Plan der Kachel:
  1. Planseite finden (größte Seite des PDFs)
  2. Maßstab (1:1000 / 1:2000 / 1:2500 / 1:5000) und Lage automatisch suchen (Abgleich mit ALKIS)
  3. auf den Geltungsbereich zuschneiden
Dann alle Pläne nach Datum stapeln (jüngster oben) und zu einer Kachel zusammensetzen.
Messung: Versatz jedes Plans zum amtlichen Hamburger Rasterplan.

Aufruf: python3 kachel_bauen.py <kachelordner>
Ergebnis: <kachelordner>/ergebnis/ (Kachel, Einzelpläne, bericht.json)
"""
import glob, json, os, subprocess, sys, time
import numpy as np, cv2
from PIL import Image, ImageDraw
from pyproj import Transformer

kd = sys.argv[1]
OUT = os.path.join(kd, "ergebnis"); os.makedirs(OUT, exist_ok=True)
RES = 0.2
meta = json.load(open(f"{kd}/kachel.json"))
x0, y0, x1, y1 = meta["utm_bbox"]
W, H = int((x1 - x0) / RES), int((y1 - y0) / RES)
tr = Transformer.from_crs(4326, 25832, always_xy=True)
px = lambda x, y: ((x - x0) / RES, (y1 - y) / RES)


def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        for ring in poly:
            yield [px(*tr.transform(lo, la)) for lo, la in ring]


# ALKIS-Strichbild (Flurstücke + Gebäude) und Abstandskarte
alk = Image.new("L", (W, H), 255); dr = ImageDraw.Draw(alk)
for fn in ["Flurstueck", "GebaeudeBauwerk"]:
    for f in json.load(open(f"{kd}/{fn}.geojson"))["features"]:
        for r in rings(f["geometry"]): dr.line(r + [r[0]], fill=0, width=2)
alk = np.array(alk)
ae = cv2.GaussianBlur((alk < 128).astype(np.float32) * 255, (0, 0), 2.5)
ref = cv2.resize(cv2.imread(f"{kd}/referenz_rasterplan.png", cv2.IMREAD_COLOR), (W, H))
refg = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
plaene = {f["properties"]["geltendes_planrecht"]: f for f in json.load(open(f"{kd}/plaene.geojson"))["features"]}


def planseite(pdf):
    info = subprocess.run(["pdfinfo", "-f", "1", "-l", "99", pdf], capture_output=True, text=True).stdout
    best, page = 0, 1
    for line in info.splitlines():
        if line.startswith("Page") and "size:" in line:
            n = int(line.split()[1]); w, h = float(line.split()[3]), float(line.split()[5])
            if w * h > best: best, page = w * h, n
    return page


def render(pdf, page, dpi, gray=True):
    for f in glob.glob(f"/tmp/r{os.getpid()}-*.png"): os.remove(f)
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page)] + (["-gray"] if gray else []) + ["-png", pdf, f"/tmp/r{os.getpid()}"], check=True)
    return cv2.imread(glob.glob(f"/tmp/r{os.getpid()}-*.png")[0], 0 if gray else cv2.IMREAD_COLOR)


def suche(scan, box, scales, rots, F):
    se = cv2.GaussianBlur((scan < 110).astype(np.float32) * 255, (0, 0), 2.5)
    ses = cv2.resize(se, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
    bx0, by0, bx1, by1 = box; cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2; hx, hy = (bx1 - bx0) // 2, (by1 - by0) // 2
    best = (-1, 1, 0, (0, 0))
    for sc in scales:
        for rot in rots:
            R = cv2.getRotationMatrix2D((cx, cy), rot, sc)
            t = cv2.warpAffine(ae, R, (W, H))[int(cy - hy):int(cy + hy), int(cx - hx):int(cx + hx)]
            ts = cv2.resize(t, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
            if ts.shape[0] >= ses.shape[0] or ts.shape[1] >= ses.shape[1] or ts.std() == 0: continue
            r = cv2.matchTemplate(ses, ts, cv2.TM_CCOEFF_NORMED)
            _, v, _, loc = cv2.minMaxLoc(r)
            if v > best[0]: best = (v, sc, rot, loc)
    v, sc, rot, loc = best
    R = np.vstack([cv2.getRotationMatrix2D((cx, cy), rot, sc), [0, 0, 1]])
    T = np.array([[1, 0, loc[0] * F - int(cx - hx)], [0, 1, loc[1] * F - int(cy - hy)], [0, 0, 1]])
    return v, sc, rot, np.linalg.inv(T @ R)[:2]


bericht = {"kachel": os.path.basename(kd.rstrip("/")), "stand": time.strftime("%Y-%m-%d %H:%M"), "plaene": []}
schichten = []
for pi in sorted(meta["plaene"], key=lambda p: p.get("datum") or ""):
    name = pi["name"]; t0 = time.time(); e = {"name": name, "art": pi["art"], "datum": pi.get("datum")}
    pdf = f"{kd}/{name}.pdf"
    try:
        if not os.path.exists(pdf): raise RuntimeError("PDF fehlt (zu groß)")
        gb = plaene[name]
        mask = Image.new("L", (W, H), 0); md = ImageDraw.Draw(mask)
        pts = []
        for r in rings(gb["geometry"]): md.polygon(r, fill=255); pts += r
        mask = np.array(mask) > 0
        e["anteil_in_kachel"] = round(float(mask.mean()), 3)
        if mask.sum() < 500: raise RuntimeError("liegt kaum in der Kachel")
        pts = np.array(pts); m = 80 / RES
        box = (*np.maximum(pts.min(0) - m, 0).astype(int), *np.minimum(pts.max(0) + m, [W, H]).astype(int))
        page = planseite(pdf); e["seite"] = page
        # Maßstab erraten: für jeden Kandidaten passend rendern und grob suchen
        best = None
        for mst in [1000, 2000, 2500, 5000]:
            dpi = max(15, round(25.4 / RES * 1000 / mst))
            scan = render(pdf, page, dpi)
            if scan.shape[0] * scan.shape[1] > 60e6: continue
            r = suche(scan, box, np.arange(0.92, 1.081, 0.02), np.arange(-8, 8.1, 1.0), 4)
            if best is None or r[0] > best[0]: best = (*r, mst, dpi, scan)
        v, sc, rot, M, mst, dpi, scan = best
        # Stufe 2: fein um den besten Wert
        v2, sc2, rot2, M2 = suche(scan, box, np.arange(sc - 0.03, sc + 0.031, 0.005), np.arange(rot - 1.5, rot + 1.6, 0.25), 2)
        if v2 > v: v, sc, rot, M = v2, sc2, rot2, M2
        e.update({"massstab": f"1:{mst}", "korrelation": round(float(v), 3), "faktor": round(float(sc), 4), "drehung_grad": round(float(rot), 2)})
        farbe = render(pdf, page, dpi, gray=False)
        warp = cv2.warpAffine(farbe, M.astype(np.float32), (W, H), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
        # Messung gegen den amtlichen Rasterplan (nur im Geltungsbereich)
        bx0, by0, bx1, by1 = box
        a = np.where(mask, refg, 255)[by0:by1, bx0:bx1].astype(np.float32)
        b = np.where(mask, cv2.cvtColor(warp, cv2.COLOR_BGR2GRAY), 255)[by0:by1, bx0:bx1].astype(np.float32)
        (dx, dy), resp = cv2.phaseCorrelate(cv2.GaussianBlur(a, (0, 0), 1.5), cv2.GaussianBlur(b, (0, 0), 1.5))
        e.update({"versatz_m": round(float(np.hypot(dx, dy) * RES), 2), "versatz_sicherheit": round(float(resp), 2)})
        e["ampel"] = "grün" if e["versatz_m"] < 1.5 and resp > 0.15 else ("gelb" if e["versatz_m"] < 4 else "rot")
        cv2.imwrite(f"{OUT}/{name}.png", np.dstack([warp, (mask * 255).astype(np.uint8)])[:, :, [0, 1, 2, 3]])
        schichten.append((warp, mask))
    except Exception as ex:
        e["fehler"] = str(ex); e["ampel"] = "rot"
    e["sekunden"] = round(time.time() - t0, 1)
    print(json.dumps(e, ensure_ascii=False)); bericht["plaene"].append(e)

# Zusammensetzen: ältere zuerst, jüngere darüber
kachel = np.full((H, W, 3), 255, np.uint8); belegt = np.zeros((H, W), bool)
for warp, mask in schichten:
    kachel[mask] = warp[mask]; belegt |= mask
cv2.imwrite(f"{OUT}/kachel.jpg", kachel, [cv2.IMWRITE_JPEG_QUALITY, 85])
open(f"{OUT}/kachel.jgw", "w").write(f"{RES}\n0\n0\n{-RES}\n{x0 + RES / 2}\n{y1 - RES / 2}\n")
cv2.imwrite(f"{OUT}/vergleich.jpg", cv2.resize(np.hstack([kachel, ref]), (W, H // 2)), [cv2.IMWRITE_JPEG_QUALITY, 80])
bericht["abdeckung"] = round(float(belegt.mean()), 3)
json.dump(bericht, open(f"{OUT}/bericht.json", "w"), ensure_ascii=False, indent=1)
print("Abdeckung", bericht["abdeckung"])
