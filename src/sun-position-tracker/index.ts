import SunCalc from 'suncalc';

const LAT = 52.5163;
const LNG = 13.3777;
const NS = 'http://www.w3.org/2000/svg';

// ── Geometry (SVG user units) ──────────────────────────────────────────────
const CX = 110; // circle centre x
const CY = 104; // circle centre y (horizon line)
const R = 88; // arc centreline radius
const STROKE = 14;
const SUN_R = 16; // dark sun disc radius (32px diameter, per Figma)
const KNOB_HOLE = 3; // keyhole cutout radius (panel-coloured hole punched into the arc's end cap)
const VB_W = 220;
const VB_H = 112;

const TOP = Math.PI / 2; // angle of the zenith (top of the arc)

// Arc half-span (radians from vertical) at the seasonal extremes. Summer opens
// the arc to the full horizon; winter pulls the knobs up into a shallow cap.
const H_MIN = 0.78; // winter solstice  (~45° → knobs at ~134°/46°, matches Figma)
const H_MAX = Math.PI / 2; // summer solstice (knobs at the horizon ends)

const SUMMER_SOLSTICE_DOY = 172; // Jun 21
const WINTER_SOLSTICE_DOY = 355; // Dec 21

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type SunPositionTracker = {
  update(date: Date): void;
};

// ── Small helpers ───────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const arcPoint = (a: number): [number, number] => [CX + R * Math.cos(a), CY - R * Math.sin(a)];

// Arc path from angle `aFrom` down to `aTo` (aFrom > aTo), travelling over the top.
function arcPath(aFrom: number, aTo: number): string {
  const [x0, y0] = arcPoint(aFrom);
  const [x1, y1] = arcPoint(aTo);
  const large = Math.abs(aFrom - aTo) > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function dateToDOY(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((+date - +start) / 86_400_000);
}

const formatTime = (d: Date) =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatDate = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

// At a solstice show the precise day; otherwise the symmetric knob position represents two
// equal-day-length periods, so show them as a pair of months mirrored around June (e.g. "May • July").
function formatDateLabel(d: Date): string {
  const doy = dateToDOY(d);
  if (Math.abs(doy - SUMMER_SOLSTICE_DOY) <= 2 || Math.abs(doy - WINTER_SOLSTICE_DOY) <= 2) {
    return formatDate(d);
  }
  const m = d.getMonth();
  const mirror = (10 - m + 12) % 12; // month with the same day length, reflected across June
  if (m === mirror) return MONTHS[m];
  return `${MONTHS[Math.min(m, mirror)]} • ${MONTHS[Math.max(m, mirror)]}`;
}

// "Winterness": 0 at the summer solstice, 1 at the winter solstice. A cosine of
// the day-of-year — smooth, symmetric across the year, and tracks the seasonal
// swing in solar altitude. This single function drives the arc width and is the
// exact inverse used by dateForHalfSpan, so knobs and rendering never disagree.
function winterness(doy: number): number {
  return (1 - Math.cos((2 * Math.PI * (doy - SUMMER_SOLSTICE_DOY)) / 365)) / 2;
}

// Half-span of the arc for a given date (summer = full horizon, winter = narrow cap).
function halfSpanForDate(date: Date): number {
  return H_MAX - winterness(dateToDOY(date)) * (H_MAX - H_MIN);
}

// Fraction of daylight elapsed (0 = sunrise, 1 = sunset); clamps through night.
function dayFraction(date: Date): number {
  const t = SunCalc.getTimes(date, LAT, LNG);
  if (!t.sunrise || !t.sunset || isNaN(+t.sunrise) || isNaN(+t.sunset)) return 0.5;
  return clamp((+date - +t.sunrise) / (+t.sunset - +t.sunrise), 0, 1);
}

// Inverse of halfSpanForDate: map a knob's half-span back to a date, preserving
// the clock time and staying on the same side of the year (spring vs. fall) as
// the reference date so the date moves continuously under the cursor.
function dateForHalfSpan(h: number, ref: Date): Date {
  const w = clamp((H_MAX - h) / (H_MAX - H_MIN), 0, 1);
  const offsetDays = (Math.acos(clamp(1 - 2 * w, -1, 1)) * 365) / (2 * Math.PI);
  const refDoy = dateToDOY(ref);
  const onFallSide = refDoy > SUMMER_SOLSTICE_DOY && refDoy <= WINTER_SOLSTICE_DOY;
  let doy = Math.round(SUMMER_SOLSTICE_DOY + (onFallSide ? offsetDays : -offsetDays));
  if (doy < 1) doy += 365;
  if (doy > 365) doy -= 365;
  const d = new Date(ref.getFullYear(), 0, 1, ref.getHours(), ref.getMinutes(), 0, 0);
  d.setDate(doy);
  return d;
}

function seasonTag(date: Date): { text: string; variant: string } {
  const doy = dateToDOY(date);
  if (Math.abs(doy - SUMMER_SOLSTICE_DOY) <= 2) return { text: 'Summer solstice', variant: 'summer' };
  if (Math.abs(doy - WINTER_SOLSTICE_DOY) <= 2) return { text: 'Winter solstice', variant: 'winter' };
  // Season follows the knob's distance from the solstices (0 = summer, 1 = winter), so it stays
  // consistent with the symmetric month-pair the date shows.
  const w = winterness(doy);
  if (w < 0.4) return { text: 'Summer', variant: 'summer' };
  if (w > 0.6) return { text: 'Winter', variant: 'winter' };
  return { text: 'Mid-season', variant: 'mid' };
}

// ── Component ────────────────────────────────────────────────────────────────
export function initSunPositionTracker(
  container: HTMLElement,
  onScrub: (date: Date) => void,
): SunPositionTracker {
  container.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'sun-tracker';

  const svg = svgEl('svg', {
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    class: 'sun-tracker-svg',
    role: 'group',
    'aria-label': 'Sun position over the day',
  });

  // Gradient for the filled arc.
  const defs = svgEl('defs');
  // Symmetric amber gradient — light at the knob ends, saturated at the top (sampled from Figma).
  // Background-track gradient — subtle warm-beige top → cool blue-gray ends (sampled from Figma 163:74).
  defs.innerHTML = `
    <linearGradient id="sun-arc-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#F6BC6E"/>
      <stop offset="50%" stop-color="#E5A048"/>
      <stop offset="100%" stop-color="#F6BC6E"/>
    </linearGradient>
    <linearGradient id="sun-arc-bg-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f2efe8"/>
      <stop offset="100%" stop-color="#e7e7e5"/>
    </linearGradient>`;
  svg.appendChild(defs);

  // Background semicircle (full horizon-to-horizon).
  svg.appendChild(
    svgEl('path', {
      d: arcPath(Math.PI, 0),
      fill: 'none',
      stroke: 'url(#sun-arc-bg-grad)',
      'stroke-width': String(STROKE),
      'stroke-linecap': 'round',
    }),
  );

  // Filled arc (sunrise → current sun position).
  const fillArc = svgEl('path', {
    class: 'arc-fill',
    fill: 'none',
    stroke: 'url(#sun-arc-grad)',
    'stroke-width': String(STROKE),
    'stroke-linecap': 'round',
  });
  svg.appendChild(fillArc);

  // ── Knobs (date-range endpoints) ──
  const makeKnob = (label: string) => {
    const g = svgEl('g', {
      class: 'knob',
      role: 'slider',
      tabindex: '0',
      'aria-label': label,
    });
    // Keyhole: a panel-coloured cutout punched into the arc's end cap, plus a larger
    // transparent hit circle so the small mark stays easy to grab and drag.
    const hole = svgEl('circle', { class: 'knob-hole', r: String(KNOB_HOLE) });
    const hit = svgEl('circle', { class: 'knob-hit', r: '14', fill: 'transparent' });
    g.append(hole, hit);
    svg.appendChild(g);
    return { g, hole, hit };
  };
  const leftKnob = makeKnob('Date — winter end');
  const rightKnob = makeKnob('Date — summer end');

  // ── Sun handle ──
  const sunG = svgEl('g', {
    class: 'sun-handle',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Time of day',
  });
  const sunDisc = svgEl('circle', { class: 'sun-disc', r: String(SUN_R), cx: '0', cy: '0' });
  sunG.appendChild(sunDisc);
  // Exact "Sun" icon from Figma (163:77): outline circle + 8 rays, 18×18, centred in the 32px disc.
  const sunGlyph = svgEl('g', { class: 'sun-glyph', transform: 'translate(-9 -9)' });
  sunGlyph.appendChild(
    svgEl('path', {
      d: 'M9 0.75V2.25M9 15.75V17.25M3.165 3.165L4.23 4.23M13.77 13.77L14.835 14.835M0.75 9H2.25M15.75 9H17.25M3.165 14.835L4.23 13.77M13.77 4.23L14.835 3.165M12.75 9C12.75 11.0711 11.0711 12.75 9 12.75C6.92893 12.75 5.25 11.0711 5.25 9C5.25 6.92893 6.92893 5.25 9 5.25C11.0711 5.25 12.75 6.92893 12.75 9Z',
      fill: 'none',
      stroke: '#FFD84B',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  sunG.appendChild(sunGlyph);
  sunG.appendChild(svgEl('circle', { class: 'sun-hit', r: '22', cx: '0', cy: '0', fill: 'transparent' }));
  svg.appendChild(sunG);

  root.appendChild(svg);

  // ── Readout (nested into the bowl) + season pill ──
  const readout = document.createElement('div');
  readout.className = 'sun-tracker-readout';
  const timeEl = document.createElement('div');
  timeEl.className = 'sun-tracker-time';
  const dateEl = document.createElement('div');
  dateEl.className = 'sun-tracker-date';
  readout.append(timeEl, dateEl);
  root.appendChild(readout);

  const seasonEl = document.createElement('div');
  seasonEl.className = 'sun-tracker-season';
  root.appendChild(seasonEl);

  container.appendChild(root);

  // ── State ──
  let currentDate = new Date();
  let dragging: 'sun' | 'left' | 'right' | null = null;

  // ── Rendering ──
  const positionKnob = (k: typeof leftKnob, a: number) => {
    const [px, py] = arcPoint(a);
    k.hole.setAttribute('cx', px.toFixed(2));
    k.hole.setAttribute('cy', py.toFixed(2));
    k.hit.setAttribute('cx', px.toFixed(2));
    k.hit.setAttribute('cy', py.toFixed(2));
  };

  const render = () => {
    const h = halfSpanForDate(currentDate);
    const leftAngle = TOP + h;
    const rightAngle = TOP - h;
    const f = dayFraction(currentDate);
    const sunAngle = leftAngle - f * (leftAngle - rightAngle);

    // Orange fill spans the full daylight arc, knob to knob; the sun is a handle on top of it
    // (it does not terminate the fill).
    fillArc.setAttribute('d', arcPath(leftAngle, rightAngle));

    positionKnob(leftKnob, leftAngle);
    positionKnob(rightKnob, rightAngle);

    const [sx, sy] = arcPoint(sunAngle);
    sunG.setAttribute('transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`);

    timeEl.textContent = formatTime(currentDate);
    dateEl.textContent = formatDateLabel(currentDate);
    const tag = seasonTag(currentDate);
    seasonEl.textContent = tag.text;
    seasonEl.className = `sun-tracker-season ${tag.variant}`;

    // ARIA
    sunG.setAttribute('aria-valuetext', formatTime(currentDate));
    leftKnob.g.setAttribute('aria-valuetext', `${formatDateLabel(currentDate)} (day length)`);
    rightKnob.g.setAttribute('aria-valuetext', `${formatDateLabel(currentDate)} (day length)`);
  };

  // ── Pointer geometry ──
  const toSVG = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * VB_W, ((e.clientY - r.top) / r.height) * VB_H];
  };
  const pointerAngle = (x: number, y: number) => clamp(Math.atan2(CY - y, x - CX), 0, Math.PI);

  // ── Apply a drag ──
  const scrubSunToAngle = (angle: number) => {
    const h = halfSpanForDate(currentDate);
    const leftAngle = TOP + h;
    const rightAngle = TOP - h;
    const a = clamp(angle, rightAngle, leftAngle);
    const f = (leftAngle - a) / (leftAngle - rightAngle || 1);
    const t = SunCalc.getTimes(currentDate, LAT, LNG);
    if (!t.sunrise || !t.sunset) return;
    const next = new Date(+t.sunrise + f * (+t.sunset - +t.sunrise));
    currentDate = next;
    render();
    onScrub(next);
  };

  const scrubKnobToAngle = (which: 'left' | 'right', angle: number) => {
    // Convert either knob to a half-span, mirror across the vertical centre.
    const h = which === 'left' ? clamp(angle - TOP, H_MIN, H_MAX) : clamp(TOP - angle, H_MIN, H_MAX);
    const next = dateForHalfSpan(h, currentDate);
    currentDate = next;
    render();
    onScrub(next);
  };

  // ── Pointer handlers ──
  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as SVGElement;
    if (t.closest('.sun-handle')) dragging = 'sun';
    else if (t.closest('.knob') === leftKnob.g) dragging = 'left';
    else if (t.closest('.knob') === rightKnob.g) dragging = 'right';
    else return;

    svg.setPointerCapture(e.pointerId);
    root.classList.add('is-dragging');
    (dragging === 'sun' ? sunG : dragging === 'left' ? leftKnob.g : rightKnob.g).classList.add('dragging');
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const [x, y] = toSVG(e);
    const angle = pointerAngle(x, y);
    if (dragging === 'sun') scrubSunToAngle(angle);
    else scrubKnobToAngle(dragging, angle);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    root.classList.remove('is-dragging');
    sunG.classList.remove('dragging');
    leftKnob.g.classList.remove('dragging');
    rightKnob.g.classList.remove('dragging');
    dragging = null;
  };

  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  // ── Keyboard ──
  sunG.addEventListener('keydown', (e: KeyboardEvent) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 30 : 10; // minutes
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      currentDate = new Date(+currentDate - step * 60_000);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      currentDate = new Date(+currentDate + step * 60_000);
    } else return;
    e.preventDefault();
    render();
    onScrub(currentDate);
  });

  // Both knobs are symmetric, so they share one handler: narrow (toward winter)
  // on Left/Down, widen (toward summer) on Right/Up.
  const knobKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const h = clamp(halfSpanForDate(currentDate) + dir * 0.04, H_MIN, H_MAX);
    const next = dateForHalfSpan(h, currentDate);
    currentDate = next;
    render();
    onScrub(next);
  };
  leftKnob.g.addEventListener('keydown', knobKey);
  rightKnob.g.addEventListener('keydown', knobKey);

  render();

  return {
    update(date: Date) {
      if (dragging) return; // user interaction wins
      currentDate = date;
      render();
    },
  };
}
