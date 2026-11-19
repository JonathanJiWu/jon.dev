import { type FlightData, formatClock, formatDuration, formatHeading } from '../sim/flightData';
import type { FlightPlan, Leg } from '../sim/planner';
import type { FlightSimulation } from '../sim/simulation';
import { DEG } from '../sim/math';
import { toMagnetic } from '../sim/navdata';
import { ROUTE } from '../world/route';
import type { SceneController } from './types';

const FT = 0.3048;
const NM = 1852;
const KT = 0.514_444;

const SECTION_OF = new Map(ROUTE.slice(1).map((s) => [s.fix, s]));
const PHASE: Record<FlightData['phase'], string> = {
  takeoff: 'Takeoff',
  climb: 'Climb',
  cruise: 'Cruise',
  descent: 'Descent',
  approach: 'Approach',
  final: 'Final approach',
  landing: 'Landing',
  parked: 'Parked',
  hold: 'Holding',
};

/** Altitudes as on an FMS: hundreds of feet, no separators (the mono face's comma is wide). */
const ft = (m: number) => `${Math.round(m / FT / 100) * 100}`;

function altitudeText(l: Leg): string {
  if (l.type === 'TO') return '';
  if (!l.constraint) return ft(l.altitude);
  const a = ft(l.constraint.altitude);
  return l.constraint.kind === 'atOrAbove' ? `${a}A` : l.constraint.kind === 'atOrBelow' ? `${a}B` : a;
}

function legTag(l: Leg, plan: FlightPlan): string {
  if (l.type === 'TO') return 'takeoff';
  if (l.type === 'VA') return 'climb on runway heading';
  if (l.type === 'RW') return `runway ${plan.arrival.runway.ident}`;
  const a = plan.approach;
  if (l.ident === a.faf.ident) return 'final approach fix';
  if (l.ident === a.if.ident) return a.entry === 'straight-in' ? 'initial & intermediate fix' : 'intermediate fix';
  if (l.ident === a.iaf.ident) return `initial approach fix · ${a.entry}`;
  return l.type === 'DF' ? 'direct' : '';
}

/**
 * The Fly mode's heads-up panels: the flight plan (live, with direct-to and hold), a
 * strip of flight data, and the pre-flight briefing. Text only, refreshed at 10 Hz from
 * the same FlightData the cockpit displays read.
 */
export class Hud {
  private readonly els: Record<string, HTMLElement | null>;
  private readonly legsEl: HTMLOListElement | null;
  private readonly briefEl: HTMLElement | null;
  private readonly holdBtn: HTMLButtonElement | null;
  private controller: SceneController | null = null;
  private planKey = '';
  private legKey = '';
  private rows: { li: HTMLElement; dist: HTMLElement; eta: HTMLElement }[] = [];
  private readonly onClick = (e: Event) => this.click(e);

  constructor(private readonly root: HTMLElement) {
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    this.els = {
      route: q('[data-hud-route]'),
      flight: q('[data-hud-flight]'),
      sub: q('[data-hud-sub]'),
      thr: q('[data-hud="fma-thr"]'),
      lat: q('[data-hud="fma-lat"]'),
      vert: q('[data-hud="fma-vert"]'),
      ias: q('[data-hud="ias"]'),
      alt: q('[data-hud="alt"]'),
      vs: q('[data-hud="vs"]'),
      hdg: q('[data-hud="hdg"]'),
      gs: q('[data-hud="gs"]'),
      wind: q('[data-hud="wind"]'),
      phase: q('[data-hud="phase"]'),
      eta: q('[data-hud="eta"]'),
    };
    this.legsEl = root.querySelector('[data-hud-legs]');
    this.briefEl = q('[data-hud-brief]');
    this.holdBtn = root.querySelector('[data-hud-hold]');
    root.addEventListener('click', this.onClick);
  }

  bind(controller: SceneController, sim: FlightSimulation): void {
    this.controller = controller;
    this.update(controller.data(), sim);
  }

  private click(e: Event): void {
    const t = (e.target as Element).closest<HTMLElement>('[data-dir], [data-hud-hold], [data-hud-briefing]');
    if (!t || !this.controller) return;
    if (t.matches('[data-dir]')) {
      this.controller.directTo(t.dataset.dir!);
    } else if (t.matches('[data-hud-hold]')) {
      this.controller.toggleHold();
    } else if (t.matches('[data-hud-briefing]') && this.briefEl) {
      const open = this.briefEl.hidden;
      this.briefEl.hidden = !open;
      t.setAttribute('aria-expanded', String(open));
    }
  }

  private set(key: string, text: string): void {
    const el = this.els[key];
    if (el && el.textContent !== text) el.textContent = text;
  }

  update(d: FlightData, sim: FlightSimulation): void {
    const plan = d.plan;
    const fms = sim.fms;
    const key = `${plan.id}`;
    if (key !== this.planKey) {
      this.planKey = key;
      this.legKey = '';
      this.renderPlan(plan);
      this.renderBriefing(plan);
    }
    const legKey = `${fms.legIndex}:${fms.hold?.fix.ident ?? ''}`;
    if (legKey !== this.legKey) {
      this.legKey = legKey;
      this.rows.forEach((r, i) => {
        const active = i === fms.legIndex && !fms.hold;
        r.li.classList.toggle('active', active);
        r.li.classList.toggle('flown', i < fms.legIndex);
        if (active) r.li.setAttribute('aria-current', 'step');
        else r.li.removeAttribute('aria-current');
      });
    }
    // Distance and ETA to each fix ahead
    let dist = d.toActive;
    let eta = d.clock + d.eteActive;
    this.rows.forEach((r, i) => {
      if (i < fms.legIndex) {
        r.dist.textContent = '';
        r.eta.textContent = '';
        return;
      }
      if (i > fms.legIndex) {
        const l = plan.legs[i]!;
        dist += l.length / NM;
        eta += l.time;
      }
      const text = `${dist.toFixed(1)}`;
      if (r.dist.textContent !== text) r.dist.textContent = text;
      const e = formatClock(eta);
      if (r.eta.textContent !== e) r.eta.textContent = e;
    });

    this.set('route', `${plan.origin.ident} → ${plan.destination.ident}`);
    this.set('flight', `FLT ${plan.id + 1}`);
    this.set('thr', d.fma.thrust || '—');
    this.set('lat', fms.hold ? 'HOLD' : d.fma.lateral || '—');
    this.set('vert', d.fma.vertical || '—');
    this.set('ias', `${Math.round(d.ias)}`);
    this.set('alt', `${Math.round(d.altitude / 10) * 10}`);
    this.set('vs', `${d.verticalSpeed >= 0 ? '+' : '−'}${Math.abs(Math.round(d.verticalSpeed / 10) * 10)}`);
    this.set('hdg', `${formatHeading(d.heading)}°`);
    this.set('gs', `${Math.round(d.groundSpeed)}`);
    this.set('wind', `${formatHeading(d.windFrom)}°/${Math.round(d.windSpeed)}`);
    this.set('phase', fms.hold ? `Holding at ${fms.hold.fix.ident}` : fms.pendingHold ? `${PHASE[d.phase]} · hold requested` : PHASE[d.phase]);
    this.set(
      'eta',
      d.phase === 'parked'
        ? `Arrived ${plan.destination.ident} · next flight soon`
        : d.phase === 'landing'
          ? `Landed ${plan.destination.ident}, runway ${plan.arrival.runway.ident}`
          : `${formatClock(d.etaDestination)} · ${formatDuration(d.eteDestination)} to go`,
    );
    if (this.holdBtn) {
      const holding = !!(fms.hold || fms.pendingHold);
      const label = holding ? 'Resume flight plan' : 'Hold at the active fix';
      if (this.holdBtn.textContent !== label) this.holdBtn.textContent = label;
      this.holdBtn.setAttribute('aria-pressed', String(holding));
      this.holdBtn.disabled = d.phase === 'final' || d.phase === 'landing' || d.phase === 'parked';
    }
  }

  private renderPlan(plan: FlightPlan): void {
    this.set('sub', `${plan.approach.name} · cruise ${ft(plan.cruiseAltitude)} ft · ETE ${formatDuration(plan.ete)}`);
    if (!this.legsEl) return;
    this.legsEl.replaceChildren();
    this.rows = [];
    plan.legs.forEach((l) => {
      const li = document.createElement('li');
      const main = document.createElement('div');
      main.className = 'leg-main';
      const ident = document.createElement('span');
      ident.className = 'ident';
      ident.textContent = l.ident;
      const alt = document.createElement('span');
      alt.className = 'alt';
      alt.textContent = altitudeText(l);
      const dist = document.createElement('span');
      dist.className = 'dist';
      const eta = document.createElement('span');
      eta.className = 'eta';
      main.append(ident, alt, dist, eta);
      li.append(main);
      const section = SECTION_OF.get(l.ident);
      const tag = legTag(l, plan);
      if (section || tag) {
        const sub = document.createElement('div');
        sub.className = 'leg-sub';
        if (section) {
          const a = document.createElement('a');
          a.href = `#${section.section}`;
          a.dataset.viewSet = 'read';
          a.textContent = section.label;
          sub.append(a);
          const dir = document.createElement('button');
          dir.type = 'button';
          dir.className = 'dir';
          dir.dataset.dir = l.ident;
          dir.textContent = 'DIR';
          // The accessible name starts with the visible text.
          dir.setAttribute('aria-label', `DIR: fly direct to ${l.ident} (${section.label})`);
          sub.append(dir);
        } else {
          const span = document.createElement('span');
          span.textContent = tag;
          sub.append(span);
        }
        li.append(sub);
      }
      this.legsEl!.append(li);
      this.rows.push({ li, dist, eta });
    });
  }

  private renderBriefing(plan: FlightPlan): void {
    const el = this.briefEl;
    if (!el) return;
    const dep = plan.departure;
    const arr = plan.arrival;
    const comp = (c: { headwind: number; crosswind: number }) =>
      `${c.headwind >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(Math.round(c.headwind / KT))} kt, crosswind ${Math.abs(Math.round(c.crosswind / KT))} kt`;
    const rows: [string, string][] = [
      ['Weather', `${plan.metar.origin}\n${plan.metar.destination}`],
      ['Departure', `Runway ${dep.runway.ident} (${dep.runway.length} m): ${comp(dep)}. Takeoff distance ${Math.round(plan.takeoffDistance)} m.`],
      ['Route', `${plan.legs.filter((l) => l.role === 'enroute').map((l) => l.ident).join(' ')}, cruise ${ft(plan.cruiseAltitude)} ft (minimum en-route ${ft(plan.mea)} ft; ${toMagnetic(Math.atan2(plan.destination.x - plan.origin.x, -(plan.destination.z - plan.origin.z)), plan.variation) / DEG < 180 ? 'eastbound: odd thousands' : 'westbound: even thousands'}).`],
      ['Arrival', `${plan.approach.name}, ${plan.approach.entry}. FAF ${plan.approach.faf.ident} at ${ft(plan.approach.fafAltitude)} ft, 3° glide path. Runway ${arr.runway.ident} (${arr.runway.length} m): ${comp(arr)}.`],
      ['Speeds', `Vr ${Math.round(plan.speeds.vr / KT)}, V2 ${Math.round(plan.speeds.v2 / KT)}, Vref ${Math.round(plan.speeds.vref / KT)}, Vapp ${Math.round(plan.speeds.vapp / KT)} kt.`],
      ['Fuel', `Trip ${Math.round(plan.tripFuel)} kg + 45 min reserve ${Math.round(plan.reserveFuel)} kg; on board ${Math.round(plan.fuelOnBoard).toLocaleString('en-US')} kg.`],
      ['Time', `${formatDuration(plan.ete)} en route; top of climb after ${(plan.toc.distance / NM).toFixed(1)} NM, top of descent at ${(plan.tod.distance / NM).toFixed(1)} NM.`],
    ];
    if (plan.warnings.length) rows.push(['Warnings', plan.warnings.join(' ')]);
    const dl = document.createElement('dl');
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const note = document.createElement('p');
    note.className = 'brief-note';
    note.textContent = 'Simulated airports, weather and procedures, planned with real IFR rules of thumb. Not for navigation.';
    el.replaceChildren(dl, note);
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.legsEl?.replaceChildren();
  }
}
