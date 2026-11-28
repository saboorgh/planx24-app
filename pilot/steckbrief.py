"""Steckbrief-Test (Backend): zu jeder Adresse alle Rohdaten holen, die der Agent zum Lesen braucht.

Läuft in GitHub Actions (dort ist das Netz frei). Eingabe: pilot/steckbrief/anfragen.json
  [{"id": "a1", "adresse": "Musterstraße 1, 22041 Hamburg"}, ...]
Ausgabe je Anfrage: pilot/steckbrief/<id>/
  ort.json         Koordinate, Land, Flurstück(e) am Punkt
  plaene.json      geltende Pläne am Punkt (Name, Datum, Links)
  festsetzungen/   XPlan-Objekte rund um das Flurstück (Hamburg: OGC-API, SH: WFS als XPlanGML)
  pdf/             Planurkunde/Text/Begründung + Text (pdftotext) + Seitenbilder (zum Lesen)
Das Lesen und der Steckbrief selbst macht danach der Agent.
"""
import json, os, re, subprocess, time, urllib.parse, urllib.request
from pyproj import Transformer
from shapely.geometry import Point, shape

BASE = os.path.join(os.path.dirname(__file__), "steckbrief")
UA = {"User-Agent": "Mozilla/5.0 PlanX24-Pilot (pilot@planx24.de)", "Accept-Encoding": "gzip"}
import gzip
HH = "https://api.hamburg.de/datasets/v1"
SH_PLAN = "https://service.gdi-sh.de/WFS_SH_PLANUNG"
SH_CP = "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS"
to_utm = Transformer.from_crs(4326, 25832, always_xy=True)
to_wgs = Transformer.from_crs(25832, 4326, always_xy=True)


def get(url, t=120, binary=False):
    for i in range(3):
        try:
            url = urllib.parse.quote(url, safe=':/?&=%+(),')
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r:
                b = r.read()
                if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
                return b if binary else b.decode("utf-8", "ignore")
        except Exception as e:
            print("  Fehler", e, url[:140]); time.sleep(3 * (i + 1))
    return None


def geocode(adr):
    q = urllib.parse.quote(adr)
    d = json.loads(get(f"https://nominatim.openstreetmap.org/search?q={q}&format=jsonv2&addressdetails=1&limit=1&countrycodes=de") or "[]")
    time.sleep(1.1)
    if not d: return None
    d = d[0]
    return {"lon": float(d["lon"]), "lat": float(d["lat"]), "name": d.get("display_name"), "state": d.get("address", {}).get("state"), "ort": d.get("address", {}).get("town") or d.get("address", {}).get("city")}


def _norm(t):
    t = t.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    return re.sub(r"(strasse|str\.?)$", "str", re.sub(r"[^a-z0-9 ]", "", t.replace("-", " "))).strip()


_HH_STR, _QB_STR = None, None
def strassen_hh():
    global _HH_STR
    if _HH_STR is None:
        t = get("https://planx24-app.vercel.app/data/strassen.json") or "{}"
        names = set()
        def walk(o):
            if isinstance(o, str) and re.search(r"[A-Za-zÄÖÜäöüß]{3}", o) and len(o) < 60: names.add(o)
            elif isinstance(o, list): [walk(i) for i in o]
            elif isinstance(o, dict): [walk(v) for v in o.values()]
        walk(json.loads(t).get("s", []))
        _HH_STR = sorted(names)
    return _HH_STR


def strassen_quickborn():
    global _QB_STR
    if _QB_STR is None:
        q = '[out:json];area["name"="Quickborn"]["boundary"="administrative"]->.a;way(area.a)["highway"]["name"];out tags;'
        t = get("https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(q)) or '{"elements":[]}'
        _QB_STR = sorted({e["tags"]["name"] for e in json.loads(t)["elements"]})
    return _QB_STR


def aufloesen(text):
    """Freitext (auch mit Hörfehlern) -> Liste möglicher Adressen mit Ort, beste zuerst."""
    import difflib
    m = re.match(r"\s*(.+?)\s+(?:nr\.?|nummer)?\s*(\d+\s*[a-zA-Z]?)\s*(?:,\s*(.*))?$", text, re.I)
    str_, nr, ort = (m.group(1), m.group(2).replace(" ", ""), m.group(3)) if m else (text, "", None)
    kand = []
    for stadt, liste in [("Hamburg", strassen_hh()), ("Quickborn", strassen_quickborn())]:
        if ort and stadt.lower() not in ort.lower(): continue
        normd = {_norm(n): n for n in liste}
        for k in difflib.get_close_matches(_norm(str_), list(normd), n=3, cutoff=0.6):
            kand.append({"strasse": normd[k], "nr": nr, "ort": stadt, "aehnlich": round(difflib.SequenceMatcher(None, _norm(str_), k).ratio(), 2)})
    return sorted(kand, key=lambda k: -k["aehnlich"])


def hh_items(coll, bbox):
    feats, url = [], f"{HH}/{coll}/items?f=json&limit=1000&bbox={bbox}"
    while url:
        t = get(url)
        if not t: break
        d = json.loads(t); feats += d.get("features", [])
        url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
    return feats


def pdf_holen(url, ziel):
    os.makedirs(ziel, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_.()-]+", "_", urllib.parse.unquote(url.rsplit("/", 1)[-1]))[:120]
    if not name.lower().endswith(".pdf"): name += ".pdf"
    b = get(url, 300, binary=True)
    if not b or b[:4] != b"%PDF": return {"url": url, "fehler": "kein PDF"}
    p = os.path.join(ziel, name); open(p, "wb").write(b)
    subprocess.run(["pdftotext", "-layout", p, p[:-4] + ".txt"], timeout=300)
    subprocess.run(["pdftoppm", "-r", "50", "-png", p, p[:-4] + "_s"], timeout=600)
    return {"url": url, "datei": name, "mb": round(len(b) / 1e6, 1)}


def hamburg(a, d, x, y, lon, lat):
    pt = Point(lon, lat)
    bb = f"{lon - 0.0003:.6f},{lat - 0.0002:.6f},{lon + 0.0003:.6f},{lat + 0.0002:.6f}"
    fl = [f for f in hh_items("alkis_vereinfacht/collections/Flurstueck", bb) if shape(f["geometry"]).contains(pt)]
    a["flurstueck"] = [f["properties"] for f in fl]
    plaene = [f for f in hh_items("bplaene/collections/hh_hh_festgestellt", bb) if shape(f["geometry"]).contains(pt)]
    a["plaene"] = [f["properties"] for f in plaene]
    # alle XPlan-Objekte rund um das Flurstück
    fb = shape(fl[0]["geometry"]).bounds if fl else (lon - 0.0005, lat - 0.0003, lon + 0.0005, lat + 0.0003)
    bb2 = f"{fb[0] - 0.0004:.6f},{fb[1] - 0.0003:.6f},{fb[2] + 0.0004:.6f},{fb[3] + 0.0003:.6f}"
    cols = json.loads(get(f"{HH}/xplan/collections?f=json"))["collections"]
    os.makedirs(f"{d}/festsetzungen", exist_ok=True)
    for c in cols:
        fs = hh_items(f"xplan/collections/{c['id']}", bb2)
        if fs: json.dump({"type": "FeatureCollection", "features": fs}, open(f"{d}/festsetzungen/{c['id']}.geojson", "w"), ensure_ascii=False)
    if fl: json.dump({"type": "FeatureCollection", "features": fl}, open(f"{d}/flurstueck.geojson", "w"))
    a["pdf"] = []
    for p in a["plaene"]:
        for k in ["planrecht", "begruendung"]:
            if p.get(k): a["pdf"].append(pdf_holen(p[k], f"{d}/pdf"))


def wfs(url, typ, x, y, r=60):
    bbox = f"{x - r:.1f},{y - r:.1f},{x + r:.1f},{y + r:.1f},urn:ogc:def:crs:EPSG::25832"
    return get(f"{url}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES={typ}&BBOX={bbox}&COUNT=200")


def schleswig_holstein(a, d, x, y):
    os.makedirs(f"{d}/festsetzungen", exist_ok=True)
    cp = wfs(SH_CP, "cp:CadastralParcel", x, y, 5)
    if cp: open(f"{d}/flurstueck.gml", "w").write(cp); a["flurstueck_labels"] = re.findall(r"<(?:cp:)?label>([^<]+)<", cp)
    caps = open(os.path.join(os.path.dirname(__file__), "sh", "wfs_planung.xml"), encoding="utf-8", errors="ignore").read()
    typen = sorted(set(re.findall(r"FeatureType>\s*<[^>]*Name[^>]*>(xplan:BP_[^<]+)<", caps)))
    a["xplan_treffer"] = {}
    for t in typen:
        g = wfs(SH_PLAN, t, x, y, 25 if t == "xplan:BP_Plan" else 80)
        n = len(re.findall(r"<wfs:member", g or ""))
        if n:
            open(f"{d}/festsetzungen/{t.split(':')[1]}.gml", "w").write(g); a["xplan_treffer"][t] = n
    # Pläne + Dokumente aus BP_Plan
    plan = open(f"{d}/festsetzungen/BP_Plan.gml").read() if os.path.exists(f"{d}/festsetzungen/BP_Plan.gml") else ""
    a["plaene"] = re.findall(r"<xplan:name>([^<]+)</xplan:name>", plan)
    links = sorted(set(re.findall(r"<xplan:referenzURL>([^<]+)</xplan:referenzURL>", plan)))
    a["pdf"] = [pdf_holen(u, f"{d}/pdf") for u in links if u.lower().split("?")[0].endswith(".pdf")][:12]
    # Gemeinde-Webseite (Quickborn): Liste aller B-Plan-PDFs
    if (a.get("ort") or "").lower().startswith("quickborn"):
        html = get("https://quickborn.de/Stadtentwicklung/Bebauungspl%C3%A4ne.html") or ""
        open(f"{d}/gemeinde_bplaene.html", "w").write(html)
        a["gemeinde_pdfs"] = sorted(set(urllib.parse.urljoin("https://quickborn.de/", h) for h in re.findall(r'href="([^"]+\.pdf[^"]*)"', html, re.I)))


for q in json.load(open(f"{BASE}/anfragen.json")):
    d = f"{BASE}/{q['id']}"; os.makedirs(d, exist_ok=True)
    a = {"adresse": q["adresse"], "stand": time.strftime("%Y-%m-%d %H:%M")}
    kand = aufloesen(q["adresse"]) if not re.search(r"\d{5}", q["adresse"]) else []
    a["kandidaten"] = kand
    g = None
    for k in kand[:4]:
        g = geocode(f"{k['strasse']} {k['nr']}, {k['ort']}")
        if g: a["aufgeloest"] = k; break
    if not g: g = geocode(q["adresse"])
    if not g: a["fehler"] = "Adresse nicht gefunden"
    else:
        a.update(g); x, y = to_utm.transform(g["lon"], g["lat"]); a["utm"] = [round(x, 1), round(y, 1)]
        try:
            if g.get("state") == "Hamburg" or (g.get("ort") == "Hamburg" and ", Hamburg," in (g.get("name") or "")): hamburg(a, d, x, y, g["lon"], g["lat"])
            elif g.get("state") == "Schleswig-Holstein": schleswig_holstein(a, d, x, y)
            else: a["fehler"] = "Land noch nicht angebunden: " + str(g.get("state"))
        except Exception as e:
            a["fehler"] = repr(e)
    json.dump(a, open(f"{d}/ort.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: a.get(k) for k in ["adresse", "state", "plaene", "fehler"]}, ensure_ascii=False)[:500])
