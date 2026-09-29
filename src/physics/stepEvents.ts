/**
 * Per-step cache of PhysicsApi.contacts() / sensorEvents(). Several systems
 * (vessel controller, goo, pickups) read the same step's events; each wasm
 * read allocates, so the first reader fetches and the rest share it. Keyed on
 * physics.steps, so a stale report is never returned after the next step().
 */

import type { ContactReport, PhysicsApi, SensorReport } from '../contracts';

interface Entry {
  step: number;
  contacts?: ContactReport;
  sensors?: SensorReport;
}

const cache = new WeakMap<PhysicsApi, Entry>();

function entry(physics: PhysicsApi): Entry {
  let e = cache.get(physics);
  if (!e || e.step !== physics.steps) {
    e = { step: physics.steps };
    cache.set(physics, e);
  }
  return e;
}

export function stepContacts(physics: PhysicsApi): ContactReport {
  const e = entry(physics);
  e.contacts ??= physics.contacts();
  return e.contacts;
}

export function stepSensors(physics: PhysicsApi): SensorReport {
  const e = entry(physics);
  e.sensors ??= physics.sensorEvents();
  return e.sensors;
}
