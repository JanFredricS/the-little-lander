/**
 * Beacon sites. Each site's landing zone spans x ± w/2 and from zoneHeight px
 * above its surface (entity y) to zoneBelow px below it. Soft-landed with the
 * vessel centre inside the zone, held still (landed) for holdSec -> the beacon
 * is planted (once per site): beaconPlanted { planted, total }. Lifting off
 * resets the hold timer.
 */

import type { BeaconSiteEntity, ExitDockEntity, GameEventSink, LevelSpec, Vec2, VesselState } from '../../contracts';
import type { PhysicsTuning } from '../tuning';

export interface BeaconSite {
  entity: BeaconSiteEntity;
  planted: boolean;
  /** Seconds held landed inside the zone. */
  hold: number;
}

export class BeaconSystem {
  readonly sites: BeaconSite[];
  readonly total: number;
  private readonly exits: ExitDockEntity[];
  planted = 0;

  constructor(
    spec: LevelSpec,
    private readonly tuning: PhysicsTuning['beacon'],
    private readonly events: GameEventSink,
  ) {
    this.sites = spec.entities.filter((e): e is BeaconSiteEntity => e.kind === 'beaconSite').map((entity) => ({ entity, planted: false, hold: 0 }));
    this.exits = spec.entities.filter((e): e is ExitDockEntity => e.kind === 'exitDock');
    const required = spec.objectives.reduce((n, o) => (o.kind === 'plantBeacons' ? n + o.count : n), 0);
    this.total = required > 0 ? required : this.sites.length;
  }

  inZone(site: BeaconSiteEntity, p: Vec2): boolean {
    return Math.abs(p.x - site.x) <= site.w / 2 && p.y >= site.y - this.tuning.zoneHeight && p.y <= site.y + this.tuning.zoneBelow;
  }

  /** Beacon site or exit dock whose landing zone contains `p` (softLand.siteId). */
  siteAt(p: Vec2): string | undefined {
    const s = this.sites.find((x) => this.inZone(x.entity, p));
    if (s) return s.entity.id;
    const e = this.exits.find((x) => Math.abs(p.x - x.x) <= x.w / 2 && p.y <= x.y && p.y >= x.y - x.h);
    return e?.id;
  }

  isPlanted(siteId: string): boolean {
    return this.sites.some((s) => s.entity.id === siteId && s.planted);
  }

  /** Round 12 checkpoint respawn: these sites start planted (silently: no events). */
  restorePlanted(siteIds: readonly string[]): void {
    for (const site of this.sites) {
      if (site.planted || !siteIds.includes(site.entity.id)) continue;
      site.planted = true;
      this.planted++;
    }
  }

  /** Ids of the planted sites. */
  plantedIds(): string[] {
    return this.sites.filter((s) => s.planted).map((s) => s.entity.id);
  }

  /** After physics.step(). */
  update(s: VesselState, dt: number): void {
    for (const site of this.sites) {
      if (site.planted) continue;
      if (!s.crashed && s.landed && this.inZone(site.entity, s.pos)) {
        site.hold += dt;
        if (site.hold >= site.entity.holdSec - 1e-9) {
          site.planted = true;
          this.planted++;
          this.events({ type: 'beaconPlanted', siteId: site.entity.id, planted: this.planted, total: this.total });
        }
      } else site.hold = 0;
    }
  }
}
