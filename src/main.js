import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import proj4 from 'proj4';
import './style.css';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString('de-DE', {minimumFractionDigits: d, maximumFractionDigits: d});
const ROM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const LAT0 = 53.5837, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110574;
const ICON_MAP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/></svg>';
const ICON_DIR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5a1.5 1.5 0 011.5-1.5h4.5l2 2.5H19a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5z"/></svg>';
const STATUS = [['neu', 'Neu', '#8A8C92'], ['arbeit', 'In Arbeit', '#C98A1B'], ['erledigt', 'Erledigt', '#1E7B3E']];
const FIELDS = [
  { k: 'eigentuemer', l: 'Eigentümer', t: 'text' },
  { k: 'kontakt', l: 'Ansprechpartner', t: 'text' },
  { k: 'kaufpreis', l: 'Kaufpreis', t: 'num', u: '€' },
  { k: 'nutzung', l: 'Geplante Nutzung', t: 'sel', o: ['', 'Wohnen', 'Wohnen und Gewerbe', 'Gewerbe', 'Sonstiges'] },
  { k: 'we', l: 'Wohneinheiten', t: 'num' },
  { k: 'gf', l: 'Geplante GF', t: 'num', u: 'm²' },
  { k: 'wv', l: 'Wiedervorlage', t: 'date' }
];

let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600); }
function soon(root) { (root || document).querySelectorAll('[data-soon]').forEach(b => b.addEventListener('click', () => toast('Kommt in einem der nächsten Bildschirme.'))); }
soon();

/* Geometrie */
function ringArea(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) a += (r[i][0] * KX) * (r[i + 1][1] * KY) - (r[i + 1][0] * KX) * (r[i][1] * KY); return a / 2; }
function polyArea(mp) { let s = 0; for (const p of mp) { s += Math.abs(ringArea(p[0])); for (let k = 1; k < p.length; k++) s -= Math.abs(ringArea(p[k])); } return s; }
function centroid(mp) { let A = 0, cx = 0, cy = 0; for (const p of mp) { const r = p[0]; for (let i = 0; i < r.length - 1; i++) { const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; A += f; cx += (r[i][0] + r[i + 1][0]) * f; cy += (r[i][1] + r[i + 1][1]) * f; } } if (!A) return mp[0][0][0]; return [cx / (3 * A), cy / (3 * A)]; }
function inRing(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c; } return c; }
function inPoly(pt, mp) { return mp.some(p => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h))); }
function bboxPts(pts) { let a = [180, 90, -180, -90]; for (const [x, y] of pts) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; return a; }
function bbox(mp) { return bboxPts(mp.flatMap(p => p[0])); }
function lines(g) { return g.type === 'LineString' ? [g.coordinates] : g.coordinates; }
function segX(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
function lineHitsPoly(L, mp) { if (L.some(pt => inPoly(pt, mp))) return true; for (let i = 1; i < L.length; i++) for (const poly of mp) for (const ring of poly) for (let j = 1; j < ring.length; j++) if (segX(L[i - 1], L[i], ring[j - 1], ring[j])) return true; return false; }

/* Fachliches */
function nice(s) { return String(s || '').replace(/([a-zäöü])([A-Z])/g, '$1 $2').replace(/^Allg /, 'Allgemeines ').replace(/flaeche/gi, 'fläche').replace(/Bau fläche/, 'Baufläche'); }
function planName(p) {
  if (!p) return '';
  let m;
  if ((m = p.match(/^BS(\w+?)(\((\d+)Aend\))?$/))) return 'Baustufenplan ' + m[1] + (m[3] ? ', ' + m[3] + '. Änderung' : '');
  if ((m = p.match(/^TB(\d+)$/))) return 'Teilbebauungsplan ' + m[1];
  if ((m = p.match(/^([A-Za-zäöüß-]+)(\d+)$/))) return 'Bebauungsplan ' + m[1] + ' ' + m[2];
  return p;
}
function clauses(txt) { const out = []; const re = /\[([^|\]]+)\|\s*([^\]]+)\]/g; let m; while ((m = re.exec(txt || ''))) out.push([m[1].trim(), m[2].trim()]); return out; }
function baunvo(d) { d = String(d || ''); if (!d) return null; if (d < '1962-08-01') return 'vor der BauNVO'; if (d < '1969-01-01') return 'BauNVO 1962'; if (d < '1977-10-01') return 'BauNVO 1968'; if (d < '1990-01-27') return 'BauNVO 1977'; return 'BauNVO 1990'; }
const dDE = d => String(d || '').split('-').reverse().join('.');
const tsDE = t => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* Speicher */
const KEY = 'gsa-projekte-v1';
let P = {};
try { P = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { P = {}; }
Object.entries(P).forEach(([k, p]) => { p.id = k; if (!p.nrs) p.nrs = [p.nr]; const m = { entwurf: 'neu', pruefung: 'arbeit', voranfrage: 'arbeit', eingereicht: 'erledigt', abgelegt: 'erledigt' }; if (m[p.status]) p.status = m[p.status]; });
function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }

const state = { base: 'map', tabs: [], active: 'map', selIds: [], add: false, hover: null, selB: [], layers: { scan: false, bp: false, brw: false, d3: false }, scanOp: 0.85, mode: 'info', chats: {}, busy: false, sub: {} };
let map = null, byNr = {};
const F = { fl: fcol(), gb: fcol(), nu: fcol(), bg: fcol(), bgr: fcol(), bpl: fcol(), brw: fcol() };
function fcol() { return { type: 'FeatureCollection', features: [] }; }
const API = 'https://api.hamburg.de/datasets/v1/';
const LAYERS = {
  fl: ['alkis_vereinfacht', 'Flurstueck'], gb: ['alkis_vereinfacht', 'GebaeudeBauwerk'], nu: ['alkis_vereinfacht', 'Nutzung'],
  bg: ['xplan', 'bp_baugebietsteilflaeche'], bgr: ['xplan', 'bp_baugrenze'], bpl: ['bplaene', 'hh_hh_festgestellt'], brw: ['uek_normierte_bodenrichtwerte', 'lgv_brw_uek_mfh']
};
const MIN_LOAD_ZOOM = 15;
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

/* Hamburger Felder in die Kurzform der App übersetzen */
function flNr(p) { const z = String(Number(p.flstnrzae) || p.flstnrzae || ''); const nen = String(p.flstkennz || '').slice(14).replace(/_/g, '').replace(/^0+/, ''); return nen ? z + '/' + nen : z; }
function mapProps(k, p) {
  switch (k) {
    case 'fl': return { nr: flNr(p), a: Number(p.flaeche) || 0, lage: p.lagebeztxt || '', tn: String(p.tntxt || '').split(';')[0], gem: p.gemarkung || '', uid: p.idflurst || p.oid || '' };
    case 'gb': { const keep = p.gebnutzbez === 'Gebaeude' && !/Tiefgarage/.test(p.funktion || '') && !/Unter der Erd/.test(p.rellage || '') ? 1 : 0; const gs = Number(p.anzahlgs) || null; return { fn: p.funktion || '', gs, typ: p.gebnutzbez || '', keep, h: (gs || 3) * 3.1 }; }
    case 'nu': return { n: p.nutzart || '' };
    case 'bg': return { plan: p.xpPlanName || '', d: p.xpPlanDate || '', Z: Number(p.Z) || null, GRZ: Number(p.GRZ) || null, GFZ: Number(p.GFZ) || null, GF: Number(p.GF) || null, art: p.besondereArtDerBaulNutzungWert || p.allgArtDerBaulNutzungWert || p.detaillierteArtDerBaulNutzungWert || '', bw: p.bauweiseWert || '', txt: Array.isArray(p.refTextInhalt) ? p.refTextInhalt.join(' ') : (p.refTextInhalt || '') };
    case 'bgr': return { plan: p.xpPlanName || '' };
    case 'bpl': return { plan: p.geltendes_planrecht || '', d: p.feststellungsdatum || '', pdf: p.planrecht || '' };
    case 'brw': return { min: Number(p.minimaler_normierter_brw) || 0, max: Number(p.maximaler_normierter_brw) || 0, st: p.stichtag || '', bb: p.baublock || '' };
  }
  return {};
}
const seen = new Set();
function addFeatures(k, feats) {
  const arr = F[k].features, added = [];
  for (const f of feats) {
    // Bodenrichtwerte: geometry ist nur ein Punkt, die Fläche steckt in properties.geom
    let g = (k === 'brw' && f.properties && f.properties.geom) || f.geometry || (f.properties && f.properties.geom); if (!g) continue;
    const sid = k + '|' + (f.id ?? (f.properties && f.properties.oid) ?? JSON.stringify(g.coordinates).slice(0, 120));
    if (seen.has(sid)) continue; seen.add(sid);
    if (g.type === 'Polygon') g = { type: 'MultiPolygon', coordinates: [g.coordinates] };
    const nf = { type: 'Feature', id: arr.length, geometry: g, properties: mapProps(k, f.properties || {}) };
    if (g.type === 'MultiPolygon') { nf.bb = bbox(g.coordinates); nf.c = centroid(g.coordinates); }
    else if (g.type === 'LineString' || g.type === 'MultiLineString') nf.bb = bboxPts(lines(g).flat());
    else continue;
    if (k === 'gb') nf.area = polyArea(g.coordinates);
    if (k === 'fl') { nf.k = nf.properties.uid || ('fl' + nf.id); byNr[nf.k] = nf; }
    arr.push(nf); added.push(nf);
  }
  return added;
}

/* Nachladen je Kartenausschnitt (Raster aus Zellen, jede Zelle einmal) */
const CW = 0.008, CH = 0.005, cells = new Map();
let busy = 0;
function setBusy(d) { busy += d; const el = $('#busy'); if (el) el.hidden = busy <= 0; }
function cellKeys(b) { const out = []; for (let x = Math.floor(b[0] / CW); x <= Math.floor(b[2] / CW); x++) for (let y = Math.floor(b[1] / CH); y <= Math.floor(b[3] / CH); y++) out.push(x + ':' + y); return out; }
async function fetchLayer(k, bb) {
  const [d, c] = LAYERS[k];
  const r = await fetch(`${API}${d}/collections/${c}/items?f=json&limit=5000&bbox=${bb.map(v => v.toFixed(6)).join(',')}`);
  if (!r.ok) throw new Error(k + ' ' + r.status);
  return (await r.json()).features || [];
}
function loadCell(key) {
  if (cells.has(key)) return cells.get(key);
  const [x, y] = key.split(':').map(Number), bb = [x * CW, y * CH, (x + 1) * CW, (y + 1) * CH];
  let failed = false;
  setBusy(1);
  const pr = Promise.all(Object.keys(LAYERS).map(k => fetchLayer(k, bb).then(fs => [k, addFeatures(k, fs)]).catch(() => { failed = true; return [k, []]; })))
    .then(res => { const add = Object.fromEntries(res); labelsAdd(add.fl || [], add.gb || []); scheduleRefresh(); if (failed) { cells.delete(key); toast('Ein Teil der Hamburger Daten konnte nicht geladen werden.'); } })
    .finally(() => setBusy(-1));
  cells.set(key, pr);
  return pr;
}
function ensureLoaded(b) { const keys = cellKeys(b); return Promise.all(keys.slice(0, 16).map(loadCell)); }
function loadView() {
  const z = map.getZoom(), hint = $('#hint');
  if (z < MIN_LOAD_ZOOM) { if (hint) hint.hidden = false; return; }
  if (hint) hint.hidden = true;
  const b = map.getBounds(); ensureLoaded([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
}
let refreshT = 0;
function scheduleRefresh() {
  clearTimeout(refreshT);
  refreshT = setTimeout(() => {
    ['nu', 'brw', 'bg', 'bgr', 'fl', 'gb'].forEach(k => { const s = map.getSource(k); if (s) s.setData(F[k]); });
    streetLabels();
    if (state.selIds.length && state.mode === 'info') refreshSel(false, true);
  }, 60);
}

function build() {
  map = new maplibregl.Map({
    container: 'map', attributionControl: false, maxPitch: 65,
    center: [10.0036, 53.5846], zoom: 17, minZoom: 10, maxBounds: [[9.55, 53.30], [10.45, 53.80]],
    style: {
      version: 8,
      sources: { base: { type: 'raster', tiles: ['https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png'], tileSize: 256, maxzoom: 18 } },
      layers: [{ id: 'bg0', type: 'background', paint: { 'background-color': '#F3F4F5' } }, { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.9, 'raster-saturation': -1 } }]
    }
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.on('load', async () => {
    addLayers(); labelsInit(); renderPop(); renderTabs();
    map.on('moveend', () => { loadView(); if (state.layers.scan) scanUpdate(); });
    loadView();
    await ensureLoaded([10.0016, 53.5836, 10.0056, 53.5856]);
    if (!state.selIds.length) selectAt([10.003879, 53.585055], true);
  });
}
function parcelAt(ll) { return F.fl.features.find(f => !/^Strassenverkehr|Gewaesser/.test(f.properties.tn) && ll[0] >= f.bb[0] && ll[0] <= f.bb[2] && ll[1] >= f.bb[1] && ll[1] <= f.bb[3] && inPoly(ll, f.geometry.coordinates)); }
function selectAt(ll, initial) { const f = parcelAt(ll); if (f) { if (state.add) toggleSel(f.id); else select(f.id, initial); } return f; }

function addLayers() {
  const src = (id, data) => map.addSource(id, { type: 'geojson', data });
  src('nu', F.nu); src('brw', F.brw); src('bg', F.bg); src('bgr', F.bgr); src('fl', F.fl); src('gb', F.gb);
  src('sel', fcol()); src('selo', fcol()); src('mass', fcol());
  const off = { visibility: 'none' };
  map.addLayer({ id: 'nu', type: 'fill', source: 'nu', paint: { 'fill-color': ['match', ['get', 'n'], 'Strassenverkehr', '#FFFFFF', 'Fliessgewaesser', '#C9DCE8', 'Stehendes Gewaesser', '#C9DCE8', 'Sport Freizeit Und Erholungsflaeche', '#DCE5D8', 'Wald', '#D6E2D0', 'Gehoelz', '#DCE5D8', 'Friedhof', '#DCE5D8', '#F3F4F5'] } });
  map.addLayer({ id: 'brw', type: 'fill', source: 'brw', layout: off, paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'max'], 1000, '#EEE8F7', 8000, '#8F6CCB'], 'fill-opacity': 0.55, 'fill-outline-color': '#7A5BB5' } });
  map.addLayer({ id: 'bp', type: 'fill', source: 'bg', layout: off, paint: { 'fill-color': ['case', ['in', 'Kern', ['get', 'art']], '#D49A96', ['in', 'Wohn', ['get', 'art']], '#F2BDB7', ['in', 'Gewerbe', ['get', 'art']], '#C9C3E3', ['in', 'Misch', ['get', 'art']], '#E7C49A', '#E9D2AE'], 'fill-opacity': 0.42 } });
  map.addLayer({ id: 'bp-line', type: 'line', source: 'bg', layout: off, paint: { 'line-color': '#C0574F', 'line-width': 1, 'line-opacity': 0.6 } });
  map.addLayer({ id: 'fl-fill', type: 'fill', source: 'fl', paint: { 'fill-color': '#E5484D', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.07, 0] } });
  map.addLayer({ id: 'fl', type: 'line', source: 'fl', paint: { 'line-color': '#A3A7AD', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 18, 1], 'line-opacity': 0.7 } });
  map.addLayer({ id: 'sel-fill', type: 'fill', source: 'sel', paint: { 'fill-color': '#E5484D', 'fill-opacity': 0.1 } });
  map.addLayer({ id: 'gb', type: 'fill', source: 'gb', filter: ['==', ['get', 'keep'], 1], paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#B9BDC3', '#D5D7DA'] } });
  map.addLayer({ id: 'gb-line', type: 'line', source: 'gb', filter: ['==', ['get', 'keep'], 1], paint: { 'line-color': '#8F9399', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.4, 18, 1] } });
  map.addLayer({ id: 'bgr', type: 'line', source: 'bgr', layout: off, paint: { 'line-color': '#2F5EB8', 'line-width': 1.6, 'line-dasharray': [3, 1.6] } });
  map.addLayer({ id: 'gb3d', type: 'fill-extrusion', source: 'gb', filter: ['==', ['get', 'keep'], 1], layout: off, paint: { 'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#EE8F92', '#E2E4E7'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } });
  map.addLayer({ id: 'sel-inner', type: 'line', source: 'selo', filter: ['==', ['get', 'k'], 'i'], paint: { 'line-color': '#E5484D', 'line-width': 1.5, 'line-opacity': 0.75, 'line-dasharray': [3, 3] } });
  map.addLayer({ id: 'sel-halo', type: 'line', source: 'selo', filter: ['==', ['get', 'k'], 'o'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 7, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'sel-line', type: 'line', source: 'selo', filter: ['==', ['get', 'k'], 'o'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#E5484D', 'line-width': 3 } });
  map.addLayer({ id: 'mass', type: 'fill-extrusion', source: 'mass', layout: off, paint: { 'fill-extrusion-color': '#E5484D', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.45 } });

  map.on('mousemove', 'fl-fill', e => { const id = e.features[0].id; if (state.hover !== id) { if (state.hover !== null) map.setFeatureState({ source: 'fl', id: state.hover }, { hover: false }); state.hover = id; map.setFeatureState({ source: 'fl', id }, { hover: true }); } map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'fl-fill', () => { if (state.hover !== null) map.setFeatureState({ source: 'fl', id: state.hover }, { hover: false }); state.hover = null; map.getCanvas().style.cursor = ''; });
  map.on('click', 'fl-fill', e => { const id = e.features[0].id, oe = e.originalEvent; if (state.add || oe.shiftKey || oe.metaKey || oe.ctrlKey) toggleSel(id); else select(id, false); });
}

/* Gescannter Bebauungsplan: ein Bild je Ansicht aus dem Hamburger Kartendienst (nur EPSG:25832) */
function scanUpdate() {
  if (!state.layers.scan || map.getZoom() < 14) return;
  const c = map.getCanvas(), b = map.getBounds();
  const pts = [[b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()], [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()]].map(p => proj4('EPSG:4326', 'EPSG:25832', p));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = Math.min(2048, Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1))), H = Math.min(2048, Math.round(W * (y1 - y0) / (x1 - x0)));
  const url = `https://geodienste.hamburg.de/HH_WMS_Cache_Rasterplan?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=bp_raster&STYLES=&SRS=EPSG:25832&BBOX=${x0.toFixed(1)},${y0.toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png&TRANSPARENT=true`;
  const coordinates = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]].map(p => proj4('EPSG:25832', 'EPSG:4326', p));
  const s = map.getSource('scan');
  if (s) s.updateImage({ url, coordinates });
  else {
    map.addSource('scan', { type: 'image', url, coordinates });
    map.addLayer({ id: 'scan', type: 'raster', source: 'scan', paint: { 'raster-opacity': state.scanOp, 'raster-fade-duration': 0 } }, 'brw');
  }
}

/* Beschriftungen: Flurstücksnummern und Geschosse */
function insidePt(f, avoid) {
  const mp = f.geometry.coordinates, b = f.bb, cand = [];
  for (let i = 1; i < 14; i++) for (let j = 1; j < 14; j++) { const pt = [b[0] + (b[2] - b[0]) * i / 14, b[1] + (b[3] - b[1]) * j / 14]; if (inPoly(pt, mp) && !(avoid || []).some(a => inPoly(pt, a.geometry.coordinates))) cand.push(pt); }
  if (inPoly(f.c, mp) && !(avoid || []).some(a => inPoly(f.c, a.geometry.coordinates))) return f.c;
  let pick = null, d = Infinity; cand.forEach(pt => { const dd = (pt[0] - f.c[0]) ** 2 + (pt[1] - f.c[1]) ** 2; if (dd < d) { d = dd; pick = pt; } });
  return pick || f.c;
}
const LBL = { items: [], raf: 0 };
function labelsInit() {
  const host = $('#lbls');
  const upd = () => { LBL.raf = 0; const show = map.getZoom() >= 17 && !state.layers.d3; host.style.display = show ? '' : 'none'; if (!show) return; const b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth(); for (const it of LBL.items) { const [x, y] = it.ll; if (x < w || x > e || y < s || y > n) { if (it.on) { it.el.style.display = 'none'; it.on = false; } continue; } const p = map.project(it.ll); if (!it.on) { it.el.style.display = ''; it.on = true; } it.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%)`; } };
  state.updLabels = () => { if (!LBL.raf) LBL.raf = requestAnimationFrame(upd); };
  map.on('move', state.updLabels); map.on('resize', state.updLabels);
}
function labelsAdd(fls, gbs) {
  const host = $('#lbls');
  fls.forEach(f => { if (/Strassenverkehr|Gewaesser/.test(f.properties.tn)) return; const own = F.gb.features.filter(g => g.properties.keep && g.bb[0] < f.bb[2] && g.bb[2] > f.bb[0] && g.bb[1] < f.bb[3] && g.bb[3] > f.bb[1]); const el = document.createElement('span'); el.textContent = f.properties.nr; el.style.display = 'none'; host.appendChild(el); LBL.items.push({ el, ll: insidePt(f, own), on: false }); });
  gbs.forEach(g => { const gs = g.properties.gs; if (!g.properties.keep || !gs || g.area < 35 || !inPoly(g.c, g.geometry.coordinates)) return; const el = document.createElement('span'); el.className = 'g'; el.textContent = ROM[gs] || gs; el.style.display = 'none'; host.appendChild(el); LBL.items.push({ el, ll: g.c, on: false }); });
  if (state.updLabels) state.updLabels();
}
let streetMarkers = [];
function streetLabels() {
  streetMarkers.forEach(m => m.remove()); streetMarkers = [];
  const best = {};
  F.fl.features.forEach(f => { const p = f.properties; if (!/^Strassenverkehr|Gewaesser/.test(p.tn)) return; const name = p.lage.split(';')[0].trim(); if (!name || /\d/.test(name)) return; if (!best[name] || best[name].a < p.a) best[name] = { a: p.a, f, water: /Gewaesser/.test(p.tn) }; });
  Object.entries(best).forEach(([name, v]) => { const el = document.createElement('div'); el.className = 'lbl' + (v.water ? ' w' : ''); el.textContent = name; streetMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(insidePt(v.f)).addTo(map)); });
}

/* Ebenen */
const LAY = [['scan', 'Bebauungsplan (Scan)', 'Originalplan, lagerichtig'], ['bp', 'Festsetzungen', 'Baugebiete und Baugrenzen, digital'], ['brw', 'Bodenrichtwerte', '€/m² je Baublock'], ['d3', '3D-Ansicht', 'Gebäude und zulässiges Volumen']];
function vis(l, on) { map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'); }
function renderPop() {
  const L = state.layers;
  $('#pop').innerHTML = LAY.map(([k, t, s]) => `<button type="button" class="sw" role="switch" aria-checked="${L[k]}" data-k="${k}"><span>${t}<small>${s}</small></span><i></i></button>` + (k === 'bp' && L.bp ? `<div class="leg"><span><b style="background:#F2BDB7;border:1px solid #C0574F"></b>Wohngebiet</span><span><b style="background:#D49A96;border:1px solid #9E4A44"></b>Kerngebiet</span><span><b style="height:0;border-top:2px dashed #2F5EB8"></b>Baugrenze</span></div>` : '') + (k === 'scan' && L.scan ? `<label class="rng">Deckkraft<input type="range" id="scanop" min="20" max="100" value="${Math.round(state.scanOp * 100)}"></label>` : '')).join('');
  const so = $('#scanop'); if (so) so.addEventListener('input', e => { state.scanOp = e.target.value / 100; if (map.getLayer('scan')) map.setPaintProperty('scan', 'raster-opacity', state.scanOp); });
  $('#pop').querySelectorAll('.sw').forEach(b => b.addEventListener('click', () => setLayer(b.dataset.k)));
}
function setLayer(k) {
  const on = state.layers[k] = !state.layers[k];
  if (k === 'bp') ['bp', 'bp-line', 'bgr'].forEach(l => vis(l, on));
  if (k === 'brw') vis('brw', on);
  if (k === 'scan') { if (on) scanUpdate(); if (map.getLayer('scan')) vis('scan', on); map.setPaintProperty('gb', 'fill-opacity', on ? 0.25 : 1); }
  if (k === 'd3') { vis('gb3d', on); vis('gb', !on); vis('gb-line', !on); vis('mass', on); map.easeTo({ pitch: on ? 58 : 0, bearing: on ? -20 : 0, duration: 900 }); if (state.updLabels) state.updLabels(); }
  renderPop();
}
$('#pop').addEventListener('click', e => e.stopPropagation());
$('#lb').addEventListener('click', e => { e.stopPropagation(); const p = $('#pop'); p.hidden = !p.hidden; $('#lb').setAttribute('aria-expanded', String(!p.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.layers')) { $('#pop').hidden = true; $('#lb').setAttribute('aria-expanded', 'false'); } if (!e.target.closest('.search')) $('#res').classList.remove('open'); });

/* Analyse aus Amtsdaten */
function analyse1(f) {
  const p = f.properties, mp = f.geometry.coordinates, c = f.c, A = p.a;
  const bld = F.gb.features.filter(b => b.properties.keep && inPoly(b.c, mp));
  const built = bld.reduce((s, b) => s + b.area, 0);
  const gfIst = bld.reduce((s, b) => s + b.area * (b.properties.gs || 1), 0);
  const maxGs = bld.reduce((m, b) => Math.max(m, b.properties.gs || 0), 0);
  const festF = F.bg.features.find(b => inPoly(c, b.geometry.coordinates));
  const fest = festF && festF.properties;
  const plans = F.bpl.features.filter(b => inPoly(c, b.geometry.coordinates)).map(b => b.properties).sort((a, b) => String(b.d).localeCompare(String(a.d)));
  const brwF = F.brw.features.find(b => inPoly(c, b.geometry.coordinates));
  const bgrHit = F.bgr.features.some(l => lines(l.geometry).some(L => lineHitsPoly(L, mp)));
  let gfZul = null, grZul = null;
  if (fest) { if (fest.GRZ) grZul = fest.GRZ * A; if (fest.GFZ) gfZul = fest.GFZ * A; else if (fest.GRZ && fest.Z) gfZul = fest.GRZ * A * fest.Z; }
  const bs = !!(fest && /^BS/.test(fest.plan));
  const street = /Strassenverkehr|Gewaesser/.test(p.tn);
  return { p, A, bld, built, gfIst, maxGs, fest, plans, brw: brwF && brwF.properties, gfZul, grZul, bgrHit, bs, street, res: gfZul !== null ? gfZul - gfIst : null };
}
function analyse(fs) {
  const per = fs.map(analyse1);
  if (per.length === 1) return Object.assign(per[0], { per, mixed: false });
  const uniq = (arr, key) => { const m = new Map(); arr.forEach(x => { if (x && !m.has(key(x))) m.set(key(x), x); }); return [...m.values()]; };
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const bld = uniq(per.flatMap(x => x.bld), b => b.id);
  const A = sum(per, 'A');
  const built = bld.reduce((s, b) => s + b.area, 0), gfIst = bld.reduce((s, b) => s + b.area * (b.properties.gs || 1), 0), maxGs = bld.reduce((m, b) => Math.max(m, b.properties.gs || 0), 0);
  const fests = uniq(per.map(x => x.fest), q => [q.plan, q.art, q.Z, q.GRZ, q.GFZ, q.bw].join('|'));
  const fest = per.every(x => x.fest) && fests.length === 1 ? fests[0] : null;
  const gfZul = fest && per.every(x => x.gfZul !== null) ? sum(per, 'gfZul') : null;
  const grZul = fest && per.every(x => x.grZul) ? sum(per, 'grZul') : null;
  const plans = uniq(per.flatMap(x => x.plans), pl => pl.plan + pl.d);
  const bs = per.map(x => x.brw).filter(Boolean);
  const brw = bs.length ? { min: Math.min(...bs.map(b => b.min)), max: Math.max(...bs.map(b => b.max)), st: bs[0].st, bb: [...new Set(bs.map(b => b.bb))].join(', ') } : null;
  return { A, bld, built, gfIst, maxGs, fest, mixed: !fest && fests.length > 0, plans, brw, gfZul, grZul, bgrHit: per.some(x => x.bgrHit), bs: per.some(x => x.bs), street: per.every(x => x.street), res: gfZul !== null ? gfZul - gfIst : null, per };
}
function combo(fs) {
  if (fs.length === 1) return fs[0];
  const mp = fs.flatMap(f => f.geometry.coordinates);
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: mp }, properties: { nr: fs.map(f => f.properties.nr).join(', '), a: fs.reduce((s, f) => s + f.properties.a, 0), lage: multiTitle(fs), gem: fs[0].properties.gem }, c: centroid(mp), bb: bbox(mp) };
}
function multiTitle(fs) { const L = [...new Set(fs.map(f => (f.properties.lage || '').split(';')[0].trim()).filter(Boolean))]; return L.length ? L.slice(0, 2).join(', ') + (L.length > 2 ? ' u. a.' : '') : fs.length + ' Flurstücke'; }
function findProject(fs) { const n = fs.map(f => f.k); return Object.values(P).find(p => p.nrs.length === n.length && n.every(x => p.nrs.includes(x))); }
function massing(fs, r) {
  const feats = [];
  fs.forEach((f, i) => { const q = r.per[i].fest; if (!q || !q.GRZ || !q.Z) return; const k = Math.sqrt(Math.min(1, q.GRZ)), [cx, cy] = f.c; feats.push({ type: 'Feature', properties: { h: q.Z * 3.1 }, geometry: { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(poly => poly.map(ring => ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]))) } }); });
  return { type: 'FeatureCollection', features: feats };
}
const brwTxt = b => b ? (b.min === b.max ? fmt(b.min) : fmt(b.min) + '–' + fmt(b.max)) + ' €/m²' : '–';
const festShort = q => q ? [nice(q.art), q.Z ? (ROM[q.Z] || q.Z) + ' Geschosse' : null, q.GRZ ? 'GRZ ' + fmt(q.GRZ, 1) : null, q.GFZ ? 'GFZ ' + fmt(q.GFZ, 1) : null].filter(Boolean).join(', ') : 'keine digitale Festsetzung';
const EMPTY = { type: 'FeatureCollection', features: [] };
function outlineSegs(fs) {
  const segs = [];
  fs.forEach((f, fi) => f.geometry.coordinates.forEach(poly => poly.forEach(ring => { for (let i = 1; i < ring.length; i++) { const a = ring[i - 1], b = ring[i]; const len = Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY); const n = fs.length > 1 ? Math.max(1, Math.ceil(len / 1.5)) : 1; for (let j = 0; j < n; j++) { const t0 = j / n, t1 = (j + 1) / n; segs.push({ a: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], b: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], fi }); } } })));
  if (fs.length < 2) return { outer: segs.map(s => [s.a, s.b]), inner: [] };
  const orig = fs.map(f => { const L = []; f.geometry.coordinates.forEach(poly => poly.forEach(ring => { for (let i = 1; i < ring.length; i++) L.push([ring[i - 1], ring[i]]); })); return L; });
  const d2 = (p, a, b) => { const px = p[0] * KX, py = p[1] * KY, ax = a[0] * KX, ay = a[1] * KY, dx = b[0] * KX - ax, dy = b[1] * KY - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy; };
  const outer = [], inner = [];
  segs.forEach(s => { const m = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]; const sh = orig.some((L, fi) => fi !== s.fi && L.some(([a, b]) => d2(m, a, b) < 0.8)); (sh ? inner : outer).push([s.a, s.b]); });
  return { outer, inner };
}
function outlineFC(fs) { const o = outlineSegs(fs); return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { k: 'o' }, geometry: { type: 'MultiLineString', coordinates: o.outer } }, { type: 'Feature', properties: { k: 'i' }, geometry: { type: 'MultiLineString', coordinates: o.inner } }] }; }


/* Auswahl auf der Karte, auch mehrere Flurstücke */
function select(id, initial) { state.selIds = [id]; state.mode = 'info'; refreshSel(initial, false); }
function selectMany(ids) { state.selIds = ids.slice(); refreshSel(false, false); }
function toggleSel(id) { const i = state.selIds.indexOf(id); if (i >= 0) state.selIds.splice(i, 1); else state.selIds.push(id); if (!state.selIds.length) { clearSel(); return; } refreshSel(false, true); }
function refreshSel(initial, keepView) {
  const fs = state.selIds.map(i => F.fl.features[i]);
  map.getSource('sel').setData({ type: 'FeatureCollection', features: fs }); map.getSource('selo').setData(outlineFC(fs));
  const r = analyse(fs);
  state.selB.forEach(i => map.setFeatureState({ source: 'gb', id: i }, { sel: false }));
  state.selB = r.bld.map(b => b.id); state.selB.forEach(i => map.setFeatureState({ source: 'gb', id: i }, { sel: true }));
  map.getSource('mass').setData(massing(fs, r));
  renderPanel(fs, r);
  if (keepView) return;
  const b = bbox(fs.flatMap(f => f.geometry.coordinates)), wide = window.innerWidth > 760;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: wide ? { top: 110, bottom: 80, left: 80, right: 420 } : { top: 110, bottom: window.innerHeight * 0.6, left: 30, right: 30 }, maxZoom: 17.6, duration: initial ? 0 : 900 });
}
function clearSel() {
  $('#panel').classList.add('hidden'); state.selIds = []; state.add = false;
  state.selB.forEach(i => map.setFeatureState({ source: 'gb', id: i }, { sel: false })); state.selB = [];
  map.getSource('sel').setData(EMPTY); map.getSource('selo').setData(EMPTY); map.getSource('mass').setData(EMPTY); state.mode = 'info'; $('#panel').classList.remove('chatmode');
}

function renderPanel(fs, r) {
  const panelEl = $('#panel');
  if (state.mode === 'chat') { panelEl.classList.add('chatmode'); panelEl.classList.remove('hidden'); renderChat(panelEl, fs, r, { inPanel: true }); return; }
  panelEl.classList.remove('chatmode');
  const multi = fs.length > 1, q = r.fest, p0 = fs[0].properties, ex = findProject(fs);
  let h = `<div class="pi"><div><div class="meta"><b></b><span>${multi ? fs.length + ' Flurstücke' : 'Flurstück ' + esc(p0.nr)} · ${esc(p0.gem)}</span><button class="x" type="button" id="close" aria-label="Auswahl schließen">×</button></div><h2>${esc(multi ? multiTitle(fs) : (p0.lage || 'ohne Lagebezeichnung'))}</h2>`;
  if (multi) h += `<div class="pchips">${fs.map(f => `<button type="button" class="pchip" data-rm="${f.id}" aria-label="Flurstück ${esc(f.properties.nr)} entfernen">${esc(f.properties.nr)}<span aria-hidden="true">×</span></button>`).join('')}</div>`;
  h += `</div><div class="stats"><div><span>Fläche${multi ? ' gesamt' : ''}</span><strong>${fmt(r.A, r.A < 10 ? 1 : 0)} m²</strong></div><div><span>Bebaut</span><strong>${r.bld.length ? fmt(r.built) + ' m²' : '–'}</strong>${r.bld.length ? `<em>GRZ ${fmt(r.built / r.A, 2)}</em>` : ''}</div><div><span>Bodenrichtwert</span><strong>${r.brw ? brwTxt(r.brw).replace(' €/m²', '') : '–'}</strong>${r.brw ? '<em>€/m²</em>' : ''}</div></div>`;
  if (q) {
    h += `<section><h3>${esc(planName(q.plan))}<small>${esc(String(q.d).slice(0, 4))}</small></h3><dl class="kv">
      <dt>Nutzung</dt><dd>${esc(nice(q.art) || '–')}</dd>
      <dt>Geschosse</dt><dd>${q.Z ? ROM[q.Z] || q.Z : '–'}</dd>
      <dt>GRZ / GFZ</dt><dd>${q.GRZ ? fmt(q.GRZ, 1) : '–'} / ${q.GFZ ? fmt(q.GFZ, 1) : '–'}</dd>
      <dt>Bauweise</dt><dd>${esc(nice(q.bw) || '–')}</dd></dl>`;
    if (r.bs) h += `<p class="note warn">Baustufenplan: Das Maß ergibt sich aus der BPVO 1938, nicht aus GRZ/GFZ.</p>`;
    h += `</section>`;
  } else if (r.mixed) {
    h += `<section><h3>Unterschiedliche Festsetzungen</h3><dl class="kv">${fs.map((f, i) => `<dt>Flst. ${esc(f.properties.nr)}</dt><dd>${esc(festShort(r.per[i].fest))}</dd>`).join('')}</dl></section>`;
  } else if (!r.street) h += `<p class="note warn">Für ${multi ? 'diese Flurstücke' : 'dieses Flurstück'} liegen keine digitalen Festsetzungen vor.</p>`;
  if (!r.street) h += `<button class="btn pri" type="button" id="chatb">${ICON_CHAT}Frag zu ${multi ? 'diesen Grundstücken' : 'diesem Grundstück'}</button><div class="pact"><button class="btn" type="button" id="mk">${ex ? 'Projekt öffnen' : 'Als Projekt anlegen'}</button><button class="btn" type="button" id="addm" aria-pressed="${state.add}">${state.add ? 'Fertig' : '+ Flurstück'}</button></div>`;
  h += state.add ? `<p class="note">Klicke weitere Flurstücke auf der Karte an. Ein zweiter Klick nimmt sie wieder heraus.</p>` : `<p class="foot">Mehrere Flurstücke: „+ Flurstück“ oder Umschalt + Klick.</p>`;
  h += `<p class="foot">Erste Einschätzung aus amtlichen Daten. Ersetzt keine Prüfung durch die Bauaufsicht.</p></div>`;
  const panel = $('#panel'); panel.innerHTML = h; panel.classList.remove('hidden');
  $('#close').addEventListener('click', clearSel);
  panel.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => toggleSel(+b.dataset.rm)));
  const cb = $('#chatb'); if (cb) cb.addEventListener('click', () => { state.mode = 'chat'; state.add = false; renderPanel(fs, r); });
  const am = $('#addm'); if (am) am.addEventListener('click', () => { state.add = !state.add; renderPanel(fs, r); });
  const mk = $('#mk'); if (mk) mk.addEventListener('click', () => { const id = ex ? ex.id : createProject(fs); state.add = false; renderPanel(fs, r); openProject(id); });
}

/* Projekte */
function createProject(fs) {
  const now = Date.now(), nrs = fs.map(f => f.k), labels = fs.map(f => f.properties.nr), id = 'p' + now;
  const title = nrs.length === 1 ? (fs[0].properties.lage || 'Flurstück ' + labels[0]) : multiTitle(fs);
  const b = bbox(fs.flatMap(f => f.geometry.coordinates)), pad = 0.0012;
  P[id] = { id, nrs, labels, gem: fs[0].properties.gem, bbox: [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], title, status: 'neu', f: {}, tasks: [], notes: [{ t: 'Projekt angelegt aus ' + (nrs.length > 1 ? 'Flurstücken ' : 'Flurstück ') + labels.join(', ') + ' (' + fs[0].properties.gem + ').', ts: now, sys: true }], hidden: [], created: now, updated: now };
  const ck = chatKey(fs); if (state.chats[ck]) { P[id].chat = state.chats[ck]; delete state.chats[ck]; }
  save(); toast('Projekt angelegt.'); return id;
}
function touch(p) { p.updated = Date.now(); save(); }
function openProject(id) { if (!state.tabs.includes(id)) state.tabs.push(id); show(id); }
function closeTab(id) { state.tabs = state.tabs.filter(t => t !== id); if (state.active === id) show(state.base); else renderTabs(); }

function show(t) {
  state.active = t;
  const isP = t !== 'map' && t !== 'list';
  $('#v-map').hidden = t !== 'map'; $('#v-list').hidden = t !== 'list'; $('#v-proj').hidden = !isP;
  if (t === 'map' && map) requestAnimationFrame(() => map.resize());
  if (t === 'list') renderList();
  if (isP) renderProject(t);
  document.querySelectorAll('.rail [data-nav]').forEach(b => { if (b.dataset.nav === state.base) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  renderTabs();
}
document.querySelectorAll('.rail [data-nav]').forEach(b => b.addEventListener('click', () => { state.base = b.dataset.nav; show(state.base); }));

function renderTabs() {
  const base = state.base === 'map' ? [ICON_MAP, 'Karte'] : [ICON_DIR, 'Projekte'];
  let h = `<div class="tab${state.active === state.base ? ' on' : ''}"><button type="button" role="tab" aria-selected="${state.active === state.base}" data-t="${state.base}">${base[0]}${base[1]}</button></div>`;
  h += state.tabs.map(nr => `<div class="tab${state.active === nr ? ' on' : ''}"><button type="button" role="tab" aria-selected="${state.active === nr}" data-t="${esc(nr)}"><i class="dot"></i>${esc(P[nr] ? P[nr].title : nr)}</button><button type="button" class="tx" data-close="${esc(nr)}" aria-label="Tab schließen">×</button></div>`).join('');
  $('#tabs').innerHTML = h;
  $('#tabs').querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => show(b.dataset.t)));
  $('#tabs').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeTab(b.dataset.close)));
}

function statusPill(s) { const st = STATUS.find(x => x[0] === s) || STATUS[0]; return `<span class="st" style="--c:${st[2]}">${st[1]}</span>`; }

const loadingP = new Set();
function renderList() {
  const list = Object.values(P).sort((a, b) => b.updated - a.updated);
  let h = `<div class="lh"><h1>Projekte</h1><span class="n">${list.length}</span><button class="btn" type="button" id="neu">Neues Projekt</button></div>`;
  if (!list.length) h += `<div class="empty"><h2>Noch keine Projekte</h2><p>Wähle auf der Karte ein Grundstück und lege es als Projekt an. Dann erscheint es hier.</p><button class="btn pri" type="button" id="tomap">Zur Karte</button></div>`;
  else {
    h += `<div class="cards">` + list.map(p => {
      const fs = p.nrs.map(n => byNr[n]).filter(Boolean);
      if (fs.length < p.nrs.length) { if (p.bbox && !loadingP.has(p.id)) { loadingP.add(p.id); ensureLoaded(p.bbox).then(() => { if (state.active === 'list') renderList(); }); } return `<article class="card" data-nr="${esc(p.id)}" tabindex="0"><div class="cb"><strong>${esc(p.title)}</strong><div class="cm">${statusPill(p.status)}<span>Lädt Daten …</span></div></div></article>`; }
      const r = analyse(fs), f = combo(fs), nq = (p.chat || []).filter(m => m.role === 'user').length, open = p.tasks.filter(x => !x.done).length;
      return `<article class="card" data-nr="${esc(p.id)}" tabindex="0"><div class="th">${lageplan(f, fs)}</div><div class="cb"><strong>${esc(p.title)}</strong><div class="cm">${statusPill(p.status)}<span>Flst. ${esc((p.labels || p.nrs).join(', '))}</span><span>${fmt(r.A)} m²</span></div><div class="cm"><span>${r.fest ? esc(planName(r.fest.plan)) : r.mixed ? 'mehrere Pläne' : 'kein digitaler Plan'}</span>${open ? `<span>· ${open} Aufgabe${open > 1 ? 'n' : ''} offen</span>` : ''}${nq ? `<span>· ${nq} Frage${nq > 1 ? 'n' : ''}</span>` : ''}</div></div><div class="ca"><button class="btn sm" type="button" data-open="${esc(p.id)}">Öffnen</button><button class="btn sm" type="button" data-ask="${esc(p.id)}">${ICON_CHAT}Fragen</button></div></article>`;
    }).join('') + `</div>`;
  }
  const v = $('#v-list'); v.innerHTML = h;
  v.querySelectorAll('.card').forEach(c => { c.addEventListener('click', () => openProject(c.dataset.nr)); c.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === c) openProject(c.dataset.nr); }); });
  v.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); state.sub[b.dataset.ask] = 'chat'; openProject(b.dataset.ask); }));
  v.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openProject(b.dataset.open); }));
  const go = () => { state.base = 'map'; show('map'); toast('Grundstück auf der Karte anklicken.'); };
  const n = $('#neu'); if (n) n.addEventListener('click', go);
  const tm = $('#tomap'); if (tm) tm.addEventListener('click', go);
}

/* Vorschläge: nur aus Daten und eigenen Eingaben abgeleitet */
function suggestions(p, r) {
  const out = [], q = r.fest;
  if (r.res !== null && r.res <= 0) out.push(['gf-over', 'Mehr Geschossfläche nur über Befreiung', `Der Bestand liegt rechnerisch ${fmt(-r.res)} m² über der zulässigen GF. Spielraum über § 31 Abs. 2 oder den Bau-Turbo (§ 246e BauGB) prüfen.`]);
  if (r.res !== null && r.res > 0) out.push(['gf-res', `Rechnerische Reserve von ${fmt(r.res)} m² GF`, 'Aufstockung oder Anbau prüfen. Baugrenzen und Abstandsflächen begrenzen, was davon nutzbar ist.']);
  if (p.f.gf && r.gfZul !== null && p.f.gf > r.gfZul) out.push(['plan-gf', `Geplante GF liegt ${fmt(p.f.gf - r.gfZul)} m² über dem Zulässigen`, 'In der Bauvoranfrage gezielt nach einer Befreiung fragen und die Begründung vorbereiten.']);
  if (r.bgrHit) out.push(['bgr', 'Baugrenze verläuft über das Grundstück', 'Baufenster aus der Planzeichnung übernehmen und die überbaubare Fläche messen.']);
  if (r.bs) out.push(['bs', 'Maß der Nutzung aus der BPVO 1938 ableiten', 'Baustufe in der Planzeichnung nachsehen und in Grundfläche und Geschossfläche übersetzen. Ergänzend § 34 BauGB prüfen.']);
  if (q && !r.bs && baunvo(q.d)) out.push(['baunvo', `${baunvo(q.d)} anwenden`, `Abgeleitet aus dem Planjahr ${String(q.d).slice(0, 4)}. Maßgeblich ist die Fassung zur Zeit der öffentlichen Auslegung, bitte im Plan prüfen.`]);
  if (p.f.kaufpreis && r.brw) out.push(['preis', `Kaufpreis entspricht ${fmt(p.f.kaufpreis / r.A)} €/m² Grundstück`, `Bodenrichtwert hier ${brwTxt(r.brw)}. Bei Bestandsbebauung steckt der Gebäudewert mit drin, der Vergleich ist nur grob.`]);
  if (r.mixed) out.push(['mixed', 'Unterschiedliche Festsetzungen auf den Flurstücken', 'Klären, ob ein gemeinsames Vorhaben über die Plangrenzen hinweg zulässig ist. Das gehört in die Bauvoranfrage.']);
  if (r.per.length > 1) out.push(['verein', 'Vereinigung der Flurstücke prüfen', 'Für ein gemeinsames Vorhaben ist meist eine Vereinigung oder eine öffentlich-rechtliche Sicherung nötig.']);
  out.push(['erh', 'Erhaltungsverordnung und Denkmalschutz prüfen', 'Hamburg stellt beides als Daten bereit. Im Prototyp ist das noch nicht angebunden.']);
  out.push(['vgl', 'Vergleichsfälle in der Nähe suchen', 'Genehmigungen aus dem Transparenzportal zeigen, was in der Umgebung schon durchgegangen ist.']);
  const taken = new Set(p.tasks.map(t => t.src));
  return out.filter(s => !p.hidden.includes(s[0]) && !taken.has(s[0]));
}

function lageplan(f, fs) {
  const W0 = 720, H0 = 360, b = f.bb, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  let w = (b[2] - b[0]) * KX + 40, h = (b[3] - b[1]) * KY + 40;
  if (w / h < W0 / H0) w = h * W0 / H0; else h = w * H0 / W0;
  const view = [cx - w / 2 / KX, cy - h / 2 / KY, cx + w / 2 / KX, cy + h / 2 / KY], k = w / W0;
  const inV = bb => bb[0] < view[2] && bb[2] > view[0] && bb[1] < view[3] && bb[3] > view[1];
  const pt = ([x, y]) => ((x - cx) * KX).toFixed(2) + ' ' + ((cy - y) * KY).toFixed(2);
  const mpath = mp => mp.map(poly => poly.map(r => 'M' + r.map(pt).join('L') + 'Z').join('')).join('');
  let s = `<svg viewBox="${(-w / 2).toFixed(2)} ${(-h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}" role="img" aria-label="Lageplan Flurstück ${esc(f.properties.nr)}"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#F3F4F5"/>`;
  F.nu.features.forEach(n => { if (!inV(n.bb)) return; const c = { Strassenverkehr: '#FFFFFF', Fliessgewaesser: '#C9DCE8', 'Stehendes Gewaesser': '#C9DCE8', 'Sport Freizeit Und Erholungsflaeche': '#DCE5D8' }[n.properties.n]; if (c) s += `<path d="${mpath(n.geometry.coordinates)}" fill="${c}" fill-rule="evenodd"/>`; });
  s += `<path d="${mpath(f.geometry.coordinates)}" fill="rgba(229,72,77,.1)"/>`;
  s += `<path d="${F.fl.features.filter(x => inV(x.bb)).map(x => mpath(x.geometry.coordinates)).join('')}" fill="none" stroke="#A3A7AD" stroke-width="${0.8 * k}"/>`;
  s += `<path d="${F.gb.features.filter(x => x.properties.keep && inV(x.bb)).map(x => mpath(x.geometry.coordinates)).join('')}" fill="#D5D7DA" stroke="#8F9399" stroke-width="${0.8 * k}" fill-rule="evenodd"/>`;
  s += `<path d="${F.bgr.features.filter(x => inV(x.bb)).map(x => lines(x.geometry).map(L => 'M' + L.map(pt).join('L')).join('')).join('')}" fill="none" stroke="#2F5EB8" stroke-width="${1.4 * k}" stroke-dasharray="${5 * k} ${3 * k}"/>`;
  const ol = outlineSegs(fs || [f]), lp = segs => segs.map(([a, b]) => 'M' + pt(a) + 'L' + pt(b)).join('');
  s += `<path d="${lp(ol.inner)}" fill="none" stroke="#E5484D" stroke-opacity=".6" stroke-width="${1.2 * k}" stroke-dasharray="${3 * k} ${2.5 * k}"/><path d="${lp(ol.outer)}" fill="none" stroke="#fff" stroke-width="${6 * k}" stroke-linecap="round"/><path d="${lp(ol.outer)}" fill="none" stroke="#E5484D" stroke-width="${2.6 * k}" stroke-linecap="round"/>`;
  const sx = -w / 2 + 16 * k, sy = h / 2 - 16 * k, len = w > 220 ? 20 : 10;
  s += `<g font-family="Inter,sans-serif" font-size="${11 * k}" fill="#3E4046"><rect x="${sx - 6 * k}" y="${sy - 20 * k}" width="${len + 12 * k + 30 * k}" height="${28 * k}" rx="${5 * k}" fill="#fff" opacity=".9"/><path d="M${sx} ${sy - 4 * k}V${sy}H${sx + len}V${sy - 4 * k}" fill="none" stroke="#16171A" stroke-width="${1.4 * k}"/><text x="${sx + len + 6 * k}" y="${sy}">${len} m</text>`;
  const nx = w / 2 - 22 * k, ny = -h / 2 + 22 * k;
  s += `<circle cx="${nx}" cy="${ny + 3 * k}" r="${17 * k}" fill="#fff" opacity=".92"/><path d="M${nx} ${ny - 10 * k}L${nx + 6 * k} ${ny + 6 * k}L${nx} ${ny + 2 * k}L${nx - 6 * k} ${ny + 6 * k}Z" fill="#16171A"/><text x="${nx}" y="${ny + 20 * k}" text-anchor="middle" font-weight="600">N</text></g></svg>`;
  return s;
}

function renderProject(id) {
  const p = P[id]; if (!p) { closeTab(id); return; }
  const fs = p.nrs.map(n => byNr[n]).filter(Boolean);
  if (fs.length < p.nrs.length) {
    if (p.bbox && !loadingP.has('v' + id)) { loadingP.add('v' + id); $('#v-proj').innerHTML = '<div class="empty"><p>Lade die Hamburger Daten für dieses Projekt …</p></div>'; ensureLoaded(p.bbox).then(() => { if (state.active === id) renderProject(id); }); return; }
    if (!fs.length) { $('#v-proj').innerHTML = '<div class="empty"><h2>Flurstück nicht gefunden</h2><p>Die Hamburger Daten enthalten dieses Flurstück nicht mehr. Vielleicht wurde es geteilt oder neu nummeriert.</p></div>'; return; }
  }
  const f = combo(fs), nr = (p.labels || p.nrs).join(', '), multi = fs.length > 1;
  const r = analyse(fs), q = r.fest, sub = state.sub[id] || 'ueb';
  const sug = suggestions(p, r), open = p.tasks.filter(t => !t.done).length;
  const userNotes = p.notes.filter(n => !n.sys).length;
  let h = `<div class="pm"><div class="phd"><div class="crumb"><button type="button" id="bc">Projekte</button><span>/</span><span>${multi ? 'Flurstücke' : 'Flurstück'} ${esc(nr)}</span></div>
    <div class="trow"><input class="title" id="ti" value="${esc(p.title)}" aria-label="Projektname"><select class="ssel" id="ss" aria-label="Status">${STATUS.map(s => `<option value="${s[0]}"${s[0] === p.status ? ' selected' : ''}>${s[1]}</option>`).join('')}</select><button class="btn" type="button" id="tomap2">Auf Karte zeigen</button><button class="btn pri" type="button" data-soon>Bauvoranfrage erstellen</button></div></div>
    <div class="subt" role="tablist"><button type="button" role="tab" data-s="ueb" aria-selected="${sub === 'ueb'}">Übersicht</button><button type="button" role="tab" data-s="chat" aria-selected="${sub === 'chat'}">Fragen<span>${(p.chat || []).filter(m => m.role === 'user').length || ''}</span></button><button type="button" role="tab" data-s="recht" aria-selected="${sub === 'recht'}">Planungsrecht</button><button type="button" role="tab" data-s="notiz" aria-selected="${sub === 'notiz'}">Notizen<span>${userNotes || ''}</span></button></div><div class="pc">`;

  if (sub === 'ueb') {
    const bw = r.brw ? r.A * (r.brw.min + r.brw.max) / 2 : null;
    h += `<div class="lp">${lageplan(f, fs)}<div class="lpf"><span>Lageplan aus ALKIS, Baugrenzen blau gestrichelt</span><span>Flurstück ${esc(nr)} · ${fmt(r.A)} m²</span></div></div>`;
    h += `<div class="big"><div><span>Grundstück</span><strong>${fmt(r.A)} m²</strong><em>amtlich</em></div>
      <div><span>Zulässige GF</span><strong>${r.gfZul !== null ? fmt(r.gfZul) + ' m²' : '–'}</strong><em>${r.gfZul !== null ? (!q ? 'Summe je Flurstück' : q.GFZ ? 'GFZ ' + fmt(q.GFZ, 1) : 'aus GRZ × Z') : r.mixed ? 'Festsetzungen verschieden' : r.bs ? 'nach BPVO prüfen' : 'nicht festgesetzt'}</em></div>
      <div><span>GF Bestand</span><strong>${r.bld.length ? 'ca. ' + fmt(r.gfIst) + ' m²' : '–'}</strong><em>${r.bld.length ? r.bld.length + ' Gebäude, max. ' + (r.maxGs || '?') + ' Geschosse' : 'unbebaut'}</em></div>
      <div><span>${p.f.kaufpreis ? 'Kaufpreis je m²' : 'Bodenwert'}</span><strong>${p.f.kaufpreis ? fmt(p.f.kaufpreis / r.A) + ' €' : bw ? 'ca. ' + fmt(bw / 1e6, 1) + ' Mio. €' : '–'}</strong><em>${p.f.kaufpreis ? 'BRW ' + brwTxt(r.brw) : bw ? 'Fläche × Bodenrichtwert' : ''}</em></div></div>`;
    if (sug.length) h += `<section><div class="sh"><h3>Vorschläge</h3><small>abgeleitet aus Amtsdaten und deinen Angaben</small></div><div class="sug">${sug.map(s => `<div><div class="tx"><strong>${esc(s[1])}</strong><p>${esc(s[2])}</p></div><div class="ac"><button class="btn sm" type="button" data-take="${s[0]}">Als Aufgabe</button><button class="gh" type="button" data-hide="${s[0]}" aria-label="Vorschlag ausblenden">Ausblenden</button></div></div>`).join('')}</div></section>`;
    h += `<section><div class="sh"><h3>Aufgaben</h3><small>${open ? open + ' offen' : 'alles erledigt'}</small></div><div class="tasks">${p.tasks.map((t, i) => `<label class="task${t.done ? ' done' : ''}"><input type="checkbox" data-chk="${i}"${t.done ? ' checked' : ''}><span>${esc(t.t)}</span>${t.src ? `<em>${t.src === 'ki' ? 'KI' : 'Vorschlag'}</em>` : ''}<button class="gh del" type="button" data-del="${i}" aria-label="Aufgabe löschen">×</button></label>`).join('')}
      <form class="addrow" id="addt"><input id="nt" placeholder="Eigene Aufgabe hinzufügen …" aria-label="Neue Aufgabe"><button class="btn sm" type="submit">Hinzufügen</button></form></div></section>`;
  }

  if (sub === 'recht') {
    const einord = q ? (r.bs ? 'Baustufenplan als übergeleiteter Bebauungsplan, meist einfach (§ 30 Abs. 3), ergänzend § 34 BauGB' : 'Bebauungsplan vorhanden, § 30 BauGB. Ob qualifiziert oder einfach, an der Planzeichnung prüfen.') : r.mixed ? 'Die Flurstücke liegen in unterschiedlichen Festsetzungen. Je Flurstück prüfen.' : 'Kein digitaler Plan gefunden. § 34 oder § 35 BauGB prüfen.';
    h += `<section><div class="sh"><h3>Einordnung</h3></div><div class="checks">
      <div><span class="s chk">prüfen</span><div><strong>Beurteilungsgrundlage</strong><p>${esc(einord)}</p></div></div>
      ${q && !r.bs ? `<div><span class="s chk">prüfen</span><div><strong>${esc(baunvo(q.d))}</strong><p>Aus dem Planjahr ${esc(String(q.d).slice(0, 4))} abgeleitet. Maßgeblich ist die Fassung zur Zeit der öffentlichen Auslegung.</p></div></div>` : ''}
      <div><span class="s ${r.bgrHit ? 'chk' : 'na'}">${r.bgrHit ? 'prüfen' : 'keine Daten'}</span><div><strong>Baufenster</strong><p>${r.bgrHit ? 'Eine Baugrenze verläuft über das Grundstück. Die überbaubare Fläche wird im nächsten Schritt automatisch berechnet.' : 'Keine Baugrenze im Grundstück erfasst.'}</p></div></div></div></section>`;
    if (q) {
      const cl = clauses(q.txt);
      h += `<section><div class="sh"><h3>Festsetzungen</h3><small>${esc(planName(q.plan))}, festgestellt ${esc(dDE(q.d))}</small></div><dl class="kv">
        <dt>Art der Nutzung</dt><dd>${esc(nice(q.art) || '–')}</dd><dt>Vollgeschosse</dt><dd>${q.Z ? ROM[q.Z] || q.Z : 'nicht festgesetzt'}</dd>
        <dt>GRZ</dt><dd>${q.GRZ ? fmt(q.GRZ, 1) : 'nicht festgesetzt'}</dd><dt>GFZ</dt><dd>${q.GFZ ? fmt(q.GFZ, 1) : q.GF ? 'GF ' + fmt(+q.GF) + ' m²' : 'nicht festgesetzt'}</dd>
        <dt>Bauweise</dt><dd>${esc(nice(q.bw) || '–')}</dd></dl>
        ${cl.length ? `<details><summary>Textliche Festsetzungen (${cl.length})</summary>${cl.map(([n, t]) => `<p><strong>${esc(n)}:</strong> ${esc(t)}</p>`).join('')}</details>` : ''}
        ${r.bs ? '<p class="note warn">Baustufenplan: Das Maß der Nutzung ergibt sich aus der Baupolizeiverordnung 1938.</p>' : ''}</section>`;
    }
    h += `<section><div class="sh"><h3>Weitere Prüfpunkte</h3><small>Daten bei Hamburg vorhanden, hier noch nicht angebunden</small></div><div class="checks">
      ${[['Städtebauliche Erhaltungsverordnung', '§ 172 Abs. 1 Nr. 1 BauGB'], ['Soziale Erhaltungsverordnung', '§ 172 Abs. 1 Nr. 2 BauGB'], ['Denkmalschutz', 'Denkmalliste Hamburg'], ['Pläne im Verfahren, Veränderungssperre', '§ 33 und § 14 BauGB']].map(([t, s]) => `<div><span class="s na">offen</span><div><strong>${t}</strong><p>${s}</p></div></div>`).join('')}</div></section>`;
    if (r.mixed) h += `<section><div class="sh"><h3>Festsetzungen je Flurstück</h3></div><dl class="kv">${fs.map((x, i) => `<dt>Flst. ${esc(x.properties.nr)}</dt><dd>${esc(festShort(r.per[i].fest))}</dd>`).join('')}</dl></section>`;
    if (r.plans.length) h += `<section><div class="sh"><h3>Geltende Pläne</h3></div><dl class="kv">${r.plans.map(pl => `<dt>${esc(dDE(pl.d))}</dt><dd><a class="lnk" href="${esc(pl.pdf)}" target="_blank" rel="noopener">${esc(planName(pl.plan))} (PDF)</a></dd>`).join('')}</dl></section>`;
  }

  if (sub === 'chat') h += `<div class="pchat" id="pchat"></div>`;

  if (sub === 'notiz') {
    h += `<form class="notes" id="addn"><textarea id="nn" placeholder="Notiz, Gesprächsvermerk, Telefonat mit dem Bezirksamt …" aria-label="Neue Notiz"></textarea><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn pri" type="submit">Notiz speichern</button></div></form>
      <div class="feed">${p.notes.slice().reverse().map(n => `<div class="${n.sys ? 'sys' : ''}"><time>${tsDE(n.ts)}</time><p>${esc(n.t)}</p></div>`).join('')}</div>`;
  }
  h += `</div></div>`;

  h += `<aside class="ps" aria-label="Eigenschaften"><section><h4>Aus Amtsdaten</h4>
    ${[[multi ? 'Flurstücke' : 'Flurstück', nr], ['Gemarkung', f.properties.gem], ['Fläche', fmt(r.A) + ' m²'], ['Bodenrichtwert', brwTxt(r.brw)], ['Plan', q ? planName(q.plan) : r.mixed ? 'mehrere' : '–'], ['Nutzung', q ? nice(q.art) : r.mixed ? 'unterschiedlich' : '–']].map(([l, v]) => `<div class="fr"><span>${l}</span><div class="v">${esc(v)}</div></div>`).join('')}</section>
    <section><h4>Eigene Angaben</h4>${FIELDS.map(fd => {
      const v = p.f[fd.k] ?? '';
      let inp;
      if (fd.t === 'sel') inp = `<select class="fld" data-k="${fd.k}" aria-label="${fd.l}">${fd.o.map(o => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${o || 'Auswählen'}</option>`).join('')}</select>`;
      else if (fd.t === 'date') inp = `<input class="fld" type="date" data-k="${fd.k}" value="${esc(v)}" aria-label="${fd.l}">`;
      else if (fd.t === 'num') inp = `<div class="fu"><input class="fld" inputmode="numeric" data-k="${fd.k}" data-num value="${v === '' ? '' : fmt(v)}" placeholder="Hinzufügen" aria-label="${fd.l}">${fd.u && v !== '' ? `<small>${fd.u}</small>` : ''}</div>`;
      else inp = `<input class="fld" data-k="${fd.k}" value="${esc(v)}" placeholder="Hinzufügen" aria-label="${fd.l}">`;
      return `<div class="fr"><span>${fd.l}</span>${inp}</div>`;
    }).join('')}</section>
    <section><h4>Verlauf</h4><div class="fr"><span>Angelegt</span><div class="v">${tsDE(p.created)}</div></div><div class="fr"><span>Geändert</span><div class="v">${tsDE(p.updated)}</div></div></section>
    <button class="gh" type="button" id="delp">Projekt löschen</button></aside>`;

  const v = $('#v-proj'); v.innerHTML = h; soon(v);
  const pcEl = $('#pchat'); if (pcEl) renderChat(pcEl, fs, r, {});
  $('#bc').addEventListener('click', () => { state.base = 'list'; show('list'); });
  $('#tomap2').addEventListener('click', () => { state.base = 'map'; show('map'); selectMany(fs.map(x => x.id)); });
  $('#ti').addEventListener('change', e => { p.title = e.target.value.trim() || p.title; touch(p); renderTabs(); });
  $('#ss').addEventListener('change', e => { p.status = e.target.value; const st = STATUS.find(x => x[0] === p.status); p.notes.push({ t: 'Status geändert: ' + st[1], ts: Date.now(), sys: true }); touch(p); });
  v.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { state.sub[id] = b.dataset.s; renderProject(id); }));
  v.querySelectorAll('.fld').forEach(inp => inp.addEventListener('change', e => {
    const k = e.target.dataset.k; let val = e.target.value.trim();
    if (e.target.hasAttribute('data-num')) { val = val.replace(/\./g, '').replace(',', '.'); val = val === '' || isNaN(+val) ? '' : +val; }
    if (val === '') delete p.f[k]; else p.f[k] = val;
    touch(p); renderProject(id);
  }));
  v.querySelectorAll('[data-take]').forEach(b => b.addEventListener('click', () => { const s = sug.find(x => x[0] === b.dataset.take); p.tasks.push({ t: s[1], done: false, src: s[0] }); touch(p); renderProject(id); }));
  v.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => { p.hidden.push(b.dataset.hide); touch(p); renderProject(id); }));
  v.querySelectorAll('[data-chk]').forEach(c => c.addEventListener('change', () => { const t = p.tasks[+c.dataset.chk]; t.done = c.checked; touch(p); renderProject(id); }));
  v.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); p.tasks.splice(+b.dataset.del, 1); touch(p); renderProject(id); }));
  const at = $('#addt'); if (at) at.addEventListener('submit', e => { e.preventDefault(); const t = $('#nt').value.trim(); if (!t) return; p.tasks.push({ t, done: false }); touch(p); renderProject(id); $('#nt').focus(); });
  const an = $('#addn'); if (an) an.addEventListener('submit', e => { e.preventDefault(); const t = $('#nn').value.trim(); if (!t) return; p.notes.push({ t, ts: Date.now() }); touch(p); renderProject(id); });
  $('#delp').addEventListener('click', () => { if (!v.dataset.confirm) { v.dataset.confirm = '1'; $('#delp').textContent = 'Wirklich löschen? Nochmal klicken'; return; } delete P[id]; save(); closeTab(id); toast('Projekt gelöscht.'); });
}

/* Chat zum Grundstück */
const ICON_CHAT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z"/></svg>';
const QUICK = ['Ich möchte anbauen', 'Kann ich aufstocken?', 'Laden in Wohnung umwandeln', 'Abriss und Neubau', 'Ich will kaufen: was geht hier?'];
function md(text) {
  let h = '', ul = false;
  esc(text).split('\n').forEach(l => {
    const b = l.match(/^\s*[-•*]\s+(.*)/);
    if (b) { if (!ul) { h += '<ul>'; ul = true; } h += '<li>' + b[1] + '</li>'; return; }
    if (ul) { h += '</ul>'; ul = false; }
    if (l.trim()) h += '<p>' + l.replace(/^#+\s*/, '') + '</p>';
  });
  if (ul) h += '</ul>';
  return h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function chatKey(fs) { return fs.map(f => f.k).sort().join('+'); }
function chatFor(fs) { const ex = findProject(fs); if (ex) { ex.chat = ex.chat || []; return ex.chat; } const k = chatKey(fs); return state.chats[k] = state.chats[k] || []; }
function ensureProject(fs) { const ex = findProject(fs); return ex || P[createProject(fs)]; }

function neighbors(fs, r) {
  const own = new Set(r.bld.map(b => b.id)), c = combo(fs).c;
  const nb = F.gb.features.filter(b => b.properties.keep && !own.has(b.id) && Math.hypot((b.c[0] - c[0]) * KX, (b.c[1] - c[1]) * KY) < 80);
  if (!nb.length) return null;
  const cnt = {}; nb.forEach(b => { const g = b.properties.gs || '?'; cnt[g] = (cnt[g] || 0) + 1; });
  return `${nb.length} Gebäude; Geschosse: ${Object.entries(cnt).map(([g, n]) => n + '× ' + g).join(', ')}; Funktionen: ${[...new Set(nb.map(b => b.properties.fn))].slice(0, 5).join(', ')}`;
}
function ctxText(fs, r) {
  const f0 = fs[0].properties, ex = findProject(fs), L = [];
  L.push('GRUNDSTÜCK');
  L.push(`- Flurstück${fs.length > 1 ? 'e' : ''}: ${fs.map(f => f.properties.nr).join(', ')} (Gemarkung ${f0.gem}); Lage: ${fs.map(f => f.properties.lage || '–').join(' | ')}`);
  L.push(`- Fläche laut Kataster: ${fmt(r.A)} m²; tatsächliche Nutzung (ALKIS): ${[...new Set(fs.map(f => f.properties.tn))].join(', ')}`);
  L.push('BESTAND (ALKIS; Geschossfläche grob = Grundfläche × Geschosse)');
  L.push(r.bld.length ? `- ${r.bld.length} Gebäude, bebaute Fläche ca. ${fmt(r.built)} m² (GRZ-Ist ${fmt(r.built / r.A, 2)}), Geschossfläche ca. ${fmt(r.gfIst)} m², höchstens ${r.maxGs || '?'} Geschosse; Funktion: ${[...new Set(r.bld.map(b => b.properties.fn))].join(', ')}` : '- unbebaut');
  L.push('PLANUNGSRECHT (XPlanung, je Flurstück)');
  fs.forEach((f, i) => {
    const q = r.per[i].fest;
    if (!q) { L.push(`- Flst. ${f.properties.nr}: keine digitale Festsetzung gefunden`); return; }
    const cl = clauses(q.txt), bs = /^BS/.test(q.plan);
    L.push(`- Flst. ${f.properties.nr}: ${planName(q.plan)}, festgestellt ${dDE(q.d)}${bs ? ' (Baustufenplan, Maß nach Baupolizeiverordnung 1938)' : ' (vermutlich ' + baunvo(q.d) + ')'}; Art: ${nice(q.art) || '–'}; Vollgeschosse: ${q.Z || '–'}; GRZ: ${q.GRZ || '–'}; GFZ: ${q.GFZ || '–'}${q.GF ? '; GF: ' + q.GF + ' m²' : ''}; Bauweise: ${nice(q.bw) || '–'}${cl.length ? '\n  Textliche Festsetzungen: ' + cl.map(([n, x]) => n + ': ' + x).join(' | ') : ''}`);
  });
  L.push(`- Baugrenze oder Baulinie berührt das Grundstück: ${r.bgrHit ? 'ja (genauer Verlauf nur in der Planzeichnung)' : 'keine erfasst'}`);
  if (r.gfZul !== null) L.push(`- Rechnerisch zulässige Geschossfläche: ${fmt(r.gfZul)} m²; Bestand ca. ${fmt(r.gfIst)} m²`);
  if (r.brw) L.push(`BODENRICHTWERT: ${brwTxt(r.brw)} (normierter Wert für Mehrfamilienhäuser, Stichtag ${r.brw.st})`);
  const nb = neighbors(fs, r); if (nb) L.push(`UMGEBUNG (Gebäude im Umkreis von 80 m, ohne eigene): ${nb}`);
  if (ex && Object.keys(ex.f).length) L.push('ANGABEN DES NUTZERS: ' + FIELDS.filter(fd => ex.f[fd.k] !== undefined).map(fd => fd.l + ': ' + ex.f[fd.k] + (fd.u ? ' ' + fd.u : '')).join('; '));
  L.push('NICHT GEPRÜFT (Daten noch nicht angebunden): Erhaltungsverordnungen, Denkmalschutz, Baulasten, Pläne im Verfahren, Altlasten, genaue Abstandsflächen.');
  return L.join('\n');
}
function history(msgs) { return msgs.filter(m => !m.err && !m.pending && m.content).map(m => ({ role: m.role, content: m.content })); }
async function apiChat(fs, r, msgs, onEvent) {
  const resp = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ctx: ctxText(fs, r), messages: history(msgs) }) });
  if (!resp.ok || !resp.body) { let m = 'Das hat nicht geklappt.'; try { m = (await resp.json()).error || m; } catch (e) {} throw new Error(m); }
  const reader = resp.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))); } catch (e) {} } }
  }
}
function renderChat(host, fs, r, o) {
  const msgs = chatFor(fs), multi = fs.length > 1;
  const title = multi ? multiTitle(fs) : (fs[0].properties.lage || 'Flurstück ' + fs[0].properties.nr);
  const hasAI = msgs.some(m => m.role === 'assistant' && !m.pending && !m.err);
  const what = multi ? 'diesen Grundstücken' : 'diesem Grundstück';
  let h = `<div class="chat">`;
  if (o.inPanel) h += `<div class="chd"><button class="gh" type="button" id="cback">← Daten</button><div class="cht"><strong>${esc(title)}</strong><small>${multi ? fs.length + ' Flurstücke' : 'Flurstück ' + esc(fs[0].properties.nr)}</small></div></div>`;
  h += `<div class="msgs"><div class="msg ai"><div class="who">KI</div><div class="bd"><p>Ich kenne für ${multi ? 'diese Flurstücke' : 'dieses Grundstück'} den Bebauungsplan, den Bestand und die Umgebung. Was hast du vor?</p></div></div>`;
  h += msgs.map((m, i) => m.role === 'user'
    ? `<div class="msg me"><div class="bd">${esc(m.content)}</div></div>`
    : `<div class="msg ai" data-i="${i}"><div class="who">KI</div><div class="bd">${m.pending && !m.content ? '<p class="think">Denkt nach …</p>' : md(m.content)}</div>${!m.pending && !m.err ? `<div class="mact"><button class="gh" type="button" data-note="${i}">Als Notiz speichern</button></div>` : ''}</div>`).join('');
  h += `</div>`;
  if (!msgs.length) h += `<div class="quick">${QUICK.map(q => `<button type="button" class="qchip">${esc(q)}</button>`).join('')}</div>`;
  h += `<form class="cin"><textarea rows="1" placeholder="Frag etwas zu ${what} …" aria-label="Frage"></textarea><button class="btn pri" type="submit"${state.busy ? ' disabled' : ''}>Senden</button></form>`;
  h += `<div class="cft"><span>${state.kbOk ? '<span class="kb">Wissensbasis verbunden</span> · ' : ''}Ersteinschätzung durch KI, keine Genehmigung.</span>${hasAI ? '<button class="gh" type="button" data-tasks>Aufgaben ins Projekt</button>' : ''}</div></div>`;
  host.innerHTML = h;
  const box = host.querySelector('.msgs'); box.scrollTop = box.scrollHeight;
  const ta = host.querySelector('textarea'), form = host.querySelector('form');
  const rerender = () => renderChat(host, fs, r, o);
  const back = host.querySelector('#cback'); if (back) back.addEventListener('click', () => { state.mode = 'info'; renderPanel(fs, r); });
  host.querySelectorAll('.qchip').forEach(b => b.addEventListener('click', () => send(b.textContent)));
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); send(ta.value); });
  if (!o.inPanel || state.mode === 'chat') setTimeout(() => ta.focus(), 0);
  host.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', () => {
    const p = ensureProject(fs); p.notes.push({ t: 'KI-Antwort: ' + msgs[+b.dataset.note].content, ts: Date.now() }); touch(p); toast('Als Notiz im Projekt gespeichert.'); renderTabs();
  }));
  const tb = host.querySelector('[data-tasks]'); if (tb) tb.addEventListener('click', async () => {
    tb.disabled = true; tb.textContent = 'Wird erstellt …';
    try {
      const resp = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'tasks', ctx: ctxText(fs, r), messages: history(msgs) }) });
      const j = await resp.json(); if (!resp.ok) throw new Error(j.error);
      const list = (j.tasks || []).filter(x => typeof x === 'string');
      const p = ensureProject(fs); list.forEach(x => p.tasks.push({ t: x.slice(0, 160), done: false, src: 'ki' })); touch(p);
      toast(list.length ? `${list.length} Aufgaben ins Projekt übernommen.` : 'Keine Aufgaben gefunden.');
    } catch (e) { toast('Aufgaben konnten nicht erstellt werden.'); }
    rerender(); renderTabs();
  });

  async function send(text) {
    text = String(text || '').trim(); if (!text || state.busy) return;
    state.busy = true;
    msgs.push({ role: 'user', content: text, ts: Date.now() });
    const ai = { role: 'assistant', content: '', pending: true, ts: Date.now() }; msgs.push(ai);
    const idx = msgs.length - 1; rerender();
    const paint = note => { const el = host.querySelector(`.msg.ai[data-i="${idx}"] .bd`); if (!el) return; el.innerHTML = (ai.content ? md(ai.content) : '') + (note ? `<p class="think">${esc(note)}</p>` : ''); const bx = host.querySelector('.msgs'); bx.scrollTop = bx.scrollHeight; };
    try {
      await apiChat(fs, r, msgs.slice(0, -1), ev => {
        if (ev.t) { ai.content += ev.t; paint(); }
        else if (ev.tool) paint(ev.tool === 'lies_fundstelle' ? `Liest ${ev.q} …` : `Sucht in der Wissensbasis: ${ev.q} …`);
        else if (ev.done) { if (ev.kb) state.kbOk = true; }
        else if (ev.error) throw new Error(ev.error);
      });
      if (!ai.content) { ai.err = true; ai.content = 'Keine Antwort erhalten. Bitte noch einmal versuchen.'; }
    } catch (e) { ai.err = true; ai.content = (ai.content ? ai.content + '\n\n' : '') + (e.message || 'Das hat nicht geklappt. Bitte noch einmal versuchen.'); }
    ai.pending = false; state.busy = false;
    const ex = findProject(fs); if (ex) touch(ex);
    rerender();
  }
}

/* Suche */
const q = $('#q'), res = $('#res');
let hits = [], cur = 0;
let sTimer = 0, sSeq = 0;
function search() {
  const t = q.value.trim(); clearTimeout(sTimer);
  if (t.length < 3) { res.classList.remove('open'); return; }
  sTimer = setTimeout(async () => {
    const my = ++sSeq, m = t.match(/^(.*?)[\s,]+(\d+\s*[a-zA-Z]?)\s*$/);
    const street = (m ? m[1] : t).replace(/str\.?$/i, 'straße').trim(), nr = m ? m[2].replace(/\s/g, '') : '';
    const url = `${API}gages_vereinfacht/collections/hauskoordinaten/items?f=json&limit=8&strassenname=${encodeURIComponent(street + '*')}` + (nr ? `&hausnummer=${encodeURIComponent(nr + '*')}` : '');
    let feats = []; try { feats = (await (await fetch(url)).json()).features || []; } catch (e) {}
    if (my !== sSeq) return;
    hits = feats.map(f => ({ label: `${f.properties.strassenname} ${f.properties.hausnummer || ''}`.trim(), sub: `${f.properties.postleitzahl || ''} ${f.properties.postOrtsteil || ''}`.trim(), ll: f.geometry.coordinates })); cur = 0;
    res.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span>${esc(h.label)}</span><small>${esc(h.sub)}</small></button>`).join('') : '<p style="margin:8px 10px;color:#5A5C63">Keine Hamburger Adresse gefunden.</p>';
    res.classList.add('open');
    res.querySelectorAll('button').forEach(b => b.addEventListener('click', () => go(+b.dataset.i)));
  }, 250);
}
async function go(i) {
  const h = hits[i]; if (!h) return; res.classList.remove('open'); q.value = h.label;
  if (state.active !== 'map') { state.base = 'map'; show('map'); }
  map.jumpTo({ center: h.ll, zoom: Math.max(map.getZoom(), 17.2) });
  await ensureLoaded([h.ll[0] - 0.002, h.ll[1] - 0.0012, h.ll[0] + 0.002, h.ll[1] + 0.0012]);
  if (!selectAt(h.ll, false)) toast('Zu dieser Adresse wurde kein Flurstück gefunden.');
}
q.addEventListener('input', search);
q.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); if (hits.length) go(cur); }
  if (e.key === 'Escape') res.classList.remove('open');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, Math.min(hits.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))); res.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === cur)); }
});
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (state.active !== 'map') { state.base = 'map'; show('map'); } q.focus(); q.select(); } });
build();
