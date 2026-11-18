import { type PerspectiveCamera, Vector3 } from 'three';
import type { RouteStop } from '../world/route';

/**
 * Fix names floating above each waypoint, as HTML: crisp text at any resolution and
 * nothing to rasterize. Decorative (the container is aria-hidden); the same
 * information is in the page.
 */
export class FixLabels {
  private readonly items: { stop: RouteStop; el: HTMLElement; world: Vector3 }[];
  private readonly v = new Vector3();
  private activeId = '';

  constructor(
    private readonly root: HTMLElement,
    route: readonly RouteStop[],
  ) {
    root.replaceChildren();
    this.items = route.map((stop) => {
      const el = document.createElement('div');
      el.className = 'fix-label';
      const sym = document.createElement('span');
      sym.className = 'fix-sym';
      sym.textContent = '◆';
      const name = document.createElement('span');
      name.className = 'fix-name';
      name.textContent = stop.fix;
      const sub = document.createElement('span');
      sub.className = 'fix-sub';
      sub.textContent = stop.label;
      el.append(sym, name, sub);
      root.append(el);
      return { stop, el, world: new Vector3(stop.x, stop.altitude + 160, stop.z) };
    });
  }

  setActive(id: string): void {
    if (id === this.activeId) return;
    this.activeId = id;
    for (const it of this.items) it.el.classList.toggle('active', it.stop.id === id);
  }

  update(camera: PerspectiveCamera, width: number, height: number): void {
    for (const it of this.items) {
      this.v.copy(it.world).project(camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.15 && Math.abs(this.v.y) < 1.15;
      if (!visible) {
        it.el.style.opacity = '0';
        continue;
      }
      const dist = camera.position.distanceTo(it.world);
      const fade = Math.max(0, Math.min(1, (16_000 - dist) / 6000));
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      it.el.style.opacity = String(fade);
      it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }

  dispose(): void {
    this.root.replaceChildren();
  }
}
