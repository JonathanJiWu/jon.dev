import { type PerspectiveCamera, Vector3 } from 'three';
import type { FlightPlan } from '../sim/planner';
import { AIRPORTS } from '../world/navdata';
import { ROUTE } from '../world/route';

type Kind = 'section' | 'airport' | 'approach' | 'marker';

interface Label {
  ident: string;
  kind: Kind;
  el: HTMLElement;
  world: Vector3;
  /** Fully visible within this distance, gone 40% beyond it [m]. */
  range: number;
}

const RANGE: Record<Kind, number> = { section: 22_000, airport: 45_000, approach: 12_000, marker: 14_000 };
const SYMBOL: Record<Kind, string> = { section: '◆', airport: '✈', approach: '◇', marker: '' };

/**
 * Names floating in the world, as HTML: crisp text at any resolution and nothing to
 * rasterize. The page's fixes (with their section names), the airports, and, per flight,
 * the approach fixes and the top of climb and descent. Decorative (the container is
 * aria-hidden); the same information is in the page and the flight-plan panel.
 */
export class FixLabels {
  private readonly fixed: Label[] = [];
  private dynamic: Label[] = [];
  private readonly v = new Vector3();
  private activeIdent = '';
  private planKey = '';

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    for (const stop of ROUTE.slice(1)) this.fixed.push(this.make(stop.fix, 'section', stop.label, new Vector3(stop.x, 1450, stop.z)));
    for (const a of AIRPORTS) this.fixed.push(this.make(a.ident, 'airport', a.name, new Vector3(a.x, a.elevation + 260, a.z)));
  }

  private make(ident: string, kind: Kind, sub: string, world: Vector3): Label {
    const el = document.createElement('div');
    el.className = `fix-label ${kind}`;
    if (SYMBOL[kind]) {
      const sym = document.createElement('span');
      sym.className = 'fix-sym';
      sym.textContent = SYMBOL[kind];
      el.append(sym);
    }
    const name = document.createElement('span');
    name.className = 'fix-name';
    name.textContent = ident;
    el.append(name);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'fix-sub';
      s.textContent = sub;
      el.append(s);
    }
    this.root.append(el);
    return { ident, kind, el, world, range: RANGE[kind] };
  }

  /** Approach fixes and the top of climb/descent for the plan being flown. */
  setPlan(plan: FlightPlan): void {
    const key = `${plan.id}:${plan.arrival.runway.ident}`;
    if (key === this.planKey) return;
    this.planKey = key;
    for (const l of this.dynamic) l.el.remove();
    this.dynamic = [];
    const a = plan.approach;
    const fixes = a.entry === 'straight-in' ? [[a.if, 'IAF / IF']] : [[a.iaf, 'IAF'], [a.if, 'IF']];
    fixes.push([a.faf, 'FAF']);
    for (const [fix, role] of fixes as [{ ident: string; x: number; z: number }, string][]) {
      const leg = plan.legs.find((l) => l.ident === fix.ident);
      this.dynamic.push(this.make(fix.ident, 'approach', role, new Vector3(fix.x, (leg?.altitude ?? 900) + 90, fix.z)));
    }
    this.dynamic.push(this.make('T/C', 'marker', '', new Vector3(plan.toc.point.x, plan.cruiseAltitude + 70, plan.toc.point.z)));
    this.dynamic.push(this.make('T/D', 'marker', '', new Vector3(plan.tod.point.x, plan.cruiseAltitude + 70, plan.tod.point.z)));
    this.activeIdent = '';
  }

  setActive(ident: string): void {
    if (ident === this.activeIdent) return;
    this.activeIdent = ident;
    for (const l of [...this.fixed, ...this.dynamic]) l.el.classList.toggle('active', l.ident === ident);
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    for (const l of this.fixed) this.place(l, camera, width, height);
    for (const l of this.dynamic) this.place(l, camera, width, height);
  }

  private place(l: Label, camera: PerspectiveCamera, width: number, height: number): void {
    this.v.copy(l.world).project(camera);
    const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.15 && Math.abs(this.v.y) < 1.15;
    const dist = camera.position.distanceTo(l.world);
    const fade = visible ? Math.max(0, Math.min(1, (l.range * 1.4 - dist) / (l.range * 0.4))) : 0;
    if (fade <= 0) {
      if (l.el.style.opacity !== '0') l.el.style.opacity = '0';
      return;
    }
    const x = (this.v.x * 0.5 + 0.5) * width;
    const y = (-this.v.y * 0.5 + 0.5) * height;
    l.el.style.opacity = fade.toFixed(2);
    l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
