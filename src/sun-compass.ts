import * as THREE from 'three';
import SunCalc from 'suncalc';
import { sunDirection, type SunPosition } from './sun';

// On-map 3D sun compass — a horizontal ring laid on the ground at the user's look-at
// point, the sun rendered at its true 3D direction (azimuth + altitude) scaled to the
// ring's radius, and the day's solar arc drawn as a polyline traversing the dome.
// Everything draws with depthTest off + a high renderOrder so the dial OVERLAYS the
// buildings (tall buildings never hide it).

const LAT = 52.5163;
const LNG = 13.3777;
const RADIUS = 90; // metres — large enough to be readable at z16+, still fits a city block

const RING_COLOR = 0x000000; // semi-transparent black reference circle (white cardinal letters on it)
const TRAJECTORY_COLOR = 0xf6bc6e; // lighter amber — the day's sun path
const SUN_COLOR = 0xffd84b; // golden — same as the control's sun icon

// Cardinal label as a textured plane (not a Sprite). The custom-layer camera bakes the view
// into the projection matrix and has no view matrix of its own, so Three's Sprite billboarding
// renders flat on the ground and vanishes at pitch — we orient these planes manually instead
// (see faceCamera). The plane is double-sided so it shows whichever way it ends up facing.
function makeLabel(text: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // The camera-facing label basis is a reflection in this scene (+Y=south), which flips text
  // horizontally — pre-mirror the canvas so the glyphs render the right way round.
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.font = 'bold 84px ui-sans-serif, system-ui, -apple-system';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = 20;
  return mesh;
}

export type SunCompass = {
  group: THREE.Group;
  setCenter(x: number, y: number): void;
  /** Resize the whole compass so its ring has the given world radius (metres). Used to keep
   *  the compass a roughly constant on-screen size across zoom levels. */
  setWorldRadius(meters: number): void;
  /** Orient the cardinal labels to face the camera (manual billboarding). Call each frame with
   *  the map's bearing + pitch in radians — Three's Sprite billboarding can't work with the
   *  custom-layer's bare camera, so we build the camera-facing basis ourselves. */
  faceCamera(bearing: number, pitch: number): void;
  update(sun: SunPosition, date: Date): void;
};

export function createSunCompass(): SunCompass {
  const group = new THREE.Group();

  // Ring on the ground. RingGeometry sits in the XY plane facing +Z — perfect for Z-up.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS - 2.5, RADIUS + 2.5, 128, 1),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  ring.position.z = 0.3;
  group.add(ring);

  // Inner soft halo so the ring reads as part of an ellipse in perspective.
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS - 6, RADIUS - 2.5, 128, 1),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
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
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    }),
  );
  group.add(trajectory);

  // Sun "ray" — a thin line from the centre of the ring to the sun marker.
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]),
    new THREE.LineBasicMaterial({
      color: SUN_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    }),
  );
  group.add(ray);

  // Sun marker — bright golden sphere (no shading, emissive look).
  const sunMarker = new THREE.Mesh(
    new THREE.SphereGeometry(7, 24, 16),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR, transparent: true, depthTest: false, depthWrite: false }),
  );
  group.add(sunMarker);

  // Soft halo sprite behind the sun for the glow effect.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 128;
  const haloCtx = haloCanvas.getContext('2d')!;
  const grad = haloCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 216, 75, 0.95)');
  grad.addColorStop(0.4, 'rgba(245, 180, 60, 0.45)');
  grad.addColorStop(1, 'rgba(245, 180, 60, 0)');
  haloCtx.fillStyle = grad;
  haloCtx.fillRect(0, 0, 128, 128);
  const haloTexture = new THREE.CanvasTexture(haloCanvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.set(34, 34, 1);
  group.add(halo);

  // Draw the dial on top of the buildings, in a sensible internal order.
  ring.renderOrder = 10;
  innerRing.renderOrder = 10;
  trajectory.renderOrder = 11;
  ray.renderOrder = 12;
  sunMarker.renderOrder = 13;
  halo.renderOrder = 14;

  // Cardinal labels (N / E / S / W). Scene convention: +X=east, +Y=south, +Z=up.
  const labels: THREE.Mesh[] = [];
  const labelDefs: [string, number, number][] = [
    ['N', 0, -RADIUS],
    ['E', RADIUS, 0],
    ['S', 0, RADIUS],
    ['W', -RADIUS, 0],
  ];
  for (const [text, x, y] of labelDefs) {
    const lbl = makeLabel(text);
    lbl.position.set(x, y, 6);
    labels.push(lbl);
    group.add(lbl);
  }

  // Reused scratch objects for faceCamera so it allocates nothing per frame.
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _quat = new THREE.Quaternion();

  return {
    group,

    setCenter(x: number, y: number) {
      group.position.set(x, y, 0);
    },

    setWorldRadius(meters: number) {
      group.scale.setScalar(meters / RADIUS);
    },

    faceCamera(bearing: number, pitch: number) {
      const cb = Math.cos(bearing);
      const sb = Math.sin(bearing);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // Screen-up and camera-ward (toward viewer) vectors in scene space (+X east, +Y south, +Z up).
      _up.set(sb * cp, -cb * cp, sp);
      _fwd.set(-sb * sp, cb * sp, cp);
      _right.crossVectors(_up, _fwd).normalize();
      _basis.makeBasis(_right, _up, _fwd);
      _quat.setFromRotationMatrix(_basis);
      for (const l of labels) l.quaternion.copy(_quat);
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

      // Trajectory arc for today: sample the sun every 5 minutes, drop samples below the
      // horizon, build a polyline in scene meters. Rebuild the buffer fresh each time so a
      // shorter winter arc doesn't leave stale data from a longer summer arc.
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
