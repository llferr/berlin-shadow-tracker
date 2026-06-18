import * as THREE from 'three';
import SunCalc from 'suncalc';
import { sunDirection, type SunPosition } from './sun';

// On-map 3D sun compass — a faint horizontal ring laid on the ground at the user's look-at
// point, the sun rendered at its true 3D direction scaled to the ring's radius, the day's solar
// arc as a polyline, and N/E/S/W laid flat inside the ring, each rotated to point at its
// direction. Everything draws depthTest-off + high renderOrder so the dial overlays buildings.

const LAT = 52.5163;
const LNG = 13.3777;
const RADIUS = 90; // metres — large enough to be readable at z16+, still fits a city block

const RING_COLOR = 0x000000; // faint semi-transparent black reference circle
const TRAJECTORY_COLOR = 0xf6bc6e; // lighter amber — the day's sun path
const SUN_COLOR = 0xffd84b; // golden — same as the control's sun icon

// Cardinal label: a flat white letter on a transparent plane, laid in the ground (XY) plane and
// rotated (see labelDefs) so it points toward its compass direction.
function makeLabel(text: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // The map shows the +Y=south ground plane "north-up", which is a reflection — pre-mirror the
  // canvas so the flat glyphs read the right way round instead of backwards.
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.font = 'bold 90px ui-sans-serif, system-ui, -apple-system';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Soft shadow (a blur, not a hard outline) so the white letters stay legible on the light
  // basemap without a heavy stroke.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 9;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 70);
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
  /** Resize the whole compass so its ring has the given world radius (metres). */
  setWorldRadius(meters: number): void;
  /** Orient the cardinal labels to face the camera (billboard). Call each frame with the map's
   *  bearing + pitch in radians. */
  faceCamera(bearing: number, pitch: number): void;
  update(sun: SunPosition, date: Date): void;
};

export function createSunCompass(): SunCompass {
  const group = new THREE.Group();

  // Single faint black ring on the ground.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RADIUS - 2.5, RADIUS + 2.5, 128, 1),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  ring.position.z = 0.3;
  ring.renderOrder = 10;
  group.add(ring);

  // Daily solar trajectory — re-sampled on each update() call.
  const trajectory = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: TRAJECTORY_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    }),
  );
  trajectory.renderOrder = 11;
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
  ray.renderOrder = 12;
  group.add(ray);

  // Sun marker — bright golden sphere.
  const sunMarker = new THREE.Mesh(
    new THREE.SphereGeometry(7, 24, 16),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR, transparent: true, depthTest: false, depthWrite: false }),
  );
  sunMarker.renderOrder = 13;
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
  halo.renderOrder = 14;
  group.add(halo);

  // Cardinal labels — laid flat just inside the ring, each rotated about Z so the letter points
  // toward its compass direction (a flat compass rose). Scene: +X=east, +Y=south, +Z=up.
  // Positioned inside the ring at each compass point; kept upright + facing the camera
  // (billboarded via faceCamera) so they stay readable at any pitch/bearing.
  const labels: THREE.Mesh[] = [];
  const RL = RADIUS - 24;
  const labelDefs: [string, number, number][] = [
    ['N', 0, -RL],
    ['E', RL, 0],
    ['S', 0, RL],
    ['W', -RL, 0],
  ];
  for (const [text, x, y] of labelDefs) {
    const lbl = makeLabel(text);
    lbl.position.set(x, y, 4);
    labels.push(lbl);
    group.add(lbl);
  }

  // Reused scratch objects for faceCamera (no per-frame allocation).
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

      // Trajectory arc for today, rebuilt fresh each time (so a short winter arc doesn't keep
      // stale data from a long summer arc).
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
