import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import proj4 from 'proj4';
import { loadLod2Tile } from './lod2';
import { loadTreeTile, type TreeTile } from './trees';
import { ShadowLayer } from './shadow-layer';

proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const TILE_SIZE_M = 1000;
const MIN_LOAD_RADIUS_M = 1500;
const MAX_LOAD_RADIUS_M = 9000;
const UNLOAD_MARGIN_M = 1500;
const MAX_CONCURRENT_LOADS = 4;

type TileState =
  | { status: 'loading' }
  | { status: 'loaded'; group: THREE.Group; trees?: TreeTile }
  | { status: 'missing' };

export class TileManager {
  private tiles = new Map<string, TileState>();
  private activeLoads = 0;
  private leafOn = true;

  setLeafOn(leafOn: boolean) {
    if (this.leafOn === leafOn) return;
    this.leafOn = leafOn;
    for (const state of this.tiles.values()) {
      if (state.status === 'loaded') state.trees?.setLeafOn(leafOn);
    }
    this.map.triggerRepaint();
  }

  constructor(
    private map: maplibregl.Map,
    private shadow: ShadowLayer,
  ) {
    this.map.on('moveend', () => this.update());
    this.map.on('zoomend', () => this.update());
    // Pump shadow recenter during drag too, so the frustum tracks the view smoothly.
    this.map.on('move', () => this.updateShadowCenter());
    this.update();
  }

  private updateShadowCenter() {
    // Anchor the shadow + on-map compass at map.getCenter() — MapLibre's screen-centre look-at
    // point. Use the renderer's OWN mercator projection (projectToScene) rather than proj4/UTM:
    // UTM meters diverge from the mercator-linear scene transform by ~10m a few km out, which
    // made the compass creep off-centre as you zoomed in. Mercator pins it exactly to centre.
    const { lng, lat } = this.map.getCenter();
    const zoom = this.map.getZoom();
    const [sx, sy] = this.shadow.projectToScene(lng, lat);
    this.shadow.setShadowCenter(sx, sy);
    this.shadow.setShadowHalfExtent(shadowExtentForZoom(zoom));
    // Keep the compass a roughly constant on-screen size. MapLibre uses 512px tiles, so
    // metres-per-pixel = 78271.52·cos(lat)/2^zoom. ~140 px radius, clamped for sanity.
    const mpp = (78271.52 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
    this.shadow.setCompassWorldRadius(Math.max(25, Math.min(140 * mpp, 1500)));
  }

  private update() {
    // Shadow frustum + compass centring/scaling (mercator-accurate — see updateShadowCenter).
    this.updateShadowCenter();

    // Tile selection stays in UTM, because tile filenames are UTM-kilometre indices.
    const { lng, lat } = this.map.getCenter();
    const [centerX, centerY] = proj4('WGS84', 'EPSG:25833', [lng, lat]) as [number, number];
    const halfExtent = shadowExtentForZoom(this.map.getZoom());

    // Load tiles wherever the shadow camera can reach, so casters exist in the scene.
    const loadRadius = Math.max(MIN_LOAD_RADIUS_M, Math.min(halfExtent + 500, MAX_LOAD_RADIUS_M));
    const unloadRadius = loadRadius + UNLOAD_MARGIN_M;

    const tilesWanted = new Set<string>();
    const minX = Math.floor((centerX - loadRadius) / TILE_SIZE_M);
    const maxX = Math.floor((centerX + loadRadius) / TILE_SIZE_M);
    const minY = Math.floor((centerY - loadRadius) / TILE_SIZE_M);
    const maxY = Math.floor((centerY + loadRadius) / TILE_SIZE_M);

    for (let tx = minX; tx <= maxX; tx++) {
      for (let ty = minY; ty <= maxY; ty++) {
        const cx = tx * TILE_SIZE_M + TILE_SIZE_M / 2;
        const cy = ty * TILE_SIZE_M + TILE_SIZE_M / 2;
        if (Math.hypot(cx - centerX, cy - centerY) > loadRadius + TILE_SIZE_M) continue;
        tilesWanted.add(`${tx}_${ty}`);
      }
    }

    for (const tileId of tilesWanted) {
      if (this.tiles.has(tileId)) continue;
      if (this.activeLoads >= MAX_CONCURRENT_LOADS) break;
      this.startLoad(tileId);
    }

    for (const [tileId, state] of this.tiles) {
      const [tx, ty] = tileId.split('_').map(Number);
      const cx = tx * TILE_SIZE_M + TILE_SIZE_M / 2;
      const cy = ty * TILE_SIZE_M + TILE_SIZE_M / 2;
      if (Math.hypot(cx - centerX, cy - centerY) <= unloadRadius) continue;
      if (state.status === 'loaded') this.unload(tileId, state.group);
      else if (state.status === 'missing') this.tiles.delete(tileId);
    }
  }


  private startLoad(tileId: string) {
    this.tiles.set(tileId, { status: 'loading' });
    this.activeLoads++;
    const buildings = loadLod2Tile(`/tiles/LoD2_${tileId}.glb`).catch(() => null);
    const trees = loadTreeTile(`/tiles/Trees_${tileId}.bin`).catch(() => null);
    Promise.all([buildings, trees])
      .then(([group, treeTile]) => {
        // Buildings missing AND trees missing → this tile genuinely doesn't exist.
        if (!group && !treeTile) {
          this.tiles.set(tileId, { status: 'missing' });
          return;
        }
        // Trees are only meaningful where buildings exist (otherwise we'd render floating
        // trees on an empty basemap). If buildings 404'd, drop the trees too.
        const wrapper = new THREE.Group();
        if (group) wrapper.add(group);
        if (treeTile && group) {
          wrapper.add(treeTile.group);
          treeTile.setLeafOn(this.leafOn);
        }
        this.shadow.add(wrapper);
        this.tiles.set(tileId, {
          status: 'loaded',
          group: wrapper,
          trees: group && treeTile ? treeTile : undefined,
        });
        this.map.triggerRepaint();
      })
      .finally(() => {
        this.activeLoads--;
        this.update();
      });
  }

  private unload(tileId: string, group: THREE.Group) {
    this.shadow.remove(group);
    const state = this.tiles.get(tileId);
    if (state?.status === 'loaded') state.trees?.dispose();
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
      }
    });
    this.tiles.delete(tileId);
  }
}

// Shadow frustum size by zoom — tuned so the frustum slightly exceeds a typical desktop
// viewport's ground footprint at each zoom level. Anchor is the screen-centre look-at point,
// so this only needs to cover what's around the centre, not all the way to the horizon.
function shadowExtentForZoom(zoom: number): number {
  if (zoom >= 17) return 1500;
  if (zoom >= 16) return 2500;
  if (zoom >= 15) return 4000;
  if (zoom >= 14) return 6000;
  return 9000;
}
