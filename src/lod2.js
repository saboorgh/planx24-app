// TESTVERSION (nur mit ?lod2 im Link): echte Dachformen aus dem 3D-Stadtmodell Hamburg (LoD2),
// als fertige 3D-Kacheln der Stadt (3D Tiles 1.1, glb), gezeichnet mit deck.gl direkt in der MapLibre-Karte.
// Wird nur bei Bedarf geladen (eigene Datei), die normale App bleibt davon unberührt.
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { Tiles3DLoader } from '@loaders.gl/3d-tiles';

const URL3D = 'https://api.hamburg.de/datasets/v1/lod2_hamburg/collections/building/3dtiles?f=json';
let overlay = null, offset = -40, visible = false, onErr = () => {};

function layer() {
  return new Tile3DLayer({
    id: 'lod2',
    data: URL3D,
    loader: Tiles3DLoader,
    visible,
    // Höhenausgleich: Die Kacheln liegen auf echter Geländehöhe, unsere Karte ist flach (Höhe 0)
    modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, offset, 1],
    opacity: 1,
    onTileError: e => onErr('Kachel: ' + (e && e.message || e)),
    onTilesetLoad: () => onErr(null)
  });
}

export function setup(map, errCb) {
  if (errCb) onErr = errCb;
  if (overlay) return;
  overlay = new MapboxOverlay({ interleaved: true, layers: [layer()] });
  map.addControl(overlay);
}
export function show(on) { visible = on; if (overlay) overlay.setProps({ layers: [layer()] }); }
export function setOffset(v) { offset = v; if (overlay) overlay.setProps({ layers: [layer()] }); }
export function getOffset() { return offset; }
