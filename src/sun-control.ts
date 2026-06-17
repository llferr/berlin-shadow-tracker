import SunCalc from 'suncalc';
import type { SunPosition } from './sun';

// Sky-dome sun widget. The circle is a top-down view of the celestial hemisphere:
// the centre is the zenith (sun directly overhead), the rim is the horizon. North is at
// the top of the dome. The user drags the sun handle to scrub through the day; we find
// the closest matching time on the current date and push it back through the time controls.

const LAT = 52.5163;
const LNG = 13.3777;
const RADIUS = 100; // SVG viewBox units

const NS = 'http://www.w3.org/2000/svg';

export type SunControl = {
  update(sun: SunPosition, date: Date): void;
};

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Convert sun (altitude, azimuth) into SVG viewBox coordinates.
// SunCalc azimuth: 0 = south, +π/2 = west, ±π = north, -π/2 = east.
// We want north at the top of the dome. compass = azimuth + π (in rad, CW from north).
function sunToPoint(sun: SunPosition): [number, number] {
  const dist = Math.max(0, 1 - sun.altitude / (Math.PI / 2)) * RADIUS;
  const compass = sun.azimuth + Math.PI;
  const x = Math.sin(compass) * dist;
  const y = -Math.cos(compass) * dist;
  return [x, y];
}

function pointToSun(x: number, y: number): SunPosition {
  const dist = Math.min(RADIUS, Math.hypot(x, y));
  const altitude = (Math.PI / 2) * (1 - dist / RADIUS);
  // atan2(x, -y) → compass angle in radians measured CW from the +Y_screen-up direction (= north).
  const compass = Math.atan2(x, -y);
  const azimuth = compass - Math.PI;
  return { altitude, azimuth };
}

function angularDistance(a1: number, az1: number, a2: number, az2: number): number {
  const c = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(az1 - az2);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

function findClosestTime(target: SunPosition, dayStart: Date): Date {
  let bestDist = Infinity;
  let bestT = dayStart;
  for (let m = 0; m < 1440; m += 5) {
    const t = new Date(+dayStart + m * 60_000);
    const pos = SunCalc.getPosition(t, LAT, LNG);
    const d = angularDistance(pos.altitude, pos.azimuth, target.altitude, target.azimuth);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }
  return bestT;
}

export function initSunControl(
  container: HTMLElement,
  onScrub: (date: Date) => void,
): SunControl {
  // Idempotent: if HMR / a stray re-import already populated the container, start fresh.
  container.innerHTML = '';

  const svg = svgEl('svg', {
    viewBox: '-115 -115 230 230',
    class: 'sun-svg',
  });

  // Dome background — subtle radial gradient suggests an actual sky.
  const defs = svgEl('defs', {});
  defs.innerHTML = `
    <radialGradient id="dome-gradient" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgba(243, 211, 162, 0.1)" />
      <stop offset="100%" stop-color="rgba(47, 58, 88, 0.5)" />
    </radialGradient>
  `;
  svg.appendChild(defs);

  svg.appendChild(svgEl('circle', { cx: '0', cy: '0', r: String(RADIUS), class: 'dome' }));

  // Cross-hairs at cardinal axes.
  svg.appendChild(
    svgEl('line', { x1: String(-RADIUS), y1: '0', x2: String(RADIUS), y2: '0', class: 'axis' }),
  );
  svg.appendChild(
    svgEl('line', { x1: '0', y1: String(-RADIUS), x2: '0', y2: String(RADIUS), class: 'axis' }),
  );

  // Cardinal labels.
  const dirs: [string, number, number][] = [
    ['N', 0, -RADIUS - 6],
    ['E', RADIUS + 8, 4],
    ['S', 0, RADIUS + 12],
    ['W', -(RADIUS + 8), 4],
  ];
  for (const [label, x, y] of dirs) {
    const t = svgEl('text', {
      x: String(x),
      y: String(y),
      'text-anchor': 'middle',
      class: 'dir-label',
    });
    t.textContent = label;
    svg.appendChild(t);
  }

  // Daily solar arc — sampled every 15 min, drawn for altitudes > 0.
  const arcPath = svgEl('path', { class: 'sun-path', fill: 'none', d: '' });
  svg.appendChild(arcPath);

  // The sun handle.
  const handle = svgEl('circle', { cx: '0', cy: '0', r: '8', class: 'sun-handle' });
  svg.appendChild(handle);

  container.appendChild(svg);

  let currentDate = new Date();

  // Drag handling: pointer events on the SVG itself so the user can grab anywhere inside
  // the dome, not just on the handle exactly.
  let dragging = false;

  const eventToViewBox = (e: PointerEvent): [number, number] => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 230 - 115;
    const y = ((e.clientY - rect.top) / rect.height) * 230 - 115;
    return [x, y];
  };

  const applyDrag = (e: PointerEvent) => {
    const [vbX, vbY] = eventToViewBox(e);
    const target = pointToSun(vbX, vbY);
    const day = new Date(currentDate);
    day.setHours(0, 0, 0, 0);
    const newTime = findClosestTime(target, day);
    onScrub(newTime);
  };

  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    applyDrag(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging) applyDrag(e);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    svg.releasePointerCapture(e.pointerId);
    handle.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  const updateHandle = (sun: SunPosition) => {
    const [x, y] = sunToPoint(sun);
    handle.setAttribute('cx', x.toFixed(2));
    handle.setAttribute('cy', y.toFixed(2));
    handle.classList.toggle('below-horizon', sun.altitude <= 0);
  };

  const updateArc = (date: Date) => {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    let d = '';
    for (let m = 0; m <= 1440; m += 15) {
      const t = new Date(+day + m * 60_000);
      const pos = SunCalc.getPosition(t, LAT, LNG);
      if (pos.altitude <= 0) continue;
      const [x, y] = sunToPoint(pos);
      d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    arcPath.setAttribute('d', d);
  };

  return {
    update(sun, date) {
      currentDate = date;
      updateHandle(sun);
      updateArc(date);
    },
  };
}
