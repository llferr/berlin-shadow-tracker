import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import type { CustomLayerInterface } from 'maplibre-gl';
import type { mat4 } from 'gl-matrix';
import { sunDirection, type SunPosition } from './sun';
import { createSunCompass, type SunCompass } from './sun-compass';

const BERLIN_ORIGIN: [number, number] = [13.3777, 52.5163];

export class ShadowLayer implements CustomLayerInterface {
  readonly id = 'shadow-layer';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: maplibregl.Map;
  private camera!: THREE.Camera;
  private scene!: THREE.Scene;
  private renderer!: THREE.WebGLRenderer;
  private sceneRoot!: THREE.Group;
  private sun!: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  private hemi!: THREE.HemisphereLight;
  private metersToMercator!: number;
  private originMc!: maplibregl.MercatorCoordinate;
  private mercatorMatrix = new THREE.Matrix4();

  private currentSun: SunPosition = { altitude: Math.PI / 4, azimuth: 0 };
  private shadowCenter: [number, number] = [0, 0];
  private compass!: SunCompass;
  private currentDate: Date = new Date();

  getOriginLngLat(): [number, number] {
    return BERLIN_ORIGIN;
  }

  setSun(sun: SunPosition, date?: Date) {
    this.currentSun = sun;
    if (date) this.currentDate = date;
    if (this.sun) {
      this.updateSunLight();
      this.compass?.update(this.currentSun, this.currentDate);
      this.map?.triggerRepaint();
    }
  }

  /** Re-anchor the shadow camera frustum AND the on-map sun compass on the given
   *  scene-local point (meters). */
  setShadowCenter(x: number, y: number) {
    this.shadowCenter = [x, y];
    if (this.sun) {
      this.updateSunLight();
      this.compass?.setCenter(x, y);
      this.map?.triggerRepaint();
    }
  }

  /** Convert lng/lat to scene-local meters using the SAME mercator transform the renderer
   *  applies in render() — so anything placed at the returned point lands exactly under the
   *  corresponding screen pixel. (proj4/UTM meters drift from this by ~10m a few km out, which
   *  is what made the on-map sun compass creep off-centre as you zoomed in.) */
  projectToScene(lng: number, lat: number): [number, number] {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return [
      (mc.x - this.originMc.x) / this.metersToMercator,
      (mc.y - this.originMc.y) / this.metersToMercator,
    ];
  }

  /** Keep the on-map compass a roughly constant on-screen size across zoom levels. */
  setCompassWorldRadius(meters: number) {
    this.compass?.setWorldRadius(meters);
  }

  /** Resize the orthographic shadow camera frustum to cover the current view (meters from center). */
  setShadowHalfExtent(half: number) {
    if (!this.sun) return;
    const clamped = Math.max(400, Math.min(half, 9000));
    this.sun.shadow.camera.left = -clamped;
    this.sun.shadow.camera.right = clamped;
    this.sun.shadow.camera.top = clamped;
    this.sun.shadow.camera.bottom = -clamped;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.map?.triggerRepaint();
  }

  add(obj: THREE.Object3D) {
    this.sceneRoot.add(obj);
  }

  remove(obj: THREE.Object3D) {
    this.sceneRoot.remove(obj);
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;

    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    this.originMc = maplibregl.MercatorCoordinate.fromLngLat(BERLIN_ORIGIN, 0);
    this.metersToMercator = this.originMc.meterInMercatorCoordinateUnits();

    // Important: the scene stays at NATURAL METERS scale — no transform on sceneRoot. The
    // meters→mercator conversion is baked into the projection matrix in render() instead.
    // This is critical for Three.js's shadow camera: its frustum/near/far are interpreted in
    // scene units, so keeping the scene at meters lets us use ordinary values (±1500m, near=1).
    this.sceneRoot = new THREE.Group();
    this.scene.add(this.sceneRoot);

    // Cached matrix: translate by originMc and scale meters→mercator.
    this.mercatorMatrix.compose(
      new THREE.Vector3(this.originMc.x, this.originMc.y, this.originMc.z),
      new THREE.Quaternion(),
      new THREE.Vector3(this.metersToMercator, this.metersToMercator, this.metersToMercator),
    );

    // Three.js r155+ uses physical light units by default — values are roughly in lux.
    // Daylight sky ≈ 10k lux, midday direct sun ≈ 100k lux. We scale down for indirect look.
    // Lighting tuned to work with ACES filmic tone mapping: sun is the dominant light so
    // the wall facing the sun reads clearly brighter than the wall facing away. Ambient +
    // hemi are kept low enough that the contrast survives tone mapping, but high enough
    // that the shaded side stays readable (≈ 50% brightness).
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.sceneRoot.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0xbfd3ff, 0x4a3a2a, 0.45);
    this.hemi.position.set(0, 0, 200);
    this.sceneRoot.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4d6, 7);
    this.sun.castShadow = true;
    // 4096² shadow map → sharper, more defined ground shadows (the frustum spans up to a few km
    // at low zoom, so the extra resolution keeps edges crisp instead of mushy).
    this.sun.shadow.mapSize.set(4096, 4096);
    // Z-up scene: tell the shadow camera so it doesn't go singular when the sun is due
    // south/north (look-direction parallel to default Y-up → degenerate orientation → empty shadow map).
    this.sun.shadow.camera.up.set(0, 0, 1);
    const s = 1500;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 8000;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.sceneRoot.add(this.sun);
    this.sceneRoot.add(this.sun.target);

    this.updateSunLight();

    // Thin shadow-only slab anchored at scene origin. Must be larger than the streamed-tile
    // extent or buildings far from origin (e.g. Prenzlauer Berg, 3 km north) cast onto
    // nothing and the street stays unshadowed. 30 km covers the whole S-Bahn Ring.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(30000, 30000, 0.2),
      new THREE.ShadowMaterial({ opacity: 0.5, color: 0x121116 }),
    );
    ground.receiveShadow = true;
    ground.position.z = -0.1;
    ground.frustumCulled = false;
    this.sceneRoot.add(ground);

    // On-map sun compass — sits at the current view's look-at point on the ground.
    this.compass = createSunCompass();
    this.compass.group.frustumCulled = false;
    this.sceneRoot.add(this.compass.group);
    this.compass.update(this.currentSun, this.currentDate);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    // Harder shadow edges — PCFShadowMap = nearest-neighbour PCF, no softening kernel.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ACES filmic tone mapping compresses the HDR range coming out of MeshStandardMaterial.
    // Without it, sun-lit faces clamp to pure white at our intensities and become
    // indistinguishable from unlit walls — they look identical grey. With it, the lit side
    // reads as visibly brighter than the shaded side.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: mat4) {
    // MapLibre's matrix maps mercator-world coords to clip space. Our scene is in meters, so
    // we pre-multiply by mercatorMatrix (translate to origin + scale meters→mercator) before
    // handing the result to Three.js as the projection matrix.
    const mapMatrix = new THREE.Matrix4().fromArray(matrix as unknown as number[]);
    this.camera.projectionMatrix.multiplyMatrices(mapMatrix, this.mercatorMatrix);

    // The map canvas resizes after onAdd whenever the layout changes (it's a flex card now, not a
    // full-screen element) or the window resizes — and MapLibre never re-runs the custom layer's
    // onAdd. Three caches its viewport from creation, so re-sync it to the live drawing buffer
    // each frame; otherwise the 3D scene renders at a stale scale/offset and the buildings drift
    // off the basemap. setViewport (not setSize) avoids reallocating/clearing the shared canvas.
    const canvas = this.map.getCanvas();
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSunLight() {
    const d = sunDirection(this.currentSun);
    const dist = 2000;
    const [cx, cy] = this.shadowCenter;
    this.sun.position.set(cx + d.x * dist, cy + d.y * dist, d.z * dist);
    this.sun.target.position.set(cx, cy, 0);
    this.sun.target.updateMatrixWorld();

    const below = this.currentSun.altitude <= 0;
    this.sun.intensity = below ? 0 : 7;
    this.sun.castShadow = !below;
    this.ambient.intensity = below ? 0.3 : 0.6;
    this.hemi.intensity = below ? 0.2 : 0.45;
  }
}
