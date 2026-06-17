import SunCalc from 'suncalc';

export type SunPosition = {
  altitude: number;
  azimuth: number;
};

export type SunTimes = {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
};

export function getSunPosition(date: Date, lat: number, lng: number): SunPosition {
  const p = SunCalc.getPosition(date, lat, lng);
  return { altitude: p.altitude, azimuth: p.azimuth };
}

export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
  const t = SunCalc.getTimes(date, lat, lng);
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    solarNoon: t.solarNoon,
  };
}

// SunCalc azimuth: 0 = south, +π/2 = west. We return a unit vector pointing
// FROM the scene origin TO the sun, in a frame where +X=east, +Y=south, +Z=up
// (matches Web Mercator orientation directly, so no Y-flip in the outer transform).
export function sunDirection(sun: SunPosition): { x: number; y: number; z: number } {
  const ch = Math.cos(sun.altitude);
  const sh = Math.sin(sun.altitude);
  const ca = Math.cos(sun.azimuth);
  const sa = Math.sin(sun.azimuth);
  return {
    x: -sa * ch,
    y: ca * ch,
    z: sh,
  };
}
