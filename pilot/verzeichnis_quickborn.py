"""Plan-Verzeichnis Quickborn: alle Pläne aus dem Landesdienst (XPlanung) + alle B-Plan-PDFs der Stadt-Webseite.
Speichert je PDF nur den Text (pdftotext) und die erste Seite als kleines Bild – zum Durchsuchen nach Straßen.
Läuft in GitHub Actions."""
import json, os, re, subprocess, urllib.parse, urllib.request, gzip, time
OUT = os.path.join(os.path.dirname(__file__), "steckbrief", "verzeichnis", "quickborn"); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 PlanX24-Pilot (pilot@planx24.de)", "Accept-Encoding": "gzip"}
def get(u, t=180):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r:
            b = r.read(); return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
    except Exception as e:
        print("Fehler", e, u[:120]); return None
v = {"stand": time.strftime("%Y-%m-%d")}
# 1) Landesdienst: alle BP_Plan im Stadtgebiet (grobes Rechteck um Quickborn, UTM 32)
bbox = "553000,5947000,566000,5961000,urn:ogc:def:crs:EPSG::25832"
g = get(f"https://service.gdi-sh.de/WFS_SH_PLANUNG?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=xplan:BP_Plan&BBOX={bbox}&COUNT=1000")
g = (g or b"").decode("utf-8", "ignore"); open(f"{OUT}/landesdienst_BP_Plan.gml", "w").write(g)
v["landesdienst"] = [{"name": n} for n in re.findall(r"<xplan:name>([^<]+)</xplan:name>", g)]
v["landesdienst_gemeinden"] = sorted(set(re.findall(r"<xplan:gemeindeName>([^<]+)<", g)))
# 2) Webseite der Stadt
html = (get("https://quickborn.de/Stadtentwicklung/Bebauungspl%C3%A4ne.html") or b"").decode("utf-8", "ignore")
urls = set()
for h in re.findall(r'href="([^"]+)"', html):
    h = h.replace("&amp;", "&")
    m = re.search(r"[?&]url=([^&]+)", h)
    u = urllib.parse.unquote(m.group(1)) if m else urllib.parse.urljoin("https://quickborn.de/", h)
    if u.lower().endswith(".pdf") and ("B-Plan" in u or "Bebauungsplan" in u): urls.add(u)
v["webseite"] = []
for u in sorted(urls):
    name = re.sub(r"[^A-Za-z0-9_.()-]+", "_", urllib.parse.unquote(u.rsplit("/", 1)[-1]))[:120]
    b = get(u); e = {"url": u, "datei": name}
    if b and b[:4] == b"%PDF":
        p = f"/tmp/{name}"; open(p, "wb").write(b)
        subprocess.run(["pdftotext", "-layout", p, f"{OUT}/{name[:-4]}.txt"], timeout=300)
        subprocess.run(["pdftoppm", "-r", "40", "-f", "1", "-l", "1", "-png", p, f"{OUT}/{name[:-4]}_s1"], timeout=300)
        e["mb"] = round(len(b) / 1e6, 1)
        e["seiten"] = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", p], capture_output=True, text=True).stdout or "Pages: 0").group(1))
    else: e["fehler"] = "nicht geladen"
    v["webseite"].append(e); print(e)
json.dump(v, open(f"{OUT}/verzeichnis.json", "w"), ensure_ascii=False, indent=1)
print(len(v["landesdienst"]), "Pläne im Landesdienst,", len(v["webseite"]), "PDFs auf der Webseite")
