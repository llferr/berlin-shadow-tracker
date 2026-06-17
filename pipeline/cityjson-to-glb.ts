// One-time pipeline step: read a CityJSON 2.0 file (Berlin LOD2 building solids,
// EPSG:25833) and write a single GLB containing all building geometry,
// positioned in the same scene-local meter frame the web app uses:
//
//   - +X = east, +Y = south, +Z = up (matches src/sun.ts convention)
//   - Origin at SCENE_ORIGIN_LNGLAT (Brandenburg Gate)
//   - Per-building Z normalized so each building's lowest vertex sits at z = 0
//
// Usage: tsx pipeline/cityjson-to-glb.ts <input.json> <output.glb>

import { readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import proj4 from 'proj4';
import earcut from 'earcut';

const SCENE_ORIGIN_LNGLAT: [number, number] = [13.3777, 52.5163];

proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const R_EARTH = 6378137;
const LAT0 = (SCENE_ORIGIN_LNGLAT[1] * Math.PI) / 180;
const COS_LAT0 = Math.cos(LAT0);

function lngLatToScene(lng: number, lat: number): [number, number] {
  const dLng = ((lng - SCENE_ORIGIN_LNGLAT[0]) * Math.PI) / 180;
  const dLat = ((lat - SCENE_ORIGIN_LNGLAT[1]) * Math.PI) / 180;
  return [R_EARTH * dLng * COS_LAT0, -R_EARTH * dLat];
}

type CityJSON = {
  type: 'CityJSON';
  version: string;
  transform: { scale: [number, number, number]; translate: [number, number, number] };
  vertices: [number, number, number][];
  CityObjects: Record<string, CityObject>;
};

type CityObject = {
  type: string;
  geometry?: Geometry[];
};

type Geometry = {
  type: 'Solid' | 'MultiSurface' | 'CompositeSurface';
  lod: string | number;
  boundaries: number[][][][];
  semantics?: {
    surfaces: { type: string; [k: string]: unknown }[];
    values: (number | null)[][];
  };
};

type Vec3 = [number, number, number];

function decodeVertex(
  raw: [number, number, number],
  scale: [number, number, number],
  translate: [number, number, number],
): Vec3 {
  return [
    raw[0] * scale[0] + translate[0],
    raw[1] * scale[1] + translate[1],
    raw[2] * scale[2] + translate[2],
  ];
}

function utmToScene(x: number, y: number): [number, number] {
  const [lng, lat] = proj4('EPSG:25833', 'WGS84', [x, y]) as [number, number];
  return lngLatToScene(lng, lat);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function polygonNormal(ring: Vec3[]): Vec3 {
  // Newell's method — robust for non-planar polygons.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([nx, ny, nz]);
}

// Robust 3D-polygon triangulation with hole support. Many Berlin LOD2 roof/wall surfaces
// are non-convex (L-shaped walls, roofs with light wells), so naive fan triangulation
// produced overlapping/missing triangles. Approach:
//   1. Compute the polygon's outward normal (Newell — robust for non-planar polygons).
//   2. Build an orthonormal basis (u, v) in that plane.
//   3. Project every 3D vertex to 2D (u·P, v·P) and run earcut, passing hole start offsets.
//   4. For each output triangle, ensure its cross-product normal agrees with the polygon's
//      target normal — swap two vertices if it doesn't. This makes the output robust
//      against whichever winding convention the input CityJSON happens to use.
function triangulateSurface(rings: Vec3[][], targetNormal: Vec3): [Vec3, Vec3, Vec3][] {
  const allVerts: Vec3[] = [];
  const holeIndices: number[] = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holeIndices.push(allVerts.length);
    for (const v of rings[i]) allVerts.push(v);
  }
  if (allVerts.length < 3) return [];

  const [u, v] = planeBasis(targetNormal);

  const flat = new Array<number>(allVerts.length * 2);
  for (let i = 0; i < allVerts.length; i++) {
    const p = allVerts[i];
    flat[i * 2] = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    flat[i * 2 + 1] = p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
  }

  const indices = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  const tris: [Vec3, Vec3, Vec3][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    let a = allVerts[indices[i]];
    let b = allVerts[indices[i + 1]];
    let c = allVerts[indices[i + 2]];
    const triN = cross(sub(b, a), sub(c, a));
    if (triN[0] * targetNormal[0] + triN[1] * targetNormal[1] + triN[2] * targetNormal[2] < 0) {
      [b, c] = [c, b];
    }
    tris.push([a, b, c]);
  }
  return tris;
}

function planeBasis(n: Vec3): [Vec3, Vec3] {
  // Pick an arbitrary axis not parallel to n, then build u = (n × axis), v = (n × u).
  const ax: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, ax));
  const v = normalize(cross(n, u));
  return [u, v];
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: tsx pipeline/cityjson-to-glb.ts <input.json> <output.glb>');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as CityJSON;
  const { scale, translate } = raw.transform;
  const vertices = raw.vertices.map((v) => decodeVertex(v, scale, translate));

  const positions: number[] = [];
  const normals: number[] = [];

  let buildingCount = 0;
  let triangleCount = 0;

  for (const obj of Object.values(raw.CityObjects)) {
    // Berlin LOD2 splits complex buildings into a parent Building (often with no own geometry)
    // and one or more BuildingPart children. Geometry lives in BOTH — we must emit both.
    if (obj.type !== 'Building' && obj.type !== 'BuildingPart') continue;
    const geom = obj.geometry?.find((g) => g.type === 'Solid' && Number(g.lod) >= 2);
    if (!geom) continue;

    // Compute scene-local vertices once per building, plus its ground elevation (min z).
    let zMin = Infinity;
    const sceneVerts: Vec3[] = new Array(vertices.length);
    const touched = new Set<number>();

    // First pass: collect indices that this building actually uses and find z min.
    for (const shell of geom.boundaries) {
      for (const surface of shell) {
        for (const ring of surface) {
          for (const idx of ring) {
            if (!touched.has(idx)) {
              touched.add(idx);
              if (vertices[idx][2] < zMin) zMin = vertices[idx][2];
            }
          }
        }
      }
    }

    if (!isFinite(zMin)) continue;

    for (const idx of touched) {
      const [ux, uy, uz] = vertices[idx];
      const [sx, sy] = utmToScene(ux, uy);
      sceneVerts[idx] = [sx, sy, uz - zMin];
    }

    const sem = geom.semantics;

    // Keep WallSurface, RoofSurface, ClosureSurface; skip GroundSurface (underside, no sun).
    // Winding: the UTM→scene Y-negation reverses every polygon, so we reverse each ring once
    // to undo it. This is the simplest, most winding-consistent orientation (a signed-volume
    // diagnostic showed the source is uniformly oriented per solid). We do NOT use per-face
    // footprint/ray-cast heuristics — they scored WORSE and introduced inconsistency. Exact
    // outward orientation doesn't matter anyway: buildings render DoubleSide (so nothing is
    // culled) and wall lighting is corrected by flipNormalY() at load, not by winding.
    for (let shellIdx = 0; shellIdx < geom.boundaries.length; shellIdx++) {
      const shell = geom.boundaries[shellIdx];
      const semValues = sem?.values?.[shellIdx];

      for (let surfIdx = 0; surfIdx < shell.length; surfIdx++) {
        const surface = shell[surfIdx];
        if (!surface.length || surface[0].length < 3) continue;

        const semIdx = semValues?.[surfIdx];
        const surfType = semIdx != null ? sem?.surfaces[semIdx]?.type : undefined;
        if (surfType === 'GroundSurface') continue;

        const rings: Vec3[][] = surface.map((ring) => ring.map((i) => sceneVerts[i]).reverse());
        const targetNormal = polygonNormal(rings[0]);
        if (targetNormal[0] === 0 && targetNormal[1] === 0 && targetNormal[2] === 0) continue;

        for (const [a, b, c] of triangulateSurface(rings, targetNormal)) {
          positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
          const nn = normalize(cross(sub(b, a), sub(c, a)));
          normals.push(nn[0], nn[1], nn[2], nn[0], nn[1], nn[2], nn[0], nn[1], nn[2]);
          triangleCount++;
        }
      }
    }

    buildingCount++;
  }

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positionArray.length; i += 3) {
    const x = positionArray[i], y = positionArray[i + 1], z = positionArray[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  writeGlb(outputPath, positionArray, normalArray, [minX, minY, minZ], [maxX, maxY, maxZ]);

  console.log(`Wrote ${outputPath}`);
  console.log(`  Buildings: ${buildingCount}`);
  console.log(`  Triangles: ${triangleCount}`);
  console.log(
    `  Bounds (m): x [${minX.toFixed(0)}, ${maxX.toFixed(0)}]` +
      `, y [${minY.toFixed(0)}, ${maxY.toFixed(0)}]` +
      `, z [${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`,
  );
}

// Minimal GLB writer. One mesh, one primitive, two non-indexed attributes (POSITION + NORMAL).
// glTF 2.0 spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
function writeGlb(
  path: string,
  positions: Float32Array,
  normals: Float32Array,
  min: [number, number, number],
  max: [number, number, number],
) {
  const vertexCount = positions.length / 3;
  const positionByteLength = positions.byteLength;
  const normalByteLength = normals.byteLength;

  const json = {
    asset: { version: '2.0', generator: 'shadow-tracker pipeline' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            mode: 4, // TRIANGLES
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: vertexCount,
        type: 'VEC3',
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionByteLength, target: 34962 /* ARRAY_BUFFER */ },
      { buffer: 0, byteOffset: positionByteLength, byteLength: normalByteLength, target: 34962 },
    ],
    buffers: [{ byteLength: positionByteLength + normalByteLength }],
  };

  const jsonText = JSON.stringify(json);
  const jsonPadded = Buffer.from(jsonText + ' '.repeat((4 - (jsonText.length % 4)) % 4), 'utf8');
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer)]);
  const binPadded = bin.length % 4 === 0 ? bin : Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);

  const header = Buffer.alloc(12);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  writeFileSync(path, Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binPadded]));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
