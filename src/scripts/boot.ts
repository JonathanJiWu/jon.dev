/**
 * Page boot: Fly or Read, section tracking, and whether to run the live 3D scene.
 *
 * Small and dependency-free on purpose. three.js is only fetched when the device can
 * draw it with real GPU hardware and the visitor hasn't asked for less data. New
 * sessions start in Fly (the 3D flight, full screen); the visitor's choice is kept for
 * the session; a link to a section, a software renderer or Save-Data starts in Read.
 * Everything here degrades to plain, working links.
 */
import type { CameraMode, SceneController, ViewMode } from '../scene/types';

type SceneState = 'off' | 'starting' | 'running' | 'declined' | 'unsupported' | 'error';
type Reason = 'no-webgl2' | 'software' | 'reduced-motion' | 'save-data';

const html = document.documentElement;
const params = new URLSearchParams(location.search);
const posterMode = params.has('poster');
const VIEW_KEY = 'jw:view';
const WELCOME_KEY = 'jw:welcome';
const BACKGROUND_KEY = 'jw:background';

let canvas = document.querySelector<HTMLCanvasElement>('[data-scene-canvas]');
const labels = document.querySelector<HTMLElement>('[data-scene-labels]');
const panel = document.querySelector<HTMLElement>('[data-eng-panel]');
const hud = document.querySelector<HTMLElement>('[data-hud]');
const note = document.querySelector<HTMLElement>('[data-scene-note]');
const viewSwitch = document.querySelector<HTMLElement>('[data-view-switch]');

let controller: SceneController | null = null;
let state: SceneState = 'off';
let reason: Reason | null = null;
let view: ViewMode = html.dataset.view === 'fly' ? 'fly' : 'read';
let activeId = 'home';
let engineering = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (posterMode) html.classList.add('poster-mode');
html.dataset.camera = 'chase';

/** A heading as three digits, 001–360 (kept local so the page bundle stays tiny). */
function formatHeading(deg: number): string {
  let n = Math.round(deg) % 360;
  if (n <= 0) n += 360;
  return String(n).padStart(3, '0');
}

function session(key: string, value?: string): string | null {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null; // private mode: the choice just won't persist
  }
}

// ---------------------------------------------------------------------------
// Sections ↔ waypoints. Works with or without the scene (it's also a scrollspy).

const fmsLinks = new Map<string, HTMLAnchorElement>();
document.querySelectorAll<HTMLAnchorElement>('[data-leg]').forEach((a) => fmsLinks.set(a.dataset.leg!, a));

let followTimer = 0;
function setActive(id: string): void {
  if (id === activeId) return;
  activeId = id;
  fmsLinks.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
  // Debounced, so a fast scroll past three sections doesn't make the autopilot zig-zag.
  window.clearTimeout(followTimer);
  followTimer = window.setTimeout(() => {
    if (view === 'read') controller?.followSection(id);
  }, 300);
}

const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) setActive((e.target as HTMLElement).dataset.waypoint!);
  },
  // A thin band just above the middle of the viewport decides which section is "current".
  { rootMargin: '-40% 0px -55% 0px' },
);
document.querySelectorAll<HTMLElement>('[data-waypoint]').forEach((el) => sectionObserver.observe(el));

const hero = document.getElementById('top');
if (hero) {
  new IntersectionObserver(([e]) => html.classList.toggle('past-hero', !e!.isIntersecting), {
    rootMargin: '-50% 0px 0px 0px',
  }).observe(hero);
}

// ---------------------------------------------------------------------------
// Can this device run the scene well?

function probe(): Reason | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  } catch {
    gl = null;
  }
  if (!gl) {
    // No hardware context. Is there a software one?
    let soft: WebGL2RenderingContext | null = null;
    try {
      soft = document.createElement('canvas').getContext('webgl2');
    } catch {
      soft = null;
    }
    soft?.getExtension('WEBGL_lose_context')?.loseContext();
    return soft ? 'software' : 'no-webgl2';
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  // A CPU rasterizer would take every core and still stutter: show the still instead.
  if (/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(renderer)) return 'software';
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return 'save-data';
  if (reducedMotion) return 'reduced-motion';
  return null;
}

// ---------------------------------------------------------------------------
// State → UI

const DECLINED: Record<'software' | 'save-data', string> = {
  software: 'The live 3D flight is off because this browser is drawing graphics without a GPU.',
  'save-data': 'The live 3D flight is off to save data.',
};

function button(label: string, attrs: Record<string, string>, onClick?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-quiet';
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function renderNote(): void {
  if (!note) return;
  note.replaceChildren();
  if (state === 'starting') {
    note.append('Starting the flight…');
  } else if (state === 'running') {
    const live = document.createElement('span');
    live.className = 'live';
    live.textContent = '● LIVE';
    note.append(
      live,
      'The aircraft behind this page is flying a flight model, autopilot and flight management system written for this site. Scroll and it holds over each section’s waypoint. ',
      button('Fly it full screen', { 'data-view-set': 'fly' }),
      ' ',
      button('Look under the hood', { 'data-action': 'engineering', 'aria-pressed': String(engineering) }),
      ' ',
      button('Turn off the 3D', {}, () => {
        session(BACKGROUND_KEY, 'off');
        stop();
        setState('off');
      }),
    );
  } else if (state === 'declined' && (reason === 'software' || reason === 'save-data')) {
    note.append(`${DECLINED[reason]} `, button('Fly anyway', { 'data-view-set': 'fly' }));
  } else if (state === 'off') {
    note.append('The live 3D background is off. ', button('Turn it on', {}, () => {
      session(BACKGROUND_KEY, 'on');
      void start();
    }));
  } else if (state === 'error') {
    note.append('The 3D scene couldn’t start here, so this is a still image of it.');
  }
}

function setState(next: SceneState): void {
  state = next;
  html.dataset.scene = next;
  if (viewSwitch) viewSwitch.hidden = next === 'unsupported' || next === 'error' || posterMode;
  if (next !== 'running' && engineering) setEngineering(false);
  renderNote();
}

function renderView(): void {
  html.dataset.view = view;
  viewSwitch?.querySelectorAll<HTMLButtonElement>('[data-view-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewSet === view)));
}

/** Switch between Fly and Read. `target` is a section to read (an element id). */
function setView(next: ViewMode, target?: string): void {
  if (next === 'fly' && (state === 'unsupported' || state === 'error')) next = 'read';
  const changed = next !== view;
  view = next;
  session(VIEW_KEY, view);
  renderView();
  controller?.setView(view);
  if (view === 'fly') {
    if (!controller && state !== 'starting') void start();
  } else if (changed) {
    controller?.setCamera('chase');
    setCamera('chase');
    controller?.followSection(activeId);
  }
  if (view === 'read' && target) {
    requestAnimationFrame(() => {
      const el = target === 'top' ? null : document.getElementById(target);
      if (el) el.scrollIntoView();
      else window.scrollTo({ top: 0 });
      history.replaceState(null, '', target === 'top' ? location.pathname + location.search : `#${target}`);
      if (target === 'main') document.getElementById('main')?.focus({ preventScroll: true });
    });
  }
}

const planDetails = document.querySelector<HTMLDetailsElement>('[data-plan-details]');
// On a phone the flight plan starts folded, so the flight itself has the screen.
if (planDetails && matchMedia('(max-width: 760px)').matches) planDetails.open = false;
let planWasOpen = planDetails?.open ?? true;

function setCamera(mode: CameraMode): void {
  // The flight plan folds away in the cockpit (the instruments show it) and comes back after.
  if (planDetails && mode !== html.dataset.camera) {
    if (mode === 'cockpit') {
      planWasOpen = planDetails.open;
      planDetails.open = false;
    } else if (html.dataset.camera === 'cockpit') {
      planDetails.open = planWasOpen;
    }
  }
  html.dataset.camera = mode;
  hud?.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.camera === mode)));
  hud?.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.focus === '')));
}

function setPaused(p: boolean): void {
  controller?.setPaused(p);
  hud?.querySelectorAll<HTMLButtonElement>('[data-hud-pause]').forEach((b) => {
    b.setAttribute('aria-pressed', String(p));
    b.textContent = p ? 'Play' : 'Pause';
  });
}

// ---------------------------------------------------------------------------
// Scene lifecycle

async function start(): Promise<void> {
  if (!canvas || !labels || controller || state === 'starting') return;
  setState('starting');
  try {
    const { startScene } = await import('../scene/main');
    controller = await startScene({
      canvas,
      labels,
      panel,
      hud,
      view,
      initialSection: activeId,
      reducedMotion,
      poster: posterMode,
      // ?at=600 starts ten minutes into the flight (clamped to an hour).
      startAt: /^\d{1,4}$/.test(params.get('at') ?? '') ? Math.min(Number(params.get('at')), 3600) : undefined,
      onFirstFrame: () => {
        setState('running');
        if (posterMode) (window as Window & { __sceneReady?: boolean }).__sceneReady = true;
      },
      onContextLost: () => {
        stop();
        setState('error');
        setView('read');
      },
      onCameraChange: setCamera,
    });
    setPaused(controller.paused);
  } catch (err) {
    console.error('Scene failed to start:', err);
    controller = null;
    setState('error');
    setView('read');
  }
}

function stop(): void {
  if (!controller) return;
  controller.dispose();
  controller = null;
  // Disposing releases the GPU context, and a canvas can only ever own one context:
  // swap in a fresh element so the scene can start again later.
  if (canvas) {
    const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
}

// ---------------------------------------------------------------------------
// Controls

function setEngineering(on: boolean): void {
  engineering = on;
  html.classList.toggle('engineering', on);
  if (panel) panel.hidden = !on;
  document.querySelectorAll('[data-action="engineering"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  controller?.setEngineering(on);
}

document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLElement>(
    '[data-view-set], [data-action], [data-sim-rate], [data-camera], [data-focus], [data-hud-pause], [data-welcome-close], a[href^="#"]',
  );
  if (!t) return;
  if (t.matches('[data-view-set]')) {
    e.preventDefault();
    const href = t.getAttribute('href');
    setView(t.dataset.viewSet === 'fly' ? 'fly' : 'read', href?.startsWith('#') ? href.slice(1) || 'top' : undefined);
  } else if (t.matches('a[href^="#"]')) {
    // In Fly mode the page is put away: any link into it switches to Read first.
    if (view !== 'fly') return;
    e.preventDefault();
    setView('read', t.getAttribute('href')!.slice(1) || 'top');
  } else if (t.matches('[data-action="engineering"]')) {
    setEngineering(!engineering);
  } else if (t.matches('[data-sim-rate]')) {
    controller?.setSimRate(Number(t.dataset.simRate));
    document.querySelectorAll('[data-sim-rate]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
  } else if (t.matches('[data-camera]')) {
    const mode = t.dataset.camera as CameraMode;
    controller?.setCamera(mode);
    setCamera(mode);
  } else if (t.matches('[data-focus]')) {
    controller?.focusDisplay(t.dataset.focus || null);
    hud?.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
  } else if (t.matches('[data-hud-pause]')) {
    setPaused(!(controller?.paused ?? false));
  } else if (t.matches('[data-welcome-close]')) {
    html.classList.add('welcome-closed');
    session(WELCOME_KEY, 'closed');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && engineering) setEngineering(false);
});

// A section link arriving from elsewhere (back/forward, a typed #hash) reads that section.
window.addEventListener('hashchange', () => {
  if (view === 'fly' && location.hash.length > 1) setView('read', location.hash.slice(1));
});

// ---------------------------------------------------------------------------
// Live readouts in the Read view's flight-plan panel (4 Hz is plenty for text).

const distEls = new Map<string, { el: HTMLElement; x: number; z: number }[]>();
document.querySelectorAll<HTMLElement>('[data-dist]').forEach((el) => {
  const link = el.closest<HTMLElement>('[data-leg]');
  const id = el.dataset.dist!;
  distEls.set(id, [...(distEls.get(id) ?? []), { el, x: Number(link?.dataset.x ?? 0), z: Number(link?.dataset.z ?? 0) }]);
});
const readouts = {
  gs: document.querySelector<HTMLElement>('[data-readout="gs"]'),
  alt: document.querySelector<HTMLElement>('[data-readout="alt"]'),
  hdg: document.querySelector<HTMLElement>('[data-readout="hdg"]'),
  mode: document.querySelector<HTMLElement>('[data-fms-mode]'),
};

window.setInterval(() => {
  if (!controller || state !== 'running' || document.hidden || view !== 'read') return;
  const d = controller.data();
  distEls.forEach((items) => {
    for (const it of items) it.el.textContent = `${(Math.hypot(it.x - d.x, it.z - d.z) / 1852).toFixed(1)} NM`;
  });
  if (readouts.gs) readouts.gs.textContent = `${Math.round(d.groundSpeed)} KT`;
  if (readouts.alt) readouts.alt.textContent = `${(Math.round(d.altitude / 10) * 10).toLocaleString('en-US')} FT`;
  if (readouts.hdg) readouts.hdg.textContent = `${formatHeading(d.heading)}°`;
  if (readouts.mode) readouts.mode.textContent = d.fma.lateral === 'HOLD' ? `HOLD ${d.activeIdent}` : `${d.fma.lateral || d.phase.toUpperCase()} ${d.activeIdent}`;
}, 250);

// ---------------------------------------------------------------------------
// Decide.

reason = probe();
renderView();
const forced = posterMode || params.get('scene') === 'on';

if (reason === 'no-webgl2') {
  setState('unsupported');
  setView('read');
} else if (forced) {
  void start();
} else if (view === 'fly') {
  if (reason === 'software' || reason === 'save-data') {
    setState('declined');
    setView('read');
  } else {
    void start();
  }
} else if (session(BACKGROUND_KEY) === 'off') {
  setState('off');
} else if (reason === 'software' || reason === 'save-data') {
  setState('declined');
} else {
  void start();
}
