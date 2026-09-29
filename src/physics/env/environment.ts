/**
 * FlightEnvironment: interprets a LevelSpec's gameplay entities and zones
 * around one FlightVessel — gravity (level, ramp, zones), wind gusts, debris
 * rain, goo balls, radiation pulses, brittle anchor regions, orbs / fuel
 * pickups and beacon sites.
 *
 * Per fixed step (see LevelSession.step):
 *   env.beforeStep()          // gravity, wind, goo steering, debris spawns
 *   vessel.applyInput(frame)
 *   physics.step(FIXED_DT)
 *   vessel.state()            // contacts: crash / damage / soft-land
 *   env.afterStep()           // pickups, goo attach + burn, radiation, beacons
 *
 * Not simulated here (reported in `unhandledEntities` / `unhandledZones` for
 * the map slices): moving islands, vines, blast doors, creatures, boss,
 * loose rocks, crumble platforms, kill fronts.
 */

import { FIXED_DT } from '../../contracts';
import type { BodyHandle, BrittleRegion, EntitySpec, GameEventSink, LevelSpec, PhysicsApi, Vec2, ZoneSpec } from '../../contracts';
import type { BuiltLevel } from '../../levels/build';
import { rectContains } from '../geom';
import { PASS_THROUGH_TAGS } from '../tags';
import type { PhysicsTuning } from '../tuning';
import type { FlightVessel, VesselHooks } from '../vessel/types';
import { BeaconSystem } from './beacons';
import { DebrisSystem } from './debris';
import { GooSystem } from './goo';
import { GravityField } from './gravity';
import { PickupSystem } from './pickups';
import { RadiationSystem } from './radiation';
import type { TriggerContext } from './triggers';
import { WindSystem } from './wind';

const HANDLED_ENTITIES: ReadonlySet<EntitySpec['kind']> = new Set(['staticProp', 'exitDock', 'debrisSpawner', 'gooSpawner', 'orb', 'fuelPickup', 'beaconSite']);
const HANDLED_ZONES: ReadonlySet<ZoneSpec['kind']> = new Set(['gravityZone', 'windGustSchedule', 'radiationEmitter', 'brittleRegion']);

export class FlightEnvironment {
  readonly gravity: GravityField;
  readonly wind: WindSystem;
  readonly debris: DebrisSystem;
  readonly goo: GooSystem;
  readonly radiation: RadiationSystem;
  readonly pickups: PickupSystem;
  readonly beacons: BeaconSystem;
  readonly brittle: readonly BrittleRegion[];
  readonly unhandledEntities: readonly EntitySpec[];
  readonly unhandledZones: readonly ZoneSpec[];
  /** Wind acceleration (m/s²) acting on the vessel this step. */
  windAccel: Vec2 = { x: 0, y: 0 };
  private vessel: FlightVessel | null = null;
  private readonly dynamicProps: BodyHandle[];

  constructor(
    private readonly physics: PhysicsApi,
    private readonly spec: LevelSpec,
    private readonly built: BuiltLevel,
    readonly tuning: PhysicsTuning,
    events: GameEventSink,
    private readonly completed: () => ReadonlySet<string> = () => new Set(),
  ) {
    this.gravity = new GravityField(physics, spec, tuning.gravity, events);
    this.wind = new WindSystem(spec.zones, events);
    this.debris = new DebrisSystem(physics, spec.entities, tuning.debris, spec.worldSize);
    this.goo = new GooSystem(physics, spec.entities, tuning.goo, events);
    this.radiation = new RadiationSystem(physics, spec.zones, events);
    this.pickups = new PickupSystem(physics, spec.entities, tuning.pickup, events);
    this.beacons = new BeaconSystem(spec, tuning.beacon, events);
    this.brittle = spec.zones.filter((z): z is BrittleRegion => z.kind === 'brittleRegion');
    this.unhandledEntities = spec.entities.filter((e) => !HANDLED_ENTITIES.has(e.kind));
    this.unhandledZones = spec.zones.filter((z) => !HANDLED_ZONES.has(z.kind));
    this.dynamicProps = [...built.props.values()].filter((p) => p.entity.dynamic).map((p) => p.body);
  }

  /** Install hooks on a (new) vessel. Call detach() for the previous one first. */
  attach(vessel: FlightVessel): void {
    this.vessel = vessel;
    const hooks: VesselHooks = {
      siteAt: (p) => this.beacons.siteAt(p),
      anchorAt: (body, p) => this.anchorAt(body, p),
    };
    vessel.hooks = hooks;
  }

  /** Before replacing / destroying the vessel: drop goo welded to it. */
  detach(): void {
    if (this.vessel) this.goo.dropAttached(this.vessel);
    this.vessel = null;
  }

  /** Can a harpoon anchor here (world px)? Brittle regions return their timer. */
  anchorAt(body: BodyHandle, p: Vec2): { ok: boolean; brittleSec?: number } {
    if (!this.physics.hasBody(body) || PASS_THROUGH_TAGS.has(this.physics.getTag(body) ?? '') || this.built.nonAnchorable.has(body)) return { ok: false };
    const b = this.brittle.find((z) => rectContains(z.rect, p));
    return b ? { ok: true, brittleSec: b.breakAfterSec } : { ok: true };
  }

  triggerContext(vesselPos: Vec2): TriggerContext {
    return { simTime: this.physics.simTime, vesselPos, completed: this.completed() };
  }

  /** Before vessel.applyInput() + physics.step(). */
  beforeStep(): void {
    const v = this.vessel;
    if (!v) return;
    const s = v.state();
    const bodies: BodyHandle[] = [...v.parts, ...this.debris.bodies(), ...this.dynamicProps];
    this.gravity.update(s.pos, bodies);
    if (s.crashed) return;
    this.windAccel = this.wind.update(this.physics.simTime, s.pos);
    if (this.windAccel.x !== 0 || this.windAccel.y !== 0) {
      for (const part of v.parts) {
        if (!this.physics.hasBody(part)) continue;
        const m = this.physics.getMass(part);
        this.physics.applyForce(part, { x: m * this.windAccel.x, y: m * this.windAccel.y });
      }
    }
    this.goo.steer(s.pos);
    this.debris.update(this.triggerContext(s.pos), FIXED_DT);
  }

  /** After physics.step() and vessel.state(). */
  afterStep(): void {
    const v = this.vessel;
    this.debris.cleanup(this.physics.simTime);
    if (!v) return;
    let s = v.state();
    if (s.crashed) return;
    this.pickups.update(v);
    this.goo.update(v, s.pos, FIXED_DT);
    this.radiation.update(this.physics.simTime, v, s.pos);
    s = v.state();
    this.beacons.update(s, FIXED_DT);
  }

  destroy(): void {
    this.detach();
    this.goo.destroy();
    this.debris.destroy();
  }

  get levelSpec(): LevelSpec {
    return this.spec;
  }
}
