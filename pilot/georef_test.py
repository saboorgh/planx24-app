"""Versuch: Scan eines B-Plans automatisch lagerichtig machen.

Methode: ALKIS (Flurstücke + Gebäude) als Strichbild zeichnen, mit dem Scan
über Merkmale (SIFT) vergleichen, Lage berechnen (Drehung, Maßstab, Verschiebung).
Prüfung: Ergebnis gegen den amtlichen Hamburger Rasterplan (Referenz).
Aufruf: python3 georef_test.py <kachelordner> <planname>
"""
import json, sys, subprocess, os
import numpy as np, cv2
from PIL import Image, ImageDraw
from pyproj import Transformer

kd, plan = sys.argv[1], sys.argv[2]
RES = 0.2  # Meter je Pixel für den Vergleich
meta = json.load(open(f"{kd}/kachel.json"))
x0, y0, x1, y1 = meta["utm_bbox"]
tr = Transformer.from_crs(4326, 25832, always_xy=True)
W, H = int((x1 - x0) / RES), int((y1 - y0) / RES)
px = lambda x, y: ((x - x0) / RES, (y1 - y) / RES)


def rings(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        for ring in poly:
            yield [px(*tr.transform(lo, la)) for lo, la in ring]


# 1) ALKIS als Strichbild
alk = Image.new("L", (W, H), 255); dr = ImageDraw.Draw(alk)
for fn, w in [("Flurstueck", 2), ("GebaeudeBauwerk", 2)]:
    for f in json.load(open(f"{kd}/{fn}.geojson"))["features"]:
        for r in rings(f["geometry"]):
            dr.line(r + [r[0]], fill=0, width=w)
alk = np.array(alk)

# 2) Scan der Planzeichnung (Seite mit dem Plan = größte Seite) auf ca. 0,2 m/px bei 1:1000
pdf = f"{kd}/{plan}.pdf"
info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
dpi = int(25.4 / RES)  # 1:1000 -> 1 mm Papier = 1 m
[os.remove(f) for f in __import__("glob").glob("/tmp/scan-*.png")]
subprocess.run(["pdftoppm", "-r", str(dpi), "-f", "1", "-l", "1", "-gray", "-png", pdf, "/tmp/scan"], check=True)
import glob
scan = cv2.imread(sorted(glob.glob("/tmp/scan-*.png"))[0], 0)
print("Scan", scan.shape, "ALKIS", alk.shape)

# 3) Lage suchen: Maßstab ~1:1000 und Nordausrichtung sind fast bekannt.
#    Grob: Kantenbild des Scans gegen ALKIS-Strichbild (gedreht/skaliert) korrelieren,
#    fein: ECC-Verfahren (Drehung, Maßstab, Verschiebung genau).
def kanten(img):
    e = (img < 110).astype(np.float32) * 255  # dunkle Striche
    return cv2.GaussianBlur(e, (0, 0), 2.5)
se = kanten(scan); ae = cv2.GaussianBlur((alk < 128).astype(np.float32) * 255, (0, 0), 2.5)
# Vorlage: ALKIS rund um den Geltungsbereich (+80 m)
gbf = next(f for f in json.load(open(f"{kd}/plaene.geojson"))["features"] if f["properties"]["geltendes_planrecht"] == plan)
pts = np.array([p for r in rings(gbf["geometry"]) for p in r])
m_ = 80 / RES
bx0, by0 = np.maximum(pts.min(0) - m_, 0).astype(int); bx1, by1 = np.minimum(pts.max(0) + m_, [W, H]).astype(int)
print("Vorlage", bx0, by0, bx1, by1)
F = 4  # grob mit 0,8 m/px
ses = cv2.resize(se, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2; hwx, hwy = (bx1 - bx0) // 2, (by1 - by0) // 2
best = (-1,)
for sc in np.arange(0.90, 1.101, 0.02):
    for rot in np.arange(-10, 10.1, 1.0):
        R = cv2.getRotationMatrix2D((cx, cy), rot, sc)
        t = cv2.warpAffine(ae, R, ae.shape[::-1])[int(cy - hwy):int(cy + hwy), int(cx - hwx):int(cx + hwx)]
        ts = cv2.resize(t, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
        if ts.shape[0] >= ses.shape[0] or ts.shape[1] >= ses.shape[1]: continue
        r = cv2.matchTemplate(ses, ts, cv2.TM_CCOEFF_NORMED)
        _, v, _, loc = cv2.minMaxLoc(r)
        if v > best[0]: best = (v, sc, rot, loc)
v, sc, rot, loc = best
print(f"grob: Wert {v:.3f}, Maßstab {sc:.2f}, Drehung {rot:.1f}°")
# Stufe 2: feiner suchen (0,4 m/px, Maßstab 0,5 %, Drehung 0,25°)
F = 2
ses = cv2.resize(se, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
sc0, rot0 = sc, rot
for sc_ in np.arange(sc0 - 0.03, sc0 + 0.031, 0.005):
    for rot_ in np.arange(rot0 - 1.5, rot0 + 1.6, 0.25):
        R = cv2.getRotationMatrix2D((cx, cy), rot_, sc_)
        t = cv2.warpAffine(ae, R, ae.shape[::-1])[int(cy - hwy):int(cy + hwy), int(cx - hwx):int(cx + hwx)]
        ts = cv2.resize(t, None, fx=1 / F, fy=1 / F, interpolation=cv2.INTER_AREA)
        r = cv2.matchTemplate(ses, ts, cv2.TM_CCOEFF_NORMED)
        _, v_, _, loc_ = cv2.minMaxLoc(r)
        if v_ > v: v, sc, rot, loc = v_, sc_, rot_, loc_
print(f"Stufe 2: Wert {v:.3f}, Maßstab {sc:.3f}, Drehung {rot:.2f}°, Lage {loc}")
# ALKIS-Pixel -> Scan-Pixel (grob), dann umkehren zu Scan -> ALKIS
R = np.vstack([cv2.getRotationMatrix2D((cx, cy), rot, sc), [0, 0, 1]])
T = np.array([[1, 0, loc[0] * F - int(cx - hwx)], [0, 1, loc[1] * F - int(cy - hwy)], [0, 0, 1]])
A2S = T @ R  # ALKIS -> Scan
M0 = np.linalg.inv(A2S)[:2].astype(np.float32)  # Scan -> ALKIS
# fein: Chamfer-Abgleich. Dünne Striche des Scans sollen auf ALKIS-Flurstückslinien fallen.
#   Kostenfunktion = mittlerer (gekappter) Abstand der Scan-Striche zur nächsten ALKIS-Linie.
from scipy.optimize import minimize
flst = Image.new("L", (W, H), 255); fd = ImageDraw.Draw(flst)
for f in json.load(open(f"{kd}/Flurstueck.geojson"))["features"]:
    for r in rings(f["geometry"]): fd.line(r + [r[0]], fill=0, width=1)
flst = np.array(flst)
dmap = cv2.distanceTransform((flst >= 128).astype(np.uint8), cv2.DIST_L2, 5)
dmap = np.minimum(dmap, 25.0)  # max 5 m
dark = (scan < 110).astype(np.uint8)
thin = cv2.subtract(dark, cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)))  # Flächen raus, Striche bleiben
ys, xs = np.nonzero(thin)
rng = np.random.default_rng(0); idx = rng.choice(len(xs), min(40000, len(xs)), replace=False)
P = np.stack([xs[idx], ys[idx], np.ones(len(idx))], 1).astype(np.float64)
def kosten(p, M0=M0):
    tx, ty, rot_, sc_ = p
    c_, s_ = np.cos(np.radians(rot_)) * sc_, np.sin(np.radians(rot_)) * sc_
    A = np.array([[c_, -s_, 0], [s_, c_, 0], [0, 0, 1]]) @ np.vstack([M0, [0, 0, 1]])
    A[0, 2] += tx; A[1, 2] += ty
    q = P @ A[:2].T
    ok = (q[:, 0] >= 0) & (q[:, 0] < W - 1) & (q[:, 1] >= 0) & (q[:, 1] < H - 1)
    if ok.sum() < 1000: return 1e9
    return dmap[q[ok, 1].astype(int), q[ok, 0].astype(int)].mean()
bestp, bestv = None, 1e9
for tx0 in range(-60, 61, 15):  # Startwerte rasterförmig (±12 m)
    for ty0 in range(-60, 61, 15):
        r = minimize(kosten, [tx0, ty0, 0, 1], method="Nelder-Mead", options={"xatol": 0.05, "fatol": 1e-3, "maxiter": 400, "initial_simplex": [[tx0, ty0, 0, 1], [tx0 + 5, ty0, 0, 1], [tx0, ty0 + 5, 0, 1], [tx0, ty0, 0.5, 1], [tx0, ty0, 0, 1.01]]})
        if r.fun < bestv: bestv, bestp = r.fun, r.x
tx, ty, rot_, sc_ = bestp
c_, s_ = np.cos(np.radians(rot_)) * sc_, np.sin(np.radians(rot_)) * sc_
A = np.array([[c_, -s_, 0], [s_, c_, 0], [0, 0, 1]]) @ np.vstack([M0, [0, 0, 1]]); A[0, 2] += tx; A[1, 2] += ty
Mg = A[:2].astype(np.float32); Mg[:, 2] /= 2; G = 2
print(f"Chamfer: mittl. Abstand {bestv * RES:.2f} m, Verschiebung {tx * RES:.1f}/{ty * RES:.1f} m, Drehung {rot_:.2f}°, Maßstab {sc_:.4f}")
Mf = Mg.copy(); Mf[:, 2] *= G
dist = cv2.distanceTransform((alk >= 128).astype(np.uint8), cv2.DIST_L2, 5) * RES
def guete(M):
    wsc = cv2.warpAffine((scan < 110).astype(np.uint8) * 255, M, (W, H))
    near = dist[(wsc > 0)]
    return np.median(near), np.mean(near < 1.0)  # Median-Abstand, Anteil Striche < 1 m an ALKIS
g0, gf = guete(M0), guete(Mf)
print("grob", g0, "fein", gf)
M = Mf if gf[1] > g0[1] else M0
s_ = float(np.sqrt(abs(np.linalg.det(M[:, :2])))); rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
med, frac = guete(M); res = np.array([med]); n = 0; s = s_
print(f"Ergebnis: Maßstab {s:.4f}, Drehung {rot:.2f}°, Median-Abstand {med:.2f} m, Anteil Striche <1 m an ALKIS {frac:.0%}")

# 4) Scan lagerichtig machen und auf Geltungsbereich zuschneiden
warp = cv2.warpAffine(scan, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=255)
mask = Image.new("L", (W, H), 0); md = ImageDraw.Draw(mask)
gb = next(f for f in json.load(open(f"{kd}/plaene.geojson"))["features"] if f["properties"]["geltendes_planrecht"] == plan)
for r in rings(gb["geometry"]): md.polygon(r, fill=255)
mask = np.array(mask) > 0
cut = np.where(mask, warp, 255).astype(np.uint8)
cv2.imwrite(f"/tmp/{plan}_lagerichtig.png", cut)

# 5) Prüfbild: ALKIS rot über dem lagerichtigen Scan; daneben Referenz der Stadt
ov = cv2.cvtColor(warp, cv2.COLOR_GRAY2BGR); ov[alk < 128] = (0, 0, 255)
ref = cv2.imread(f"{kd}/referenz_rasterplan.png", cv2.IMREAD_COLOR)
ref = cv2.resize(ref, (W, H)); rv = ref.copy(); rv[alk < 128] = (0, 0, 255)
cv2.imwrite(f"/tmp/{plan}_pruefung.jpg", cv2.resize(np.hstack([ov, rv]), (2 * W // 2, H // 2)), [cv2.IMWRITE_JPEG_QUALITY, 80])
json.dump({"plan": plan, "passpunkte": n, "massstab": s, "drehung_grad": rot,
           "median_abstand_m": float(med), "anteil_unter_1m": float(frac)},
          open(f"/tmp/{plan}_georef.json", "w"), indent=1)

# 6) Messung gegen den amtlichen Rasterplan: Versatz per Phasenkorrelation im Geltungsbereich
refg = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
ws = warp.astype(np.float32)
win = (slice(by0, by1), slice(bx0, bx1))
a_, b_ = refg[win], ws[win]
(dx, dy), resp = cv2.phaseCorrelate(cv2.GaussianBlur(a_, (0, 0), 1.5), cv2.GaussianBlur(b_, (0, 0), 1.5), cv2.createHanningWindow(a_.shape[::-1], cv2.CV_32F))
print(f"Versatz zum amtlichen Rasterplan: {dx * RES:.1f} m / {dy * RES:.1f} m (Sicherheit {resp:.2f})")
bl = cv2.addWeighted(ref, 0.5, cv2.cvtColor(warp, cv2.COLOR_GRAY2BGR), 0.5, 0)
cv2.imwrite(f"/tmp/{plan}_ueberlagert.jpg", bl[by0:by1, bx0:bx1], [cv2.IMWRITE_JPEG_QUALITY, 80])
