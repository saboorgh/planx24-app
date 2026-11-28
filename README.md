# PlanX24 – Grundstücke Hamburg

Grundstück in Hamburg anklicken, Daten sehen und die KI fragen, was man dort bauen darf.

## Was die erste Version kann

- **Karte von ganz Hamburg.** Flurstücke, Gebäude und Nutzung kommen live aus der offenen Schnittstelle api.hamburg.de (ALKIS). Geladen wird immer nur der Ausschnitt, der gerade zu sehen ist.
- **Ebenen:** gescannter Bebauungsplan (lagerichtig, Hamburger Kartendienst), digitale Festsetzungen und Baugrenzen (XPlanung), Bodenrichtwerte, 3D-Ansicht.
- **Adresssuche** über die Hamburger Hauskoordinaten.
- **Flurstück anklicken**, auch mehrere zusammen: Fläche, Bestand, Festsetzungen, Bodenrichtwert, rechnerische Reserve.
- **KI-Chat zum Grundstück** über die Claude-API. Die KI bekommt die Daten des Grundstücks und der Umgebung und sucht in der Baurecht-Wissensbasis.
- **Projekte** mit Lageplan, eigenen Angaben, Vorschlägen, Aufgaben, Notizen und Chatverlauf. Sie werden in dieser Version **nur im Browser** gespeichert.

## Aufbau

| Teil | Wo | Was |
| --- | --- | --- |
| Oberfläche | `index.html`, `src/` | Vite, MapLibre, proj4. Lädt die Hamburger Daten direkt im Browser. |
| KI-Chat | `api/chat.js` | Vercel-Funktion. Ruft die Claude-API auf und führt die Suche in der Wissensbasis aus. |

## Online stellen mit Vercel

1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden, **Add New → Project** und `planx24-app` importieren. Vercel erkennt Vite von selbst.
2. Unter **Settings → Environment Variables** eintragen:

   | Name | Wert |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | dein Schlüssel von console.anthropic.com |
   | `KB_URL` | `https://<projekt>.supabase.co/functions/v1/suche?key=<Schlüssel>`, mit einem Schlüssel der Stufe **oeffentlich** |
   | `CLAUDE_MODEL` | optional, Standard `claude-sonnet-5-5` |
   | `DAILY_LIMIT` | optional: Tageslimit kostenloser Fragen je Besucher in 24 h. Leer oder `0` = aus (bis zum Release), z. B. `5` = an |

3. **Deploy** drücken. Nach jeder Änderung im Repository baut Vercel automatisch neu.

### Schlüssel der Stufe „oeffentlich“ für die Wissensbasis

Die App ist offen ohne Login. Deshalb darf sie nur öffentliche und weitergebbare Inhalte sehen, siehe `00_System/Leitplanken.md` in `baurecht-wissen`. Den Schlüssel im Supabase-Projekt „Baurecht RAG“ im SQL-Editor anlegen:

```sql
create temporary table _t as select md5(random()::text || clock_timestamp()::text) || md5(random()::text) as tok;
insert into zugang (name, stufe, token_hash, aktiv)
  select 'planx24-app', 'oeffentlich', encode(sha256(tok::bytea), 'hex'), true from _t;
select tok from _t;  -- diesen Wert als key in KB_URL eintragen
```

Falls die Spalten der Tabelle `zugang` anders heißen, die Namen anpassen.

## Lokal starten

```bash
npm install
npm run dev        # nur Oberfläche; für den Chat: npx vercel dev
```

## Grenzen dieser Version

- Projekte liegen nur im Browser, ohne Konto. Später: Supabase mit Login.
- Die Begrenzung pro Besucher gilt je Server-Instanz und ist nur ein einfacher Schutz vor Kosten.
- Erhaltungsverordnungen, Denkmalschutz und Pläne im Verfahren sind noch nicht angebunden.
- Daten: © Freie und Hansestadt Hamburg, LGV (dl-de/by-2-0). Hintergrundkarte: © basemap.de / BKG.
