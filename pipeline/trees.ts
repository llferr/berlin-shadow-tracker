// Download Berlin Baumkataster trees from the Senate WFS for a given UTM bounding box,
// reproject EPSG:25833 → scene-local meters (Brandenburg Gate origin, +Y=south), spatially
// bin into the same 1 km grid the buildings use, and write per-tile binary files to
// public/tiles/Trees_{X}_{Y}.bin.
//
// Binary format (little-endian):
//   header: uint32 treeCount
//   per tree (17 bytes):
//     float32 sceneX   (meters east of Brandenburg Gate)
//     float32 sceneY   (meters south of Brandenburg Gate)
//     float32 height   (m)
//     float32 crown    (crown diameter, m)
//     uint8   flags    (bit 0 = deciduous)
//
// Usage:  tsx pipeline/trees.ts <minX> <maxX> <minY> <maxY>
//   X, Y are UTM-33N kilometre tile indices, matching the LOD2 tile naming.

import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import proj4 from 'proj4';

proj4.defs(
  'EPSG:25833',
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

const SCENE_ORIGIN_LNGLAT: [number, number] = [13.3777, 52.5163];
const [ORIGIN_UTM_X, ORIGIN_UTM_Y] = proj4('WGS84', 'EPSG:25833', SCENE_ORIGIN_LNGLAT) as [
  number,
  number,
];

const WFS_BASE = 'https://gdi.berlin.de/services/wfs/baumbestand';
const TYPE_NAMES = ['baumbestand:strassenbaeume', 'baumbestand:anlagenbaeume'];
const PAGE = 10000;

type GeoJsonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    baumhoehe?: number | string | null;
    kronedurch?: number | string | null;
    art_gruppe?: string | null;
  };
};

type GeoJsonResp = {
  features: GeoJsonFeature[];
  numberReturned?: number;
};

type Tree = { utmX: number; utmY: number; height: number; crown: number; deciduous: boolean };

async function fetchPage(
  typeName: string,
  bbox: string,
  startIndex: number,
): Promise<GeoJsonFeature[]> {
  const url =
    `${WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${typeName}` +
    `&outputFormat=application/json` +
    `&srsName=EPSG:25833` +
    `&bbox=${bbox},EPSG:25833` +
    `&count=${PAGE}&startIndex=${startIndex}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`WFS ${r.status} ${r.statusText} for ${typeName}@${startIndex}`);
  const d = (await r.json()) as GeoJsonResp;
  return d.features ?? [];
}

function packTiles(trees: Tree[], outDir: string) {
  const perTile = new Map<string, Tree[]>();
  for (const t of trees) {
    const tx = Math.floor(t.utmX / 1000);
    const ty = Math.floor(t.utmY / 1000);
    const key = `${tx}_${ty}`;
    let bucket = perTile.get(key);
    if (!bucket) {
      bucket = [];
      perTile.set(key, bucket);
    }
    bucket.push(t);
  }

  mkdirSync(outDir, { recursive: true });
  let written = 0;
  for (const [key, bucket] of perTile) {
    const buf = Buffer.alloc(4 + bucket.length * 17);
    buf.writeUInt32LE(bucket.length, 0);
    let off = 4;
    for (const t of bucket) {
      const sx = t.utmX - ORIGIN_UTM_X;
      const sy = -(t.utmY - ORIGIN_UTM_Y);
      buf.writeFloatLE(sx, off); off += 4;
      buf.writeFloatLE(sy, off); off += 4;
      buf.writeFloatLE(t.height, off); off += 4;
      buf.writeFloatLE(t.crown, off); off += 4;
      buf.writeUInt8(t.deciduous ? 1 : 0, off); off += 1;
    }
    writeFileSync(`${outDir}/Trees_${key}.bin`, buf);
    written++;
  }
  return written;
}

async function main() {
  const minX = Number(process.argv[2]);
  const maxX = Number(process.argv[3]);
  const minY = Number(process.argv[4]);
  const maxY = Number(process.argv[5]);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    console.error('Usage: tsx pipeline/trees.ts <minX> <maxX> <minY> <maxY>');
    process.exit(1);
  }

  const bbox = `${minX * 1000},${minY * 1000},${maxX * 1000 + 1000},${maxY * 1000 + 1000}`;
  const trees: Tree[] = [];

  for (const typeName of TYPE_NAMES) {
    let startIndex = 0;
    while (true) {
      const features = await fetchPage(typeName, bbox, startIndex);
      if (features.length === 0) break;
      for (const f of features) {
        const [utmX, utmY] = f.geometry.coordinates;
        const height = Number(f.properties.baumhoehe);
        const crown = Number(f.properties.kronedurch);
        // Skip records with missing/garbage height. Crown of 0 happens often — we'll fall
        // back to a height-based default when rendering. Height < 2 m is usually a stump or
        // freshly-planted sapling that won't cast meaningful shadow.
        if (!Number.isFinite(height) || height < 2 || height > 60) continue;
        const deciduous = f.properties.art_gruppe === 'Laubbäume';
        trees.push({
          utmX,
          utmY,
          height,
          crown: Number.isFinite(crown) && crown > 0 ? crown : 0,
          deciduous,
        });
      }
      console.log(
        `  ${typeName} startIndex=${startIndex}  +${features.length}  total=${trees.length}`,
      );
      if (features.length < PAGE) break;
      startIndex += PAGE;
    }
  }

  const written = packTiles(trees, 'public/tiles');
  console.log(`Wrote ${written} tree tiles covering ${trees.length} trees.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
