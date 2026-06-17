// Dump every triangle emitted by the pipeline for a single building, with vertex coords
// and computed normals. Lets us eyeball whether walls + roof + winding are right.
//
// Usage: tsx pipeline/debug-building.ts <cityjson> <building-id>

import { readFileSync } from 'node:fs';
import proj4 from 'proj4';

proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const SCENE_ORIGIN_LNGLAT: [number, number] = [13.3777, 52.5163];
const R_EARTH = 6378137;
const LAT0 = (SCENE_ORIGIN_LNGLAT[1] * Math.PI) / 180;
const COS_LAT0 = Math.cos(LAT0);

function utmToScene(x: number, y: number): [number, number] {
  const [lng, lat] = proj4('EPSG:25833', 'WGS84', [x, y]) as [number, number];
  const dLng = ((lng - SCENE_ORIGIN_LNGLAT[0]) * Math.PI) / 180;
  const dLat = ((lat - SCENE_ORIGIN_LNGLAT[1]) * Math.PI) / 180;
  return [R_EARTH * dLng * COS_LAT0, -R_EARTH * dLat];
}

const cityjsonPath = process.argv[2];
const buildingId = process.argv[3];

const raw = JSON.parse(readFileSync(cityjsonPath, 'utf8'));
const { scale, translate } = raw.transform;
const vertices = raw.vertices.map((v: [number, number, number]) => [
  v[0] * scale[0] + translate[0],
  v[1] * scale[1] + translate[1],
  v[2] * scale[2] + translate[2],
] as [number, number, number]);

const b = raw.CityObjects[buildingId];
if (!b) {
  console.error('Building not found');
  process.exit(1);
}
console.log('Building:', buildingId, 'measuredHeight:', b.attributes?.measuredHeight, 'roofType:', b.attributes?.roofType);

const geom = b.geometry.find((g: { type: string; lod: string | number }) => g.type === 'Solid' && Number(g.lod) >= 2);
const sem = geom.semantics;

// zMin
let zMin = Infinity;
for (const shell of geom.boundaries) {
  for (const surface of shell) {
    for (const ring of surface) {
      for (const idx of ring) {
        if (vertices[idx][2] < zMin) zMin = vertices[idx][2];
      }
    }
  }
}
console.log('zMin:', zMin.toFixed(3));

// Transform per-vertex
const sceneVerts: Record<number, [number, number, number]> = {};
for (const shell of geom.boundaries) {
  for (const surface of shell) {
    for (const ring of surface) {
      for (const idx of ring) {
        if (sceneVerts[idx]) continue;
        const [ux, uy, uz] = vertices[idx];
        const [sx, sy] = utmToScene(ux, uy);
        sceneVerts[idx] = [sx, sy, uz - zMin];
      }
    }
  }
}

// Emit + dump triangles
for (let sIdx = 0; sIdx < geom.boundaries[0].length; sIdx++) {
  const surf = geom.boundaries[0][sIdx];
  const semIdx = sem.values[0][sIdx];
  const surfType = sem.surfaces[semIdx].type;
  const ringIdx = surf[0];
  const ringVerts = ringIdx.map((i: number) => sceneVerts[i]).reverse();

  console.log(`\n--- Surface ${sIdx}: ${surfType} (${ringVerts.length} verts)`);
  ringVerts.forEach((v: [number, number, number], i: number) =>
    console.log(`  v${i}: x=${v[0].toFixed(2)} y=${v[1].toFixed(2)} z=${v[2].toFixed(2)}`),
  );
  if (surfType === 'GroundSurface') {
    console.log('  → SKIPPED (ground)');
    continue;
  }
  for (let i = 1; i < ringVerts.length - 1; i++) {
    const a = ringVerts[0], bv = ringVerts[i], c = ringVerts[i + 1];
    const ex = [bv[0] - a[0], bv[1] - a[1], bv[2] - a[2]];
    const fx = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = ex[1] * fx[2] - ex[2] * fx[1];
    const ny = ex[2] * fx[0] - ex[0] * fx[2];
    const nz = ex[0] * fx[1] - ex[1] * fx[0];
    const len = Math.hypot(nx, ny, nz);
    console.log(`  tri ${i - 1}: normal (${(nx / len).toFixed(2)}, ${(ny / len).toFixed(2)}, ${(nz / len).toFixed(2)})  area=${(len / 2).toFixed(2)}m²`);
  }
}
