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
- Beschriftung wie BORIS: WMS `HH_WMS_ALKIS_Basiskarte`, Ebenen 22,23,25,27,29, EPSG:3857, ein Bild je Ansicht ab Zoom 16,5.
- Gescannter B-Plan: WMS `HH_WMS_Cache_Rasterplan`, Ebene `bp_raster`, nur EPSG:25832, ein Bild je Ansicht.
- Hintergrund: OpenFreeMap Positron (OSM, frei, auch kommerziell).
- Projekte nur im Browser (localStorage). Später Supabase mit Login.
- Darstellung: Grau-Töne, Auswahl rot (#E5484D), Logo = fünf blaue Kästchen als X (#336AEA), dunkle Knöpfe #1C2B35.

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
