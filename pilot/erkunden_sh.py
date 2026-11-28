"""Erkunden: Wo gibt es Pläne und Flurstücke für Quickborn (Schleswig-Holstein)? Läuft in GitHub Actions."""
import os, re, json, urllib.request, urllib.parse, time
OUT = os.path.join(os.path.dirname(__file__), "sh"); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "PlanX24-Pilot (kontakt: pilot@planx24.de)"}
def get(url, t=60):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r:
            return r.status, r.read()
    except Exception as e:
        return getattr(e, "code", 0), str(e).encode()
log = {}
# 1) Dienste des Landes
for name, url in {
    "wfs_lu": "https://service.gdi-sh.de/WFS_SH_AIII_LU?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "wfs_planung": "https://service.gdi-sh.de/WFS_SH_PLANUNG?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "wms_planung": "https://service.gdi-sh.de/WMS_SH_PLANUNG?SERVICE=WMS&REQUEST=GetCapabilities",
    "inspire_lu_blp": "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AIII_LU_BLP?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "inspire_lu_xplan": "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AIII_LU_XPlanung?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "inspire_cp": "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "inspire_bu": "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AIII_BU?Service=wfs&Version=2.0.0&request=GetCapabilities",
    "wms_alkis_opengbd": "https://dienste.gdi-sh.de/WMS_SH_ALKIS_OpenGBD?SERVICE=WMS&REQUEST=GetCapabilities",
}.items():
    s, b = get(url); log[name] = {"status": s, "bytes": len(b)}
    open(f"{OUT}/{name}.xml", "wb").write(b[:3_000_000])
    print(name, s, len(b))
# 2) Quickborn: Seiten mit B-Plänen finden
seen, queue, links = set(), ["https://www.quickborn.de/", "https://quickborn.de/"], set()
for _ in range(60):
    if not queue: break
    u = queue.pop(0)
    if u in seen: continue
    seen.add(u); s, b = get(u, 30); time.sleep(0.5)
    if s != 200: continue
    html = b.decode("utf-8", "ignore")
    for h in re.findall(r'href="([^"]+)"', html):
        a = urllib.parse.urljoin(u, h)
        if "B-Plan" in a or "Bebauungspl" in a or "bebauungspl" in a.lower():
            if a.lower().endswith(".pdf"): links.add(a)
            elif "quickborn.de" in a and a not in seen: queue.insert(0, a)
        elif "quickborn.de" in a and any(k in a for k in ["Stadtentwicklung", "Planen", "Bauen", "Stadtplanung"]) and a not in seen and not a.lower().endswith(".pdf"):
            queue.append(a)
log["quickborn_seiten"] = sorted(seen); log["quickborn_pdfs"] = sorted(links)
print(len(links), "PDFs")
json.dump(log, open(f"{OUT}/erkunden.json", "w"), indent=1, ensure_ascii=False)
