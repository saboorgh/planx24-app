# Steckbrief-Test (Pilot, Stand 28.11.2026)

Nur ein Test – gehört nicht zur Live-App. Ziel: Zu einer Adresse sagen, welches Planrecht gilt, und das
gegen das Wissen des Bauprüfers prüfen.

## Ablauf
1. Adresse in `anfragen.json` eintragen (`{"id": "…", "adresse": "…"}`) und auf Branch `pilot` pushen.
2. GitHub Action „Pilot B-Pläne“ holt die Rohdaten (`steckbrief.py`):
   - Ort (Nominatim), Flurstück am Punkt,
   - Hamburg: geltende Pläne (`bplaene/hh_hh_festgestellt`), alle XPlan-Objekte rund ums Flurstück (`xplan/*`), PDFs (Plan + Begründung) mit Text und Seitenbildern,
   - Schleswig-Holstein: Flurstück (INSPIRE-WFS), XPlan-Objekte aus dem Landesdienst `WFS_SH_PLANUNG` (falls die Gemeinde dort Pläne hat).
3. Der Agent (im Pilot: Claude im Chat) liest die Rohdaten und schreibt `steckbrief.md` je Adresse.

## Verzeichnisse
- `verzeichnis/hamburg.json`: alle 3.049 festgestellten Pläne mit Datum, Links und Umriss-Rechteck.
- `verzeichnis/quickborn/`: Pläne aus dem Landesdienst (dort nur sehr wenige) + alle B-Plan-PDFs der Stadt-Webseite als Text.
  Quickborn zeigt seine Pläne sonst nur im „Digitalen Atlas Nord“ (Landesportal) – dort noch kein offener Dienst gefunden.

## Inhalt eines Steckbriefs
- Adresse, Flurstück (Gemarkung, Nummer), Stand der Abfrage
- Geltende Pläne: Name, Art (B-Plan, Baustufenplan, Durchführungsplan, Teilbebauungsplan), Jahr/Feststellung, Änderungen, Links
- Rechtsgrundlage: BauNVO-Fassung (1962/1968/1977/1990/2017/2021/2023) bzw. Baupolizeiverordnung 1938 / BauRegVO
- Festsetzungen für dieses Flurstück: Art der Nutzung, GRZ/GR, GFZ/GF, Vollgeschosse, Bauweise, Höhen,
  Baugrenzen/Baulinien (vorhanden ja/nein, Lage grob), textliche Festsetzungen, die das Flurstück betreffen
- Je Wert: Quelle (XPlan / Planzeichnung / Verordnungstext, Seite) und Sicherheit
- Hinweise: was unsicher ist, was im Original zu prüfen ist
- Später (nicht im Test): Einhaltung von Baulinien/Baugrenzen durch den Bestand prüfen

## Erkenntnisse bisher
- Hamburg: alles da (Umrisse, XPlan, PDFs). Baustufenpläne haben oft keine Begründung (404).
- Schleswig-Holstein: Landesdienst XPlanung enthält nur wenige Pläne; viele Gemeinden geben ihre Daten
  dort mit Nutzungsbedingungen „kommerzielle Nutzung nur mit Vertrag“ frei (Atom-Feed LU_BLP) – rechtlich prüfen.
- Netz: Claude-Arbeitsbereich erreicht die Behördenserver nicht → Downloads über GitHub Actions.
