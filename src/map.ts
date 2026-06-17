import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const BERLIN_CENTER: [number, number] = [13.3777, 52.5163];

export function createMap(container: string): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    // Positron is a clean, light base that sits well under the 3D buildings + shadows. We
    // recolor its water/park/road layers (themeMap) for a livelier look while keeping it elegant.
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: BERLIN_CENTER,
    zoom: 16.5,
    pitch: 60,
    bearing: -20,
    antialias: true,
    maxPitch: 75,
    hash: 'view',
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.addControl(new CompassControl(), 'bottom-right');

  return map;
}

// A cardinal-direction (N/E/S/W) compass dial that rotates with the map bearing and resets to
// north on click. MapLibre's built-in NavigationControl compass is only a north arrow, so this
// is a small custom IControl for the explicit N/S/E/W readout.
class CompassControl implements maplibregl.IControl {
  private map?: maplibregl.Map;
  private container?: HTMLDivElement;
  private dial?: HTMLDivElement;
  private readonly onRotate = () => this.sync();

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map;
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl compass-ctrl';
    container.title = 'Reset bearing to north';

    const dial = document.createElement('div');
    dial.className = 'compass-dial';
    dial.innerHTML =
      '<span class="compass-dir compass-n">N</span>' +
      '<span class="compass-dir compass-e">E</span>' +
      '<span class="compass-dir compass-s">S</span>' +
      '<span class="compass-dir compass-w">W</span>' +
      '<span class="compass-needle"></span>';
    container.appendChild(dial);
    this.container = container;
    this.dial = dial;

    container.addEventListener('click', () => {
      map.easeTo({ bearing: 0, pitch: map.getPitch(), duration: 300 });
    });

    map.on('rotate', this.onRotate);
    this.sync();
    return container;
  }

  onRemove(): void {
    this.map?.off('rotate', this.onRotate);
    this.container?.remove();
    this.map = undefined;
  }

  private sync(): void {
    if (!this.map || !this.dial) return;
    // Counter-rotate the dial so N always points to true north on screen.
    this.dial.style.transform = `rotate(${-this.map.getBearing()}deg)`;
  }
}

// Recolor the positron basemap so rivers, parks and avenues read with life — tuned to sit
// alongside the app's warm palette (honey/apricot) rather than a generic OSM-bright look.
// Two palettes: a clean light DAY theme and a dark NIGHT theme (applied automatically after
// sunset — see main.ts). Switching just recolors layers (no style reload).
export type MapMode = 'day' | 'night';

type Palette = {
  background: string;
  residential: string;
  park: string;
  wood: string;
  water: string;
  waterway: string;
  motorway: string;
  motorwayCasing: string;
  major: string;
  majorCasing: string;
  minor: string;
  building: string;
  labelText: string;
  labelHalo: string;
};

const DAY: Palette = {
  background: '#eef0ec',
  residential: '#e9e7df',
  park: '#c2ddaa',
  wood: '#a8cd8a',
  water: '#8fbfe6',
  waterway: '#6fa8d4',
  motorway: '#f4c873',
  motorwayCasing: '#e0ad52',
  major: '#f7d9a3',
  majorCasing: '#e6c078',
  minor: '#ffffff',
  building: '#e4ded3',
  labelText: '#3b3a36',
  labelHalo: 'rgba(255,255,255,0.9)',
};

// Night: deep onyx/indigo land + water, dim green parks, warm dimmed avenues that still glow
// like lit boulevards, light label text on dark halo. Matches the app's onyx/honey palette.
const NIGHT: Palette = {
  background: '#0f1219',
  residential: '#161a23',
  park: '#1e3326',
  wood: '#192c20',
  water: '#16273f',
  waterway: '#33506f',
  motorway: '#c79f57',
  motorwayCasing: '#7c5f30',
  major: '#9c8559',
  majorCasing: '#6c5937',
  minor: '#363b46',
  building: '#1a1e29',
  labelText: '#cfd3dc',
  labelHalo: 'rgba(8,11,18,0.92)',
};

// Symbol layers whose text should flip light/dark with the theme (legible on both bases).
const LABEL_LAYERS = [
  'waterway_line_label', 'water_name_point_label', 'water_name_line_label',
  'highway-name-path', 'highway-name-minor', 'highway-name-major',
  'label_other', 'label_village', 'label_town', 'label_state',
  'label_city', 'label_city_capital', 'label_country_3', 'label_country_2', 'label_country_1',
];

// The remaining road/rail/path line layers positron draws in light grey/white — invisible-by-day
// but glaring white lines at night. Each gets its positron default by day and a dark value at
// night. `day` values are the originals read from the positron style.
const EXTRA_ROAD_LINES: { id: string; day: string; night: string }[] = [
  { id: 'highway_path', day: 'rgb(234,234,234)', night: '#262b34' },
  { id: 'highway_major_subtle', day: 'hsla(0,0%,85%,0.69)', night: '#3a4150' },
  { id: 'highway_motorway_subtle', day: 'hsla(0,0%,85%,0.53)', night: '#3a4150' },
  { id: 'highway_motorway_bridge_casing', day: 'rgb(213,213,213)', night: '#5c4a26' },
  { id: 'highway_motorway_bridge_inner', day: '#ffffff', night: '#c79f57' },
  { id: 'tunnel_motorway_casing', day: 'rgb(213,213,213)', night: '#5c4a26' },
  { id: 'tunnel_motorway_inner', day: 'rgb(234,234,234)', night: '#7a5f33' },
  { id: 'road_pier', day: 'rgb(242,243,240)', night: '#262b34' },
  { id: 'railway', day: '#dddddd', night: '#363b46' },
  { id: 'railway_dashline', day: '#fafafa', night: '#4a5160' },
  { id: 'railway_service', day: '#dddddd', night: '#2f343d' },
  { id: 'railway_service_dashline', day: '#fafafa', night: '#3f4552' },
  { id: 'railway_transit', day: '#dddddd', night: '#363b46' },
  { id: 'railway_transit_dashline', day: '#fafafa', night: '#4a5160' },
];

// Safe to call once the style is loaded; each layer is guarded in case the schema shifts.
export function applyMapTheme(map: maplibregl.Map, mode: MapMode) {
  const p = mode === 'night' ? NIGHT : DAY;
  const paint = (id: string, prop: string, value: unknown) => {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop, value as never); } catch { /* layer schema drift */ }
    }
  };

  paint('background', 'background-color', p.background);
  paint('landuse_residential', 'fill-color', p.residential);
  paint('park', 'fill-color', p.park);
  paint('park', 'fill-opacity', 0.85);
  paint('landcover_wood', 'fill-color', p.wood);
  paint('landcover_wood', 'fill-opacity', 0.85);
  paint('water', 'fill-color', p.water);
  paint('waterway', 'line-color', p.waterway);
  paint('highway_motorway_inner', 'line-color', p.motorway);
  paint('highway_motorway_casing', 'line-color', p.motorwayCasing);
  paint('highway_major_inner', 'line-color', p.major);
  paint('highway_major_casing', 'line-color', p.majorCasing);
  paint('highway_minor', 'line-color', p.minor);
  paint('building', 'fill-color', p.building);

  for (const id of LABEL_LAYERS) {
    paint(id, 'text-color', p.labelText);
    paint(id, 'text-halo-color', p.labelHalo);
  }

  for (const r of EXTRA_ROAD_LINES) {
    paint(r.id, 'line-color', mode === 'night' ? r.night : r.day);
  }
}
