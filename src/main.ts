import { createMap, applyMapTheme, type MapMode } from './map';
import { ShadowLayer } from './shadow-layer';
import { TileManager } from './tile-manager';
import { initSearch } from './search';
import { initSunPositionTracker } from './sun-position-tracker';
import { getSunPosition } from './sun';

const LAT = 52.5163;
const LNG = 13.3777;

const map = createMap('map');
const shadow = new ShadowLayer();

(window as unknown as { __map: unknown }).__map = map;

initSearch(map);

let initialized = false;
let tileManager: TileManager | undefined;
let mapMode: MapMode | undefined;
let currentDate = new Date();

const syncMapMode = (sunAltitude: number) => {
  const mode: MapMode = sunAltitude <= 0 ? 'night' : 'day';
  if (mode === mapMode) return;
  mapMode = mode;
  applyMapTheme(map, mode);
};

const styleReady = () => map.isStyleLoaded() || !!map.getLayer('background');

const updateSun = (date: Date) => {
  currentDate = date;
  const sun = getSunPosition(date, LAT, LNG);
  shadow.setSun(sun, date);
  syncMapMode(sun.altitude);
  tileManager?.setLeafOn(date.getMonth() >= 4 && date.getMonth() <= 9);
};

const init = () => {
  if (initialized) return;
  if (!styleReady()) return;
  initialized = true;
  applyMapTheme(map, 'day');
  mapMode = 'day';
  map.addLayer(shadow);
  tileManager = new TileManager(map, shadow);

  // Sun position tracker
  const sunTracker = initSunPositionTracker(document.getElementById('sun-tracker')!, (date) => {
    currentDate = date;
    updateSun(date);
  });

  // Initial update
  updateSun(currentDate);
  sunTracker.update(currentDate);

  map.triggerRepaint();
  (window as unknown as { __shadow: unknown; __tiles: unknown }).__shadow = shadow;
  (window as unknown as { __shadow: unknown; __tiles: unknown }).__tiles = tileManager;
};

map.on('style.load', init);
map.on('load', init);
init();

// Headless RAF pump
let lastRaf = performance.now();
const watchRaf = (t: number) => { lastRaf = t; requestAnimationFrame(watchRaf); };
requestAnimationFrame(watchRaf);
setInterval(() => {
  if (performance.now() - lastRaf < 500) return;
  if (!initialized && map.isStyleLoaded()) init();
  (map as unknown as { _render?: (t: number) => void })._render?.(performance.now());
}, 200);
