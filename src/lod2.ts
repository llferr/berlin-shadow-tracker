import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The scene reaches the GPU through MapLibre's projection, which leaves the HORIZONTAL plane
// of the lighting space rotated 180° about the vertical relative to the geometry normals — so
// sun-facing vertical walls came out dark and shaded walls bright (in BOTH the N–S and E–W
// directions). Negating each normal's X and Y components corrects the wall diffuse term on
// both horizontal axes; the vertical component (roofs, normal.z) is already correct and left
// untouched. This only changes normals, not positions — so shadows, the sun position, and the
// on-map compass all stay correct.
export function flipNormalHorizontal(geometry: THREE.BufferGeometry) {
  const n = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!n) return;
  for (let i = 0; i < n.count; i++) {
    n.setX(i, -n.getX(i));
    n.setY(i, -n.getY(i));
  }
  n.needsUpdate = true;
}

const loader = new GLTFLoader();
// DoubleSide is REQUIRED on this dataset. Berlin LOD2 winding is genuinely mixed, and no
// orientation heuristic (footprint, ray-cast parity, uniform reverse) gets it 100% consistent —
// so FrontSide CULLS the mis-wound triangles and you get "buildings without roofs/walls". This
// has bitten us twice; do not switch back to FrontSide. DoubleSide renders every triangle.
// Correct wall lighting comes from flipNormalY() (the MapLibre Y-down normal fix), not from
// winding, so it works regardless of side.
const buildingMaterial = new THREE.MeshStandardMaterial({
  color: 0xdcd6c8,
  roughness: 0.9,
  metalness: 0,
  side: THREE.DoubleSide,
});

// Fetch a preprocessed LOD2 tile GLB and return a Group ready to drop into the shadow scene.
// Geometry is already in scene-local meters (+X=east, +Y=south, +Z=up), so no transforms needed.
export async function loadLod2Tile(url: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      flipNormalHorizontal(mesh.geometry);
      mesh.material = buildingMaterial;
      mesh.castShadow = true;
      // Don't receive shadows on building surfaces — Shadowmap-style: cast shadows only
      // appear on the ground plane, so building walls keep their natural lit/unlit shading
      // and stay readable even when occluded by neighbouring buildings.
      mesh.receiveShadow = false;
    }
  });
  return gltf.scene;
}

export async function loadLod2Tiles(
  tiles: string[],
  onTile?: (group: THREE.Group, url: string) => void,
): Promise<void> {
  await Promise.all(
    tiles.map(async (url) => {
      try {
        const group = await loadLod2Tile(url);
        onTile?.(group, url);
      } catch (err) {
        console.warn(`[lod2] failed to load ${url}:`, err);
      }
    }),
  );
}
