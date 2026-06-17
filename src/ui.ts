import { getSunPosition, getSunTimes, type SunPosition } from './sun';

const LAT = 52.5163;
const LNG = 13.3777;

const dateInput = document.getElementById('date') as HTMLInputElement;
const doyInput = document.getElementById('doy') as HTMLInputElement;
const todInput = document.getElementById('tod') as HTMLInputElement;
const todReadout = document.getElementById('tod-readout') as HTMLOutputElement;
const sunReadout = document.getElementById('sun-readout') as HTMLSpanElement;
const sunTimes = document.getElementById('sun-times') as HTMLElement;
const winterBtn = document.getElementById('winter') as HTMLButtonElement;
const summerBtn = document.getElementById('summer') as HTMLButtonElement;
const nowBtn = document.getElementById('now') as HTMLButtonElement;

export type TimeControls = { setCurrent(date: Date): void };

export function initTimeControls(
  onChange: (sun: SunPosition, date: Date) => void,
): TimeControls {
  let current = new Date();
  current.setSeconds(0, 0);

  const sync = () => {
    dateInput.value = formatLocalDate(current);
    doyInput.value = String(dayOfYear(current));
    const minutes = current.getHours() * 60 + current.getMinutes();
    todInput.value = String(minutes);
    todReadout.value = formatTime(current);
  };

  const updateReadouts = (sun: SunPosition) => {
    const altDeg = (sun.altitude * 180) / Math.PI;
    const aziDeg = (sun.azimuth * 180) / Math.PI;
    const compass = compassFromAzimuth(sun.azimuth);
    sunReadout.textContent = `alt ${altDeg.toFixed(1)}° · ${compass} (${aziDeg.toFixed(0)}°)`;
    const t = getSunTimes(current, LAT, LNG);
    const rise = isFinite(+t.sunrise) ? formatTime(t.sunrise) : '—';
    const noon = isFinite(+t.solarNoon) ? formatTime(t.solarNoon) : '—';
    const set = isFinite(+t.sunset) ? formatTime(t.sunset) : '—';
    sunTimes.textContent = `Sunrise ${rise} · Solar noon ${noon} · Sunset ${set}`;
  };

  const apply = () => {
    sync();
    const sun = getSunPosition(current, LAT, LNG);
    updateReadouts(sun);
    onChange(sun, current);
  };

  dateInput.addEventListener('input', () => {
    if (!dateInput.value) return;
    const [y, m, d] = dateInput.value.split('-').map(Number);
    current = new Date(y, m - 1, d, current.getHours(), current.getMinutes());
    apply();
  });

  doyInput.addEventListener('input', () => {
    const day = Number(doyInput.value);
    const next = fromDayOfYear(current.getFullYear(), day);
    next.setHours(current.getHours(), current.getMinutes(), 0, 0);
    current = next;
    apply();
  });

  todInput.addEventListener('input', () => {
    const minutes = Number(todInput.value);
    current = new Date(current);
    current.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    apply();
  });

  winterBtn.addEventListener('click', () => {
    current = new Date(current.getFullYear(), 11, 21, 12, 0, 0, 0);
    apply();
  });

  summerBtn.addEventListener('click', () => {
    current = new Date(current.getFullYear(), 5, 21, 12, 0, 0, 0);
    apply();
  });

  nowBtn.addEventListener('click', () => {
    current = new Date();
    current.setSeconds(0, 0);
    apply();
  });

  apply();

  return {
    setCurrent(date: Date) {
      current = new Date(date);
      current.setSeconds(0, 0);
      apply();
    },
  };
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = +date - +start;
  return Math.floor(diff / 86_400_000);
}

function fromDayOfYear(year: number, doy: number): Date {
  return new Date(year, 0, doy);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// SunCalc azimuth: 0=S, π/2=W, ±π=N, -π/2=E. Convert to 16-point compass for readability.
function compassFromAzimuth(azi: number): string {
  const deg = (((azi * 180) / Math.PI + 180) % 360 + 360) % 360;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
