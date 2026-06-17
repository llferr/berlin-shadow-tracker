import * as THREE from 'three';
import SunCalc from 'suncalc';
import { sunDirection, type SunPosition } from './sun';

// On-map 3D sun compass — a horizontal ring laid on the ground at the user's look-at
// point, the sun rendered at its true 3D direction (azimuth + altitude) scaled to the
// ring's radius, and the day's solar arc drawn as a polyline traversing the dome.
// Sits in the Three.js scene so it has correct perspective with the buildings.

const LAT = 52.5163;
const LNG = 13.3777;
const RADIUS = 90; // metres — large enough to be readable at z16+, still fits a city block

// Apricot Cream / Honey Bronze accents from the palette so the compass matches the HUD.
const RING_COLOR = 0xF3D3A2;
const TRAJECTORY_COLOR = 0xE4B359;
const SUN_COLOR = 0xFFE08A;

const NS = 'http://www.w3.org/2000/svg';
void NS;

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#F3D3A2';
  ctx.font = 'bold 68px ui-sans-serif, system-ui, -apple-system';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // Labels always render on top — they're navigation chrome, not geometry, so they
    // shouldn't be hidden behind tall buildings.
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(14, 14, 1);
  return sprite;
}

export type SunCompass = {
  group: THREE.Group;
  setCenter(x: number, y: number): void;
  /** Resize the whole compass so its ring has the given world radius (metres). Used to keep
   *  the compass a roughly constant on-screen size across zoom levels. */
  setWorldRadius(meters: number): void;
  update(sun: SunPosition, date: Date): void;
};

export function createSunCompass(): SunCompass {
  const group = new THREE.Group();

  // Ring on the ground. RingGeometry sits in the XY plane facing +Z — perfect for Z-up.
  // depthTest on so buildings closer to camera can occlude it (the ring lives on the
  // ground; tall buildings can pass in front of it).
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS - 1.5, RADIUS + 1.5, 128, 1),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.position.z = 0.3;
  group.add(ring);

  // Inner soft halo so the ring reads as part of an ellipse in perspective.
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS - 4, RADIUS - 1.5, 128, 1),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  innerRing.position.z = 0.29;
  group.add(innerRing);

  // Daily solar trajectory — re-sampled on each update() call.
  const trajectoryGeometry = new THREE.BufferGeometry();
  const trajectory = new THREE.Line(
    trajectoryGeometry,
    new THREE.LineBasicMaterial({
      color: TRAJECTORY_COLOR,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
  );
  group.add(trajectory);

  // Sun marker — small bright sphere, no shading (emissive look via MeshBasicMaterial).
  const sunMarker = new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 20, 14),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR }),
  );
  group.add(sunMarker);

  // Subtle halo sprite behind the sun for the glow effect.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 128;
  const haloCtx = haloCanvas.getContext('2d')!;
  const grad = haloCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 224, 138, 0.8)');
  grad.addColorStop(0.4, 'rgba(255, 195, 89, 0.35)');
  grad.addColorStop(1, 'rgba(255, 195, 89, 0)');
  haloCtx.fillStyle = grad;
  haloCtx.fillRect(0, 0, 128, 128);
  const haloTexture = new THREE.CanvasTexture(haloCanvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.set(22, 22, 1);
  group.add(halo);

  // Sun "ray" — a thin glowing line from the centre of the ring to the sun marker, so the
  // user can read the direction at a glance even when the sun marker is close to the rim.
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const ray = new THREE.Line(
    rayGeometry,
    new THREE.LineBasicMaterial({
      color: SUN_COLOR,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  group.add(ray);

  // Cardinal labels (N / E / S / W) — billboarded so they're always face-on regardless
  // of map bearing/pitch. Scene convention: +X=east, +Y=south, +Z=up.
  const labels: [string, number, number][] = [
    ['N', 0, -RADIUS - 7],
    ['E', RADIUS + 7, 0],
    ['S', 0, RADIUS + 7],
    ['W', -RADIUS - 7, 0],
  ];
  for (const [text, x, y] of labels) {
    const sprite = makeLabelSprite(text);
    sprite.position.set(x, y, 2);
    sprite.renderOrder = 11;
    group.add(sprite);
  }

  return {
    group,

    setCenter(x: number, y: number) {
      group.position.set(x, y, 0);
    },

    setWorldRadius(meters: number) {
      // Base geometry is built at RADIUS; uniform-scale the group so the ring spans `meters`.
      // Scaling the group (not the geometry) keeps the sun marker, ray, arc and labels in sync.
      group.scale.setScalar(meters / RADIUS);
    },

    update(sun: SunPosition, date: Date) {
      // Sun marker + halo at the actual 3D sun direction scaled to the ring radius.
      const d = sunDirection(sun);
      const sx = d.x * RADIUS;
      const sy = d.y * RADIUS;
      const sz = Math.max(0.5, d.z * RADIUS);
      sunMarker.position.set(sx, sy, sz);
      halo.position.set(sx, sy, sz);
      const below = sun.altitude <= 0;
      sunMarker.visible = !below;
      halo.visible = !below;
      ray.visible = !below;

      // Ray line endpoints.
      const positions = ray.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, 0, 0, 0.5);
      positions.setXYZ(1, sx, sy, sz);
      positions.needsUpdate = true;

      // Trajectory arc for today: sample the sun every 5 minutes, drop samples below
      // the horizon, build a polyline in scene meters. We rebuild the buffer attribute
      // fresh each time rather than calling setFromPoints — setFromPoints reuses the
      // existing attribute and refuses to shrink it, which leaves stale data + warnings
      // when going from a long summer arc to a short winter arc.
      const day = new Date(date);
      day.setHours(0, 0, 0, 0);
      const samples: number[] = [];
      for (let m = 0; m <= 1440; m += 5) {
        const t = new Date(+day + m * 60_000);
        const pos = SunCalc.getPosition(t, LAT, LNG);
        if (pos.altitude < -0.02) continue;
        const td = sunDirection({ altitude: pos.altitude, azimuth: pos.azimuth });
        samples.push(td.x * RADIUS, td.y * RADIUS, Math.max(0.5, td.z * RADIUS));
      }
      trajectory.geometry.dispose();
      const newGeo = new THREE.BufferGeometry();
      newGeo.setAttribute('position', new THREE.Float32BufferAttribute(samples, 3));
      trajectory.geometry = newGeo;
    },
  };
}
