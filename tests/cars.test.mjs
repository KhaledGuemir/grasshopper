import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../lib/world/rng.js';
import { carCountForCity, carHitsCircle, carMobPush, cityContaining, insideCity, planCityCars } from '../lib/world/cars.js';

const cities = [
  { x: 0, z: 0, radius: 62, kind: 'v1' },
  { x: 420, z: -40, radius: 36, kind: 'v5' },
];

test('cars are only planned inside a city radius', () => {
  const rand = mulberry32(1234);
  const rnd = (a, b) => a + rand() * (b - a);
  const plan = planCityCars(cities, rnd, { drivable: () => true, blocked: () => false });

  assert.equal(plan.length, carCountForCity(cities[0]) + carCountForCity(cities[1]));
  for (const car of plan) {
    const city = cities[car.cityIndex];
    assert.ok(insideCity(city, car.x, car.z), `${car.id} was planned outside ${city.kind}`);
  }
  assert.equal(plan.filter((car) => car.cityIndex === 0).length, 3);
  assert.equal(plan.filter((car) => car.cityIndex === 1).length, 2);
});

test('blocked or waterlogged spots are skipped, never moved into the wild', () => {
  const rand = mulberry32(99);
  const rnd = (a, b) => a + rand() * (b - a);
  const plan = planCityCars(cities, rnd, {
    drivable: (x) => x < cities[0].x, // only the western half of the first town is dry
    blocked: () => false,
  });
  for (const car of plan) {
    assert.ok(insideCity(cities[car.cityIndex], car.x, car.z));
  }
});

test('a city where every spot is blocked yields no cars', () => {
  const rand = mulberry32(7);
  const rnd = (a, b) => a + rand() * (b - a);
  const plan = planCityCars(cities, rnd, { drivable: () => true, blocked: () => true });
  assert.deepEqual(plan, []);
});

test('cityContaining finds a town and rejects the open pasture', () => {
  assert.equal(cityContaining(cities, 1, 1, 0), cities[0]);
  assert.equal(cityContaining(cities, 400, 0, 0), null);
  assert.equal(cityContaining(cities, 390, -40, 40), cities[1]);
});

test('a car hits mobs in front, behind and beside it', () => {
  assert.ok(carHitsCircle(0, 0, 0, 0, 2, 0.5), 'mob in front should collide');
  assert.ok(carHitsCircle(0, 0, 0, 0, -2, 0.5), 'mob behind should collide');
  assert.ok(carHitsCircle(0, 0, 0, 1.2, 0, 0.5), 'mob beside the door should collide');
  assert.ok(carHitsCircle(0, 0, Math.PI / 2, 2, 0, 0.5), 'heading should rotate the box');
  assert.equal(carHitsCircle(0, 0, 0, 0, 5, 0.5), null, 'distant mob should not collide');
  assert.equal(carHitsCircle(0, 0, 0, 3, 0, 0.5), null, 'grazing mob should not collide');
});

test('collision pushes a mob out along the nearest car face', () => {
  const front = carHitsCircle(0, 0, 0, 0, 2, 0.5);
  const pushFront = carMobPush(front, 0);
  assert.ok(pushFront.z > 0 && Math.abs(pushFront.x) < 1e-9, 'front hit should push forward');
  const side = carHitsCircle(0, 0, 0, 1.2, 0, 0.5);
  const pushSide = carMobPush(side, 0);
  assert.ok(pushSide.x > 0 && Math.abs(pushSide.z) < 1e-9, 'side hit should push sideways');
  const turned = carHitsCircle(0, 0, Math.PI / 2, 2, 0, 0.5);
  const pushTurned = carMobPush(turned, Math.PI / 2);
  assert.ok(pushTurned.x > 0 && Math.abs(pushTurned.z) < 1e-9, 'rotated front hit should push along +x');
});
