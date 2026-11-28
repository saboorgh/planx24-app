# Regeln für den KI-Chat (Filter)

Drei Ebenen:
1. **Wissensbasis** – Fakten (Repo `saboorgh/baurecht-wissen`, Supabase-Funktion `suche`). Wird nur gelesen.
2. **Filter** – diese Dateien: wie die KI denkt, prüft und antwortet. Werden in `api/chat.js` der Reihe nach (Dateiname) zum Systemprompt zusammengesetzt.
3. **Antworten** – Format/Länge in `30-antwort.md`, Darstellung in `src/main.js` (Fußzeile „Grundlage“, Lade-Animation, Tageslimit).

Ändern: Datei bearbeiten, committen – nach dem Deploy gilt die neue Regel. Diese README wird nicht an die KI geschickt.
