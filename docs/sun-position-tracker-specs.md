# Sun Position Tracker Component — Technical Specifications

## Overview

A semicircular sun position widget that visualizes the sun's daily arc across the sky, with interactive controls for scrubbing through time and adjusting the date range based on seasonal sun positions.

---

## Component Architecture

### Visual Structure

```
                    [Sun Icon]
                         ●─────────────────────●  ← Orange arc (filled portion)
                        ╱                       ╲
                       ╱                         ╲
                      ╱                           ╲
         [Knob] ○───╱─────────────────────────────╲───○ [Knob]
                    ╲                             ╱
                     ╲           12:34           ╱
                      ╲        Jun 21           ╱
                       ╲                       ╱
                        ╲      [Summer]       ╱
                         ╲                   ╱
```

### Core Elements

| Element | Description | Interactive |
|---------|-------------|-------------|
| **Semicircular Arc** | Represents the sun's path across the sky (horizon to horizon) | No |
| **Orange Fill** | Shows the portion of the day elapsed (sunrise → current time) | No |
| **Sun Icon** | Draggable handle representing current sun position on the arc | Yes |
| **Left Knob (○)** | Start of visible arc range; draggable to change date | Yes |
| **Right Knob (○)** | End of visible arc range; draggable to change date | Yes |
| **Time Display** | Large centered text showing current time (HH:MM) | No |
| **Date Display** | Shows current date below time | No |
| **Season Tag** | Badge showing season/solstice status | No |

---

## Functional Requirements

### FR-01: Sun Position Constraint

The draggable sun icon must be constrained to move only along the semicircular arc between the two date range knobs.

**Constraints:**
- Sun position is calculated based on `SunCalc.getPosition()` for the current location (Berlin: 52.5163°N, 13.3777°E)
- The sun cannot be dragged past the left knob (minimum position) or right knob (maximum position)
- Position on the arc maps to a specific time of day at the current date
- Altitude angle maps to vertical position on the arc
- The sun follows the orange arc path exactly

**Implementation:**
```typescript
// Convert sun position to point on semicircular arc
function sunToArcPoint(altitude: number, azimuth: number): [number, number] {
  // Map altitude (0 to π/2) to position along the arc (0 to π)
  const angle = Math.PI * (1 - altitude / (Math.PI / 2));
  const x = Math.cos(angle) * ARC_RADIUS;
  const y = -Math.sin(angle) * ARC_RADIUS;
  return [x, y];
}

// Constrain sun position to valid range between knobs
function constrainSunPosition(
  position: [number, number],
  leftKnobAngle: number,
  rightKnobAngle: number
): [number, number] {
  const angle = Math.atan2(position[1], position[0]);
  const clampedAngle = Math.max(leftKnobAngle, Math.min(rightKnobAngle, angle));
  return [
    Math.cos(clampedAngle) * ARC_RADIUS,
    -Math.sin(clampedAngle) * ARC_RADIUS
  ];
}
```

### FR-02: Date Range Knobs

Two light gray knobs at the endpoints of the arc control the visible date range. They move simultaneously and symmetrically.

**Behavior:**
- Left knob represents the minimum sun position (winter solstice: Dec 21)
- Right knob represents the maximum sun position (summer solstice: Jun 21)
- Dragging either knob updates both knobs symmetrically
- The arc fill (orange) represents the sun's position relative to the knob positions
- Date display updates in real-time as knobs are dragged

**Symmetrical Movement Logic:**
```typescript
interface KnobState {
  leftAngle: number;   // radians, 0 = horizontal left
  rightAngle: number;  // radians, 0 = horizontal right
  leftDate: Date;
  rightDate: Date;
}

function handleKnobDrag(
  draggedKnob: 'left' | 'right',
  newAngle: number,
  currentState: KnobState
): KnobState {
  // Calculate the angular displacement from the center
  const centerAngle = Math.PI / 2; // top of arc
  const displacement = Math.abs(newAngle - centerAngle);
  
  if (draggedKnob === 'left') {
    return {
      leftAngle: newAngle,
      rightAngle: Math.PI - newAngle, // Mirror across center
      leftDate: dateFromAngle(newAngle),
      rightDate: dateFromAngle(Math.PI - newAngle),
    };
  } else {
    return {
      leftAngle: Math.PI - newAngle,
      rightAngle: newAngle,
      leftDate: dateFromAngle(Math.PI - newAngle),
      rightDate: dateFromAngle(newAngle),
    };
  }
}
```

### FR-03: Date Calculation from Knob Position

When knobs are dragged, the date display updates to show the date where the sun would be at that arc position.

**Algorithm:**
1. Map knob angle to a day-of-year (DOY) value
2. The mapping is based on the sun's maximum altitude at solar noon for each day
3. Winter solstice (DOY 355/356) = minimum altitude = leftmost knob position
4. Summer solstice (DOY 172/173) = maximum altitude = rightmost knob position
5. Linear interpolation between these extremes for intermediate dates

**Implementation:**
```typescript
const WINTER_SOLSTICE_DOY = 355; // Dec 21
const SUMMER_SOLSTICE_DOY = 172; // Jun 21
const LAT = 52.5163;
const LNG = 13.3777;

// Calculate maximum sun altitude for a given day of year
function maxAltitudeForDOY(doy: number): number {
  // Solar declination angle
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (doy - 81));
  const declRad = declination * Math.PI / 180;
  const latRad = LAT * Math.PI / 180;
  
  // Maximum altitude at solar noon
  return Math.PI / 2 - latRad + declRad;
}

// Map angle to DOY
function angleToDOY(angle: number): number {
  // Normalize angle to 0-1 range (0 = left/winter, 1 = right/summer)
  const normalized = 1 - (angle / Math.PI);
  
  // Linear interpolation between solstices
  // Handle wrapping around year boundary
  if (normalized < 0.5) {
    // Left half: winter to summer
    return WINTER_SOLSTICE_DOY + normalized * 2 * (SUMMER_SOLSTICE_DOY - WINTER_SOLSTICE_DOY);
  } else {
    // Right half: summer to winter
    const t = (normalized - 0.5) * 2;
    return SUMMER_SOLSTICE_DOY + t * (365 - SUMMER_SOLSTICE_DOY + WINTER_SOLSTICE_DOY);
  }
}

// DOY to Date
function DOYToDate(doy: number, year: number): Date {
  const date = new Date(year, 0, 1);
  date.setDate(doy);
  return date;
}
```

### FR-04: Season Tag Logic

The season tag displays different labels based on the knob positions.

**States:**

| Condition | Tag Text | Tag Style |
|-----------|----------|-----------|
| Left knob at minimum (Dec 21) | "Winter Solstice" | Light blue/gray badge |
| Right knob at maximum (Jun 21) | "Summer Solstice" | Yellow badge |
| Knobs between extremes | "Winter" or "Summer" | Context-dependent |
| Current date in Mar-May, Sep-Nov | "Spring" or "Fall" | Green or orange badge |

**Implementation:**
```typescript
type SeasonTag = {
  text: string;
  variant: 'winter' | 'summer' | 'spring' | 'fall';
};

function getSeasonTag(
  leftDOY: number,
  rightDOY: number,
  currentDOY: number
): SeasonTag {
  const isWinterSolstice = leftDOY <= WINTER_SOLSTICE_DOY + 2;
  const isSummerSolstice = rightDOY >= SUMMER_SOLSTICE_DOY - 2;
  
  if (isWinterSolstice && isSummerSolstice) {
    // Full range selected
    if (currentDOY >= WINTER_SOLSTICE_DOY || currentDOY < SUMMER_SOLSTICE_DOY) {
      return { text: 'Winter', variant: 'winter' };
    }
    return { text: 'Summer', variant: 'summer' };
  }
  
  if (isWinterSolstice) {
    return { text: 'Winter Solstice', variant: 'winter' };
  }
  
  if (isSummerSolstice) {
    return { text: 'Summer Solstice', variant: 'summer' };
  }
  
  // Determine season based on current date
  const month = new Date(2024, 0, 1).getMonth(); // Get from currentDOY
  if (currentDOY >= 80 && currentDOY < 172) {
    return { text: 'Spring', variant: 'spring' };
  } else if (currentDOY >= 172 && currentDOY < 266) {
    return { text: 'Summer', variant: 'summer' };
  } else if (currentDOY >= 266 && currentDOY < 355) {
    return { text: 'Fall', variant: 'fall' };
  }
  return { text: 'Winter', variant: 'winter' };
}
```

### FR-05: Arc Fill Calculation

The orange arc fill represents the sun's current position relative to the day's sunrise/sunset.

**Calculation:**
- Left endpoint of filled arc = sunrise position
- Right endpoint = current sun position
- Fill grows from left to right as time progresses

```typescript
function calculateArcFill(
  sunriseAzimuth: number,
  sunsetAzimuth: number,
  currentAzimuth: number,
  currentAltitude: number
): number {
  if (currentAltitude <= 0) return 0;
  
  const totalArc = sunsetAzimuth - sunriseAzimuth;
  const elapsed = currentAzimuth - sunriseAzimuth;
  
  return Math.max(0, Math.min(1, elapsed / totalArc));
}
```

---

## State Management

### Component State

```typescript
interface SunTrackerState {
  // Current time/date
  currentDate: Date;
  currentTime: Date;
  
  // Sun position (calculated)
  sunAltitude: number;
  sunAzimuth: number;
  
  // Knob positions (angles in radians)
  leftKnobAngle: number;
  rightKnobAngle: number;
  
  // Derived dates from knob positions
  leftDate: Date;
  rightDate: Date;
  
  // Season information
  seasonTag: SeasonTag;
  
  // Constraints
  minSunAltitude: number; // Calculated from left knob date
  maxSunAltitude: number; // Calculated from right knob date
}
```

### State Transitions

```
User drags sun icon → Update currentTime → Recalculate sun position → Update display
User drags left knob → Update leftDate → Recalculate constraints → Update arc fill
User drags right knob → Update rightDate → Recalculate constraints → Update arc fill
```

---

## API Integration

### SunCalc Usage

The component relies heavily on SunCalc for accurate sun position calculations.

```typescript
import SunCalc from 'suncalc';

const LAT = 52.5163; // Berlin
const LNG = 13.3777;

// Get sun position for a specific date/time
function getSunPosition(date: Date): { altitude: number; azimuth: number } {
  const pos = SunCalc.getPosition(date, LAT, LNG);
  return { altitude: pos.altitude, azimuth: pos.azimuth };
}

// Get sunrise/sunset times
function getSunTimes(date: Date): { sunrise: Date; sunset: Date } {
  const times = SunCalc.getTimes(date, LAT, LNG);
  return { sunrise: times.sunrise, sunset: times.sunset };
}

// Find closest time for a target sun position
function findClosestTime(
  targetAltitude: number,
  targetAzimuth: number,
  dayStart: Date
): Date {
  let bestDist = Infinity;
  let bestTime = dayStart;
  
  // Sample every 5 minutes throughout the day
  for (let m = 0; m <= 1440; m += 5) {
    const t = new Date(+dayStart + m * 60_000);
    const pos = SunCalc.getPosition(t, LAT, LNG);
    const dist = angularDistance(
      pos.altitude, pos.azimuth,
      targetAltitude, targetAzimuth
    );
    if (dist < bestDist) {
      bestDist = dist;
      bestTime = t;
    }
  }
  
  return bestTime;
}
```

---

## SVG Structure

```svg
<svg viewBox="-120 -120 240 240" class="sun-tracker">
  <defs>
    <!-- Arc gradient (orange fill) -->
    <linearGradient id="arc-gradient">
      <stop offset="0%" stop-color="#F3D3A2" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#E4B359" stop-opacity="1"/>
    </linearGradient>
    
    <!-- Background arc gradient -->
    <linearGradient id="arc-bg-gradient">
      <stop offset="0%" stop-color="rgba(255,255,255,0.2)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.05)"/>
    </linearGradient>
  </defs>
  
  <!-- Background arc (full semicircle) -->
  <path 
    class="arc-bg"
    d="M -100 0 A 100 100 0 0 1 100 0"
    fill="none"
    stroke="url(#arc-bg-gradient)"
    stroke-width="12"
  />
  
  <!-- Filled arc (sunrise to current time) -->
  <path 
    class="arc-fill"
    d="M -100 0 A 100 100 0 0 1 0 -100"
    fill="none"
    stroke="url(#arc-gradient)"
    stroke-width="12"
    stroke-linecap="round"
  />
  
  <!-- Left knob (winter solstice) -->
  <circle 
    class="knob knob-left"
    cx="-100" 
    cy="0" 
    r="8"
    fill="#E5E5E5"
    stroke="#999"
    stroke-width="2"
  />
  
  <!-- Right knob (summer solstice) -->
  <circle 
    class="knob knob-right"
    cx="100" 
    cy="0" 
    r="8"
    fill="#E5E5E5"
    stroke="#999"
    stroke-width="2"
  />
  
  <!-- Sun icon (draggable) -->
  <g class="sun-icon" transform="translate(0, -100)">
    <circle cx="0" cy="0" r="12" fill="#333"/>
    <g class="sun-rays">
      <!-- 8 rays radiating outward -->
      <line x1="0" y1="-16" x2="0" y2="-22" stroke="#F3D3A2" stroke-width="2"/>
      <line x1="11" y1="-11" x2="16" y2="-16" stroke="#F3D3A2" stroke-width="2"/>
      <!-- ... more rays ... -->
    </g>
  </g>
  
  <!-- Time display -->
  <text class="time-display" x="0" y="30" text-anchor="middle">
    12:34
  </text>
  
  <!-- Date display -->
  <text class="date-display" x="0" y="50" text-anchor="middle">
    Jun 21
  </text>
  
  <!-- Season tag -->
  <g class="season-tag" transform="translate(0, 75)">
    <rect x="-40" y="-12" width="80" height="24" rx="12" fill="#F3D3A2"/>
    <text x="0" y="4" text-anchor="middle" fill="#333" font-size="11">
      Summer
    </text>
  </g>
</svg>
```

---

## CSS Styling

```css
.sun-tracker {
  width: 200px;
  height: 200px;
  touch-action: none;
  cursor: default;
}

.arc-bg {
  opacity: 0.5;
}

.arc-fill {
  transition: d 0.1s ease-out;
}

.knob {
  cursor: grab;
  transition: r 0.15s ease, fill 0.15s ease;
}

.knob:hover {
  r: 10;
  fill: #CCC;
}

.knob.dragging {
  cursor: grabbing;
  r: 11;
  fill: #BBB;
}

.sun-icon {
  cursor: grab;
  filter: drop-shadow(0 0 8px rgba(243, 211, 162, 0.6));
}

.sun-icon:hover {
  filter: drop-shadow(0 0 12px rgba(243, 211, 162, 0.9));
}

.sun-icon.dragging {
  cursor: grabbing;
}

.sun-rays {
  transform-origin: center;
  animation: rotate 20s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.time-display {
  font-family: 'Switzer', sans-serif;
  font-size: 28px;
  font-weight: 700;
  fill: #1a1a1a;
}

.date-display {
  font-family: 'Switzer', sans-serif;
  font-size: 14px;
  fill: #666;
}

.season-tag text {
  font-family: 'Switzer', sans-serif;
  font-size: 11px;
  font-weight: 600;
}

/* Season tag variants */
.season-tag.winter rect { fill: #E0E7EE; }
.season-tag.summer rect { fill: #F3D3A2; }
.season-tag.spring rect { fill: #D4EDDA; }
.season-tag.fall rect { fill: #FDEBD0; }
```

---

## Interaction Flow

### Sun Icon Drag

1. **Pointer Down** on sun icon:
   - Set `dragging = true`
   - Capture pointer events
   - Add `.dragging` class

2. **Pointer Move**:
   - Convert pointer coordinates to SVG viewBox coordinates
   - Calculate target angle from center
   - Constrain angle to valid range (between knobs)
   - Convert angle to sun position (altitude, azimuth)
   - Find closest matching time using `findClosestTime()`
   - Call `onTimeChange(newTime)`

3. **Pointer Up**:
   - Set `dragging = false`
   - Release pointer capture
   - Remove `.dragging` class

### Knob Drag

1. **Pointer Down** on knob:
   - Set `draggingKnob = 'left' | 'right'`
   - Capture pointer events

2. **Pointer Move**:
   - Calculate new angle from pointer position
   - Update both knobs symmetrically (mirror across center)
   - Calculate new dates for both knobs
   - Update `minSunAltitude` and `maxSunAltitude`
   - Recalculate arc fill
   - Update season tag
   - Call `onDateRangeChange(leftDate, rightDate)`

3. **Pointer Up**:
   - Set `draggingKnob = null`
   - Release pointer capture

---

## File Structure

```
src/
├── sun-position-tracker/
│   ├── index.ts              # Main export
│   ├── SunPositionTracker.ts # Component class
│   ├── state.ts              # State management
│   ├── calculations.ts       # Sun position math
│   ├── constraints.ts        # Drag constraints
│   ├── svg-builder.ts        # SVG element creation
│   └── types.ts              # TypeScript interfaces
├── styles/
│   └── sun-position-tracker.css
└── main.ts                   # Integration point
```

---

## Integration with Existing Codebase

### Replace Current sun-control.ts

The new component will replace the existing `sun-control.ts` which currently implements a sky-dome view. The integration points are:

```typescript
// main.ts changes
import { initSunPositionTracker } from './sun-position-tracker';

const sunTracker = initSunPositionTracker(
  document.getElementById('sun-control')!,
  (newDate) => {
    timeControls.setCurrent(newDate);
  }
);

const timeControls = initTimeControls((sun, date) => {
  shadow.setSun(sun, date);
  syncMapMode(sun.altitude);
  tileManager?.setLeafOn(date.getMonth() >= 4 && date.getMonth() <= 9);
  sunTracker.update(sun, date);
});
```

### Maintain Existing Interface

```typescript
export type SunPositionTracker = {
  update(sun: SunPosition, date: Date): void;
};
```

---

## Performance Considerations

1. **Throttle drag events**: Limit `pointermove` calculations to 60fps maximum
2. **Cache SunCalc results**: Store computed sun positions for the day to avoid redundant calculations
3. **Debounce date changes**: Delay date range updates by 50ms during rapid knob dragging
4. **Use requestAnimationFrame**: Batch visual updates for smooth animations

---

## Accessibility

- Add `role="slider"` to draggable elements
- Include `aria-label` and `aria-valuemin/max/now` attributes
- Support keyboard navigation (arrow keys to adjust position)
- Ensure sufficient color contrast for season tags
- Add screen reader announcements for date changes

---

## Testing Strategy

1. **Unit tests**:
   - `angleToDOY()` and `DOYToDate()` conversions
   - Symmetrical knob movement calculations
   - Season tag logic

2. **Integration tests**:
   - Sun icon drag constraints
   - Knob drag updates date correctly
   - Arc fill calculation

3. **Visual tests**:
   - Snapshot tests for different seasons
   - Responsive layout on mobile/desktop

4. **E2E tests**:
   - Full interaction flow
   - Touch support on mobile devices

---

## Open Questions

1. Should the component support multiple locations (not just Berlin)?
2. Should the time display use 12-hour or 24-hour format?
3. Should the arc show sunrise/sunset markers?
4. Should there be a "today" button to reset to current date?

---

*Document version: 1.0*
*Created: 2026-06-17*
*Based on: Design mockups provided*
