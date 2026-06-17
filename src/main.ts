import { createMap, applyMapTheme, type MapMode } from './map';
import { ShadowLayer } from './shadow-layer';
import { TileManager } from './tile-manager';
import { initTimeControls } from './ui';
import { initSearch } from './search';
import { initSunControl } from './sun-control';

const map = createMap('map');
const shadow = new ShadowLayer();

// Expose the map immediately (before init) so headless/automated environments that throttle
// requestAnimationFrame can pump map._render() to drive style loading. Harmless in production.
(window as unknown as { __map: unknown }).__map = map;

let initialized = false;
let tileManager: TileManager | undefined;
let mapMode: MapMode | undefined;

// Switch the basemap to dark mode whenever the sun is below the horizon (after sunset /
// before sunrise) for the selected day, and back to light during daytime. SunCalc gives the
// altitude per date+time, so the cutover follows each day's real sunset/sunrise. Only re-themes
// on an actual day↔night flip to avoid recoloring on every slider tick.
const syncMapMode = (sunAltitude: number) => {
  const mode: MapMode = sunAltitude <= 0 ? 'night' : 'day';
  if (mode === mapMode) return;
  mapMode = mode;
  applyMapTheme(map, mode);
};

// The style is safe to mutate (add layers, recolor) once its JSON is parsed and the layers
// exist — signalled by the 'style.load' event. We deliberately do NOT gate on
// `map.isStyleLoaded()`: that also requires the vector *source tiles* to finish loading, which
// in throttled/headless environments may never happen, blocking init forever even though every
// layer is already present. Presence of a known base layer is the reliable readiness check.
const styleReady = () => map.isStyleLoaded() || !!map.getLayer('background');

const init = () => {
  if (initialized) return;
  if (!styleReady()) return;
  initialized = true;
  applyMapTheme(map, 'day');
  mapMode = 'day';
  map.addLayer(shadow);
  tileManager = new TileManager(map, shadow);
  const sunControl = initSunControl(document.getElementById('sun-control')!, (newDate) => {
    timeControls.setCurrent(newDate);
  });
  const timeControls = initTimeControls((sun, date) => {
    shadow.setSun(sun, date);
    syncMapMode(sun.altitude);
    // Deciduous trees in Berlin: roughly leaf-on May–October, bare Nov–April.
    const month = date.getMonth();
    tileManager?.setLeafOn(month >= 4 && month <= 9);
    sunControl.update(sun, date);
  });
  initSearch(map);
  map.triggerRepaint();
  (window as unknown as { __shadow: unknown; __tiles: unknown }).__shadow = shadow;
  (window as unknown as { __shadow: unknown; __tiles: unknown }).__tiles = tileManager;
};

map.on('style.load', init);
map.on('load', init);
init();

// Some headless preview environments throttle requestAnimationFrame whenever the tab is
// considered hidden, which prevents the map's dirty flags from clearing and stalls
// 'load' indefinitely. We detect the stall (no RAF callback for 500ms) and pump renders
// manually. In a real visible browser tab this branch never trips.
let lastRaf = performance.now();
const watchRaf = (t: number) => { lastRaf = t; requestAnimationFrame(watchRaf); };
requestAnimationFrame(watchRaf);
setInterval(() => {
  if (performance.now() - lastRaf < 500) return;
  if (!initialized && map.isStyleLoaded()) init();
  (map as unknown as { _render?: (t: number) => void })._render?.(performance.now());
}, 200);
