// TESTVERSION (nur mit ?lod2 im Link): echte Dachformen aus dem 3D-Stadtmodell Hamburg (LoD2),
// als fertige 3D-Kacheln der Stadt (3D Tiles 1.1, glb), gezeichnet mit deck.gl direkt in der MapLibre-Karte.
// Wird nur bei Bedarf geladen (eigene Datei), die normale App bleibt davon unberührt.
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';

// „#tileset.json“: wird nicht an die Stadt geschickt, aber das 3D-Programm erkennt daran die Übersichtsdatei
const URL3D = 'https://api.hamburg.de/datasets/v1/lod2_hamburg/collections/building/3dtiles?f=json#tileset.json';
let overlay = null, offset = 0, visible = false, onErr = () => {}, tiles = 0, said = false;

function layer() {
  return new Tile3DLayer({
    id: 'lod2',
    data: URL3D,
    loader: Tiles3DLoader,
    // Die Adresse der Stadt endet auf „?f=json“ statt „.json“ – ausdrücklich als Übersichtsdatei (Tileset) lesen
    // Das 3D-Programm hängt die (schon vollständigen) Kachel-Adressen der Stadt an die Basisadresse an
    // („…/building/https://api.hamburg.de/…“) – vor dem Abruf auf die letzte vollständige Adresse kürzen
    // Antwort behält die Adresse mit „#tileset.json“, damit die Übersichtsdatei weiter erkannt wird
    loadOptions: { fetch: async (url, init) => { const u = String(url); const i = u.lastIndexOf('https://'); let fixed = i > 0 ? u.slice(i) : u; if (/\.(glb|subtree)\?/.test(fixed)) fixed = fixed.split('?')[0]; // Zusatz der Übersichtsadresse nicht an Kacheln hängen const r = await fetch(fixed, init); try { Object.defineProperty(r, 'url', { value: fixed }); } catch (e) { /* egal */ } return r; } },
    visible,
    // Höhenausgleich: Die Kacheln liegen auf echter Geländehöhe, unsere Karte ist flach (Höhe 0)
    modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, offset, 1],
    opacity: 1,
    onTileError: (tile, url, message) => { console.warn('LOD2 Kachel-Fehler', url, message, tile); onErr('Kachel-Fehler: ' + String(message || '').slice(0, 80) + ' · ' + String(url || (tile && tile.contentUrl) || '').slice(-40)); },
    onTilesetLoad: () => onErr('Stadtmodell verbunden, lade Dächer …'),
    // Rückmeldung, sobald Häuser da sind (zum Testen)
    onTileLoad: () => { tiles++; if (!said) { said = true; onErr('Dächer geladen – mit dem Höhen-Regler auf den Boden stellen'); } }
  });
}

export function setup(map, errCb) {
  if (errCb) onErr = errCb;
  if (overlay) return;
  // Prüfung 1: Ist das Stadtmodell vom Gerät aus erreichbar?
  fetch(URL3D).then(r => r.ok ? r.json() : Promise.reject(new Error('Stadt antwortet ' + r.status)))
    .then(j => onErr('Stadtmodell erreichbar (Version ' + ((j.asset && j.asset.version) || '?') + ')'))
    .catch(e => onErr('Stadtmodell nicht erreichbar: ' + e.message));
  try {
    // Prüfung 2: Fehler beim Zeichnen melden
    overlay = new MapboxOverlay({ interleaved: true, layers: [layer()], onError: e => onErr('Zeichenfehler: ' + (e && e.message || e)) });
    map.addControl(overlay);
  } catch (e) { onErr('3D-Programm startet nicht: ' + e.message); }
}
export function show(on) { visible = on; if (overlay) overlay.setProps({ layers: [layer()] }); }
export function setOffset(v) { offset = v; if (overlay) overlay.setProps({ layers: [layer()] }); }
export function getOffset() { return offset; }
