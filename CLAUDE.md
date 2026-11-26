# PlanX24 – Regeln und Stand für Claude

Lies diese Datei zuerst. Sie ersetzt den Verlauf des ersten Chats.

## Wer und was
- Der User ist Bauprüfer in Hamburg und baut mit PlanX24 eine Web-App für Grundstücksanalyse, Machbarkeit und Bauvoranfragen. Start Hamburg, später Schleswig-Holstein und Niedersachsen.
- Sprache: Deutsch, kurz, einfache Worte. Er denkt oft laut; erst verstehen, dann bauen. Bei Produktfragen erst besprechen, kleine UI-Wünsche direkt umsetzen.
- Fachfragen zum Baurecht: Repository `saboorgh/baurecht-wissen` und Connector „Baurecht-Wissen“ (eigene Regeln in dessen CLAUDE.md).

## Produktidee (Reihenfolge)
1. Grundstück anklicken und mit der KI fragen, was man bauen darf (Daten des Grundstücks + Wissensbasis).
2. Projekt anlegen: Notizen, Aufgaben, Chatverlauf, eigene Angaben.
3. Bauvoranfrage als bezahlte Dienstleistung (Festpreis ca. 690–1.000 €, vom Fachmann geprüft).
Credits/Bezahlung erst ganz am Ende.

## Technik
- Vite + MapLibre GL 4.7.1 + proj4, Vercel (`api/chat.js` für den KI-Chat).
- Daten live im Browser von `https://api.hamburg.de/datasets/v1/` (CORS erlaubt), je Zelle 0,008° × 0,005° nachgeladen ab Zoom 15:
  `alkis_vereinfacht` (Flurstueck, GebaeudeBauwerk, Nutzung), `xplan` (bp_baugebietsteilflaeche, bp_baugrenze), `bplaene` (hh_hh_festgestellt), `uek_normierte_bodenrichtwerte` (lgv_brw_uek_mfh – Fläche steckt in `properties.geom`, geometry ist nur ein Punkt), `gages_vereinfacht` (hauskoordinaten, für die Suche).
- **Hintergrund: basemap.de Vektor grau** (`bm_web_gry.json`, BKG, amtlich, kostenlos auch kommerziell mit Quellenangabe; Kacheln bis Zoom 15). Seit 26.11.2026 Standard (vorher OpenFreeMap Positron). Gebäude der Hintergrundkarte **nicht ausblenden, sondern in unserem Grau** (#D3D6DA, Rand #9AA0A8) – Wunsch des Users; 3D-Gebäude der Hintergrundkarte aus. Ausgeblendet: Symbole, Hausnummern, Höhen, Straßennummern. Straßennamen größer (12 px bei Zoom 12 bis 16 px bei Zoom 18). Straßen- und Gewässernamen der Hintergrundkarte werden über unsere Flächen gelegt (`moveLayer` vor `l-fl`) und laufen entlang der Straße.
- Beschriftung als Vektor aus den geladenen ALKIS-Daten, **feste Schriftgröße** (wird beim Zoomen weder kleiner noch größer): Geschosse 12 px, für jedes Gebäude mit Geschosszahl, immer mitten im Baukörper (`freePt` auf das Gebäude); große Gebäude (≥ 120 m²) ab Zoom 16,5, kleine ab 17,5, damit die Zahl nicht über das Gebäude ragt (`text-allow-overlap`), Flurstücksnummern 10,5 px kursiv ab 17, Hausnummern 9,5 px ab 17,5 (beide weichen aus, nichts übereinander). Flurstücksnummer an der freiesten Stelle (`freePt`: größter Abstand zu Grenze und Gebäuden, z. B. hinten im Garten).
- Die echten ALKIS-Beschriftungspunkte (Präsentationsobjekte) gibt es nicht in der freien API (`alkis_vereinfacht`); nur im WMS-Bild. Daher eigene Platzierung.
- Keine Bilder (WMS) für die Beschriftung – Tempo. WMS-Versuch (`HH_WMS_ALKIS_Basiskarte`, ArcGIS, `DPI=192`) wurde wieder entfernt. Nur **eine** Version pflegen, keine Test-Schalter (Wunsch des Users).
- Schriften: `Noto Sans Regular/Bold/Italic` (gibt es bei basemap.de und OpenFreeMap; `Noto Sans Medium` nicht bei OpenFreeMap).
- Start: ganz Hamburg (Zoom 11), nichts vorausgewählt.
- Außerhalb Hamburgs weiße Abdeckung (60 %) mit grauer Landesgrenze aus `verwaltungsgrenzen/landesgrenze`.
- Nicht anklickbar: Straßen, Wege, Plätze, Bahn, Wasser (Filter auf `fl-fill`, `NOCLICK`, zusätzlich `onWater` über die Nutzung).
- Alte Versionen als Branches gesichert: `version-vektor` (516757b) und `version-bild` (51ddc5a).
- Tempo ist Pflicht: Neue Ebenen möglichst als Vektor aus `api.hamburg.de`, keine Bild-Dienste je Ansicht, außer es geht nicht anders (gescannter B-Plan).
- Gescannter B-Plan: WMS `HH_WMS_Cache_Rasterplan`, Ebene `bp_raster`, nur EPSG:25832, ein Bild je Ansicht.
- Projekte nur im Browser (localStorage). Später Supabase mit Login.
- Darstellung: Grau-Töne, Auswahl rot (#E5484D), Logo = fünf blaue Kästchen als X (#336AEA), dunkle Knöpfe #1C2B35. Rahmen um die Karte fast weiß (#FBFBFC), aktiver Tab und aktiver Knopf links grau (#ECEDEF).
- Quellenangabe unten kurz: „© FHH, LGV · © basemap.de / BKG“ (verlinkt).
- Idee des Users (offen): Hintergrundkarte in Farben wie ein Schwarzplan.

## Betrieb
- Live: https://planx24-app.vercel.app – jeder Push auf `main` geht automatisch online.
- Vercel: Team `saboorgh-3597` (team_nL236KGukgeQdpnXEeST6Vpz), Projekt `planx24-app` (prj_tuHEqkMemxvseO7itKhyyVaNpY4K).
- Supabase-Projekt „Baurecht RAG“ (yenkuxudqczaumeaoigr), Tabelle `zugang`: Zugang `planx24-app` mit Stufe `oeffentlich` ist angelegt.
- KI-Chat ist noch aus: In Vercel fehlen `ANTHROPIC_API_KEY` und `KB_URL` (der User trägt Schlüssel selbst ein, nie in den Chat). Für `KB_URL` einen frischen Zugang der Stufe `oeffentlich` anlegen (README).

## Offen / nächste Schritte
- User prüft gerade Adressen auf Richtigkeit (Grenzen, Festsetzungen, Baustufenpläne) und meldet Auffälligkeiten.
- Danach: Chat einschalten und fachlich schärfen, allgemeiner Chat oben bei der Karte (Idee), Bildschirm Bauvoranfrage, Erhaltungsverordnung/Denkmal anbinden, Supabase-Login und Projekte speichern, eigener Daten-Zwischenspeicher für Tempo.
- Rechtliches vor bezahlter Bauvoranfrage klären (Bauvorlageberechtigung, Haftpflicht, RDG).

## Commits
Deutsche Commit-Nachrichten, kleine Schritte, nach jeder Änderung kurz im Browser prüfen.
