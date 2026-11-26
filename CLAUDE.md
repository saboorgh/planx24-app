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
- Beschriftung als Vektor (MapLibre-Symbole) aus den schon geladenen ALKIS-Daten: Geschosse (römisch, `anzahlgs`, ab Zoom 16,5), Flurstücksnummern (kursiv, ab 17), Hausnummern (`gages_vereinfacht`, ab 17,5), Straßennamen. Größen und Zoomstufen wie in Commit 516757b – **so lassen**: Ein Versuch mit größeren Geschossen, Beschriftung schon ab Zoom 16 und Bauteil-Geschossen (6d138fc) war dem User zu voll („alles übereinander“) und wurde zurückgenommen.
- Außerhalb Hamburgs liegt eine weiße Abdeckung (60 %) mit grauer Landesgrenze; die Grenze wird einmal geladen aus `verwaltungsgrenzen/landesgrenze`. Straßen- und Gewässernamen kommen aus der Hintergrundkarte (laufen entlang der Straße, bleiben bei jedem Zoom); eigene waagerechte Straßennamen (`l-str`) sind aus, weil sie „gerade“ lagen. Orts-/Stadtteilnamen der Hintergrundkarte nur bis Zoom 16.
- **Testversion über `?test`** (https://planx24-app.vercel.app/?test, seit 26.11.2026): Hintergrund basemap.de Vektor grau (`bm_web_gry.json`, Kacheln bis Zoom 15, Schriften Noto Sans vorhanden), Symbole/Hausnummern/Höhen usw. der Hintergrundkarte aus; Beschriftung mit festem Maßstab wie ALKIS (Schriftgröße verdoppelt sich je Zoomstufe, `text-allow-overlap`/`text-ignore-placement`, Geschosse ab 17,3, Flurstücke ab 17,6, Hausnummern ab 17,8). Ohne `?test` alles wie bisher. Entfernen: alle `TEST`-Stellen in `src/main.js`. Der User entscheidet, ob das Standard wird.
- Straßen- und Gewässernamen der Hintergrundkarte werden nach dem Laden über unsere Flächen gelegt (`moveLayer` vor `l-fl`), sonst verdeckt die Nutzung sie.
- Wasser nicht anklickbar auch über die Nutzung (`onWater`, F.nu), weil Wasser-Flurstücke gemischt sein können.
- CARTO-Kartenhintergrund (wie bei swzpln.de) nicht genommen: freie Nutzung nur eingeschränkt, für eine kommerzielle App unsicher.
- Alte Versionen als Branches gesichert: `version-vektor` (516757b, erste Vektor-Beschriftung, Hintergrund basemap.de grau) und `version-bild` (51ddc5a, Beschriftung als WMS-Bild mit DPI).
- Nicht anklickbar: Straßen, Wege, Plätze, Bahn, Wasser (Filter auf `fl-fill` und `NOCLICK` in `parcelAt`). **Keine Bilder (WMS) für die Beschriftung** – der User will Tempo; der WMS-Versuch (`HH_WMS_ALKIS_Basiskarte`, ArcGIS, versteht `DPI=192`) war zu langsam und wurde am 26.11.2026 wieder entfernt.
- Schriften nur, die OpenFreeMap hat: `Noto Sans Regular`, `Noto Sans Bold`, `Noto Sans Italic` (`Noto Sans Medium` gibt es dort nicht → Beschriftung fehlt dann).
- Tempo ist Pflicht: Neue Ebenen möglichst als Vektor aus `api.hamburg.de`, keine Bild-Dienste je Ansicht, außer es geht nicht anders (gescannter B-Plan).
- Gescannter B-Plan: WMS `HH_WMS_Cache_Rasterplan`, Ebene `bp_raster`, nur EPSG:25832, ein Bild je Ansicht.
- Hintergrund: OpenFreeMap Positron (OSM, frei, auch kommerziell).
- Projekte nur im Browser (localStorage). Später Supabase mit Login.
- Darstellung: Grau-Töne, Auswahl rot (#E5484D), Logo = fünf blaue Kästchen als X (#336AEA), dunkle Knöpfe #1C2B35. Rahmen um die Karte fast weiß (#FBFBFC), aktiver Tab und aktiver Knopf links grau (#ECEDEF).
- Quellenangabe unten kurz: „© FHH, LGV · © OpenStreetMap“ (verlinkt auf dl-de/by-2-0 und OSM-Copyright).
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
