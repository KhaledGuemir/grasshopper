/* Cars belong to towns, not to the wild: every candidate spot is checked
 * against the city radius before it is returned, so no car can be planned out
 * in the open pasture or on a beach. The caller supplies the random source and
 * the collision/water probes, which keeps this module pure and easy to test.
 */

export const CAR_KINDS = ['sedan', 'pickup', 'van'];

export function carCountForCity(city) {
  return city && city.kind === 'v1' ? 3 : 2;
}

export function insideCity(city, x, z, pad) {
  if (!city) return false;
  const r = Number(city.radius) || 62;
  return Math.hypot(x - city.x, z - city.z) <= r + (pad || 0);
}

export function cityContaining(cities, x, z, pad) {
  for (let i = 0; i < cities.length; i++) {
    if (insideCity(cities[i], x, z, pad)) return cities[i];
  }
  return null;
}

/* A parked car sits inside the ring of houses, between the plaza and the
 * outer edge of town, so it looks like it belongs on the street instead of
 * floating out in the meadow. */
export function planCityCars(cities, rnd, opts) {
  opts = opts || {};
  const pad = opts.pad || 0;
  const minR = opts.minR || 22;
  const attempts = opts.attempts || 80;
  const blocked = opts.blocked || (() => false);
  const drivable = opts.drivable || (() => true);
  const spots = [];
  cities.forEach((city, cityIndex) => {
    const count = carCountForCity(city);
    const maxR = Math.max(minR + 4, (Number(city.radius) || 62) - 7);
    for (let i = 0; i < count; i++) {
      let spot = null;
      for (let tries = 0; tries < attempts && !spot; tries++) {
        const a = (i + rnd(-0.25, 0.25)) * (Math.PI * 2) / count + rnd(-0.06, 0.06);
        const r = rnd(minR, maxR);
        const x = city.x + Math.cos(a) * r;
        const z = city.z + Math.sin(a) * r;
        if (!insideCity(city, x, z, pad)) continue;
        if (!drivable(x, z)) continue;
        if (blocked(x, z)) continue;
        spot = { x, z, a };
      }
      if (!spot) continue;
      spots.push({
        id: 'car_' + cityIndex + '_' + i,
        cityIndex,
        index: i,
        kind: CAR_KINDS[(cityIndex + i) % CAR_KINDS.length],
        x: spot.x,
        z: spot.z,
        a: spot.a,
      });
    }
  });
  return spots;
}
