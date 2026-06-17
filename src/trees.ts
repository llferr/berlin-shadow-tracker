import * as THREE from 'three';
import { flipNormalHorizontal } from './lod2';

// Shared geometries + materials — one set across the whole scene, instanced per-tile.
// Cylinder default axis is Y; we rotate so it stands along scene-local +Z and translate so
// the base sits at z=0. Unit size (radius=1, height=1) — each instance scales to its tree's
// trunk radius and height. flipNormalHorizontal: same lighting fix the buildings need
// (see lod2.ts) so tree sides catch the sun on the correct face.
const TRUNK_GEOMETRY = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  flipNormalHorizontal(g);
  return g;
})();

const CROWN_GEOMETRY = (() => {
  const g = new THREE.SphereGeometry(1, 12, 8);
  flipNormalHorizontal(g);
  return g;
})();

const TRUNK_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x6d4a2e,
  roughness: 0.95,
  metalness: 0,
});

const CROWN_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x4f7a3a,
  roughness: 0.95,
  metalness: 0,
});

export type TreeTile = {
  group: THREE.Group;
  setLeafOn(leafOn: boolean): void;
  dispose(): void;
};

export async function loadTreeTile(url: string): Promise<TreeTile | null> {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  if (count === 0) return null;

  const trunks: { x: number; y: number; h: number; r: number; decid: boolean; crownR: number; crownH: number }[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    const x = dv.getFloat32(off, true); off += 4;
    const y = dv.getFloat32(off, true); off += 4;
    const h = dv.getFloat32(off, true); off += 4;
    const c = dv.getFloat32(off, true); off += 4;
    const flags = dv.getUint8(off); off += 1;
    const decid = (flags & 1) === 1;

    // Visual model:  trunk runs from z=0 to z=h*0.35, crown is an ellipsoid centred at
    // z = trunk top + crownH/2 with radius derived from the recorded crown diameter (or a
    // height-based fallback when the dataset has crownDiameter=0, which happens often).
    const trunkH = Math.max(1, h * 0.35);
    const trunkR = Math.max(0.12, h * 0.025);
    const crownDiameter = c > 0 ? c : h * 0.6;
    const crownR = crownDiameter / 2;
    const crownH = h - trunkH;
    trunks.push({ x, y, h, r: trunkR, decid, crownR, crownH });
  }

  // Separate crowns into deciduous vs coniferous so we can hide the deciduous ones in winter.
  let nDecid = 0, nConif = 0;
  for (const t of trunks) (t.decid ? nDecid++ : nConif++);

  const trunkMesh = new THREE.InstancedMesh(TRUNK_GEOMETRY, TRUNK_MATERIAL, count);
  const decidMesh = new THREE.InstancedMesh(CROWN_GEOMETRY, CROWN_MATERIAL, Math.max(1, nDecid));
  const conifMesh = new THREE.InstancedMesh(CROWN_GEOMETRY, CROWN_MATERIAL, Math.max(1, nConif));
  trunkMesh.castShadow = true;
  decidMesh.castShadow = true;
  conifMesh.castShadow = true;
  // Don't darken trees with other casters' shadows — matches the Shadowmap reference where
  // trees remain visible even in shadowed corridors.
  trunkMesh.receiveShadow = false;
  decidMesh.receiveShadow = false;
  conifMesh.receiveShadow = false;
  if (nDecid === 0) decidMesh.count = 0;
  if (nConif === 0) conifMesh.count = 0;
  trunkMesh.frustumCulled = false;
  decidMesh.frustumCulled = false;
  conifMesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  let di = 0, ci = 0;
  for (let i = 0; i < trunks.length; i++) {
    const t = trunks[i];

    // Trunk: scale unit cylinder (radius 1, height 1) to (r, r, h_trunk), place at (x, y, 0).
    m.makeScale(t.r, t.r, t.h - t.crownH);
    m.setPosition(t.x, t.y, 0);
    trunkMesh.setMatrixAt(i, m);

    // Crown: scale unit sphere by (crownR, crownR, crownH/2 ≈ vertical half-extent), then
    // translate to (x, y, trunkTop + crownH/2).
    const trunkTop = t.h - t.crownH;
    const vertHalf = t.crownH / 2;
    m.makeScale(t.crownR, t.crownR, vertHalf);
    m.setPosition(t.x, t.y, trunkTop + vertHalf);
    if (t.decid) {
      decidMesh.setMatrixAt(di++, m);
    } else {
      conifMesh.setMatrixAt(ci++, m);
    }
  }

  trunkMesh.instanceMatrix.needsUpdate = true;
  decidMesh.instanceMatrix.needsUpdate = true;
  conifMesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunkMesh, decidMesh, conifMesh);

  return {
    group,
    setLeafOn(leafOn) {
      decidMesh.visible = leafOn;
    },
    dispose() {
      trunkMesh.dispose();
      decidMesh.dispose();
      conifMesh.dispose();
    },
  };
}
