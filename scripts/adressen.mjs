// Baut beim Deploy ein eigenes Straßen- und Adressverzeichnis für die Suche (läuft vor `vite build`).
// Quelle: api.hamburg.de, gages_vereinfacht/hauskoordinaten (ca. 300.000 Adressen, dl-de/by-2-0).
// Ergebnis (public/data, nicht im Repository):
//   strassen.json – Straßennamen mit Ortsteilen, PLZ und Mittelpunkt (klein, wird sofort geladen)
//   adressen.json – alle Hausnummern mit Lage je Straße (wird im Hintergrund nachgeladen)
// Schlägt das Laden fehl, bricht der Build nicht ab: Die App sucht dann wie bisher über die Schnittstelle.
import { mkdir, writeFile, access } from 'node:fs/promises';

const OUT = new URL('../public/data/', import.meta.url);
const BASE = 'https://api.hamburg.de/datasets/v1/gages_vereinfacht/collections/hauskoordinaten/items?f=json&limit=10000&properties=strassenname,hausnummer,postleitzahl,postOrtsteil,rechtswert_utm,hochwert_utm';

async function page(offset, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}&offset=${offset}`);
      if (r.ok) return (await r.json()).features || [];
    } catch (e) { /* nochmal */ }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Seite ' + offset + ' nicht geladen');
}

async function main() {
  const t0 = Date.now();
  const first = await fetch(`${BASE}&offset=0`).then(r => r.json());
  const total = first.numberMatched || 0;
  let feats = first.features || [];
  const offsets = []; for (let o = 10000; o < total; o += 10000) offsets.push(o);
  // je 4 Seiten gleichzeitig
  for (let i = 0; i < offsets.length; i += 4) (await Promise.all(offsets.slice(i, i + 4).map(o => page(o)))).forEach(f => { feats = feats.concat(f); });
  if (feats.length < total * 0.95) throw new Error(`nur ${feats.length} von ${total} Adressen`);

  const by = new Map();
  for (const f of feats) {
    const p = f.properties || {}; const name = p.strassenname; const x = Math.round(p.rechtswert_utm), y = Math.round(p.hochwert_utm);
    if (!name || !x || !y) continue;
    let s = by.get(name); if (!s) by.set(name, s = { a: [], ot: new Map(), plz: new Map() });
    s.a.push([String(p.hausnummer || ''), x, y]);
    if (p.postOrtsteil) s.ot.set(p.postOrtsteil, (s.ot.get(p.postOrtsteil) || 0) + 1);
    if (p.postleitzahl) s.plz.set(p.postleitzahl, (s.plz.get(p.postleitzahl) || 0) + 1);
  }
  const ots = [], otIdx = new Map(); const oi = n => { if (!otIdx.has(n)) { otIdx.set(n, ots.length); ots.push(n); } return otIdx.get(n); };
  const nat = (a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0) || a[0].localeCompare(b[0], 'de');
  const streets = [], addrs = [];
  for (const [name, s] of [...by].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    s.a.sort(nat);
    const cx = Math.round(s.a.reduce((v, a) => v + a[1], 0) / s.a.length), cy = Math.round(s.a.reduce((v, a) => v + a[2], 0) / s.a.length);
    const ot = [...s.ot].sort((a, b) => b[1] - a[1]).map(e => oi(e[0]));
    const plz = [...s.plz].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 3).join(', ');
    streets.push([name, ot, plz, cx, cy, s.a.length]);
    // Hausnummern durch | getrennt, Lage als Abstand zum Straßenmittelpunkt in Metern
    addrs.push([s.a.map(a => a[0]).join('|'), s.a.map(a => a[1] - cx), s.a.map(a => a[2] - cy)]);
  }
  await mkdir(OUT, { recursive: true });
  const stand = new Date().toISOString().slice(0, 10);
  await writeFile(new URL('strassen.json', OUT), JSON.stringify({ stand, o: ots, s: streets }));
  await writeFile(new URL('adressen.json', OUT), JSON.stringify({ stand, s: addrs }));
  console.log(`Adressverzeichnis: ${streets.length} Straßen, ${feats.length} Adressen, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch(async e => {
  console.warn('Adressverzeichnis nicht erstellt (Suche nutzt dann die Schnittstelle):', e.message);
  try { await access(new URL('strassen.json', OUT)); } catch { await mkdir(OUT, { recursive: true }); }
  process.exit(0);
});
