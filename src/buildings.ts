import * as THREE from 'three';

// A small ensemble of varied-height blocks around the scene origin (Brandenburg Gate area)
// plus one tall landmark block ~200m east. Used in Phase 1 to validate that shadows point
// in the right direction and have plausible lengths at known sun positions.
export function createDummyBuildings(): THREE.Group {
  const group = new THREE.Group();

  const blockMaterial = new THREE.MeshStandardMaterial({
    color: 0xd6d4ce,
    roughness: 0.85,
    metalness: 0.0,
  });

  const heights = [
    [22, 35, 48, 28],
    [40, 65, 80, 30],
    [25, 55, 70, 45],
    [18, 30, 38, 22],
  ];

  const size = 22;
  const spacing = 50;
  const cols = heights[0].length;
  const rows = heights.length;
  const offsetX = -((cols - 1) * spacing) / 2;
  const offsetY = -((rows - 1) * spacing) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heights[r][c];
      const geo = new THREE.BoxGeometry(size, size, h);
      const mesh = new THREE.Mesh(geo, blockMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(offsetX + c * spacing, offsetY + r * spacing, h / 2);
      group.add(mesh);
    }
  }

  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(18, 18, 150),
    new THREE.MeshStandardMaterial({ color: 0xf5b400, roughness: 0.7 }),
  );
  tower.castShadow = true;
  tower.receiveShadow = true;
  tower.position.set(220, 0, 75);
  group.add(tower);

  // Compass markers — small colored cubes 60m out so it's instantly obvious which way is N/E/S/W.
  // Red=E (+X), Green=N (+Y), Blue=S (-Y), Yellow=W (-X). Each 6m tall.
  const markers: Array<[number, number, number]> = [
    [60, 0, 0xff3030],
    [0, 60, 0x30c060],
    [0, -60, 0x3070ff],
    [-60, 0, 0xf0c020],
  ];
  for (const [x, y, color] of markers) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(x, y, 3);
    group.add(m);
  }

  return group;
}
