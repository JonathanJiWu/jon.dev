/**
 * Page boot: section tracking, and the decision whether to run the live 3D scene.
 *
 * Small and dependency-free on purpose. three.js is only fetched when the device can
 * draw it with real GPU hardware and the visitor hasn't asked for less motion or data.
 * Everything here degrades to plain, working links.
 */
import type { SceneController } from '../scene/types';
import { headingLabel, M_TO_FT, M_TO_NM, MS_TO_KT } from '../sim/units';

type SceneState = 'off' | 'starting' | 'running' | 'declined' | 'unsupported' | 'error';
type Reason = 'no-webgl2' | 'software' | 'reduced-motion' | 'save-data';

const html = document.documentElement;
const params = new URLSearchParams(location.search);
const posterMode = params.has('poster');
const PREF_KEY = 'jw:scene';

let canvas = document.querySelector<HTMLCanvasElement>('[data-scene-canvas]');
const labels = document.querySelector<HTMLElement>('[data-scene-labels]');
const panel = document.querySelector<HTMLElement>('[data-eng-panel]');
const note = document.querySelector<HTMLElement>('[data-scene-note]');
const toggle = document.querySelector<HTMLButtonElement>('[data-scene-toggle]');

let controller: SceneController | null = null;
let state: SceneState = 'off';
let reason: Reason | null = null;
let activeId = '';
let engineering = false;

if (posterMode) html.classList.add('poster-mode');

// ---------------------------------------------------------------------------
// Sections ↔ waypoints. Works with or without the scene (it's also a scrollspy).

const fmsLinks = new Map<string, HTMLAnchorElement>();
document.querySelectorAll<HTMLAnchorElement>('[data-leg]').forEach((a) => fmsLinks.set(a.dataset.leg!, a));

let targetTimer = 0;
function setActive(id: string): void {
  if (id === activeId) return;
  activeId = id;
  fmsLinks.forEach((a, key) => a.setAttribute('aria-current', String(key === id)));
  // Debounced, so a fast scroll past three sections doesn't make the autopilot zig-zag.
  window.clearTimeout(targetTimer);
  targetTimer = window.setTimeout(() => controller?.setTarget(id), 300);
}

const legObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) setActive((e.target as HTMLElement).dataset.waypoint!);
  },
  // A thin band just above the middle of the viewport decides which section is "current".
  { rootMargin: '-40% 0px -55% 0px' },
);
document.querySelectorAll<HTMLElement>('[data-waypoint]').forEach((el) => legObserver.observe(el));

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
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced-motion';
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return 'save-data';
  return null;
}

function readPref(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function writePref(v: 'on' | 'off'): void {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* private mode: the choice just won't persist */
  }
}

// ---------------------------------------------------------------------------
// State → UI

const DECLINED: Record<Exclude<Reason, 'no-webgl2'>, string> = {
  'reduced-motion': 'The live 3D flight is paused because your device asks for reduced motion.',
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
      'The aircraft behind this page is flying a flight model and autopilot written for this site. Scroll and it flies to each section. ',
      button('Look under the hood', { 'data-action': 'engineering', 'aria-pressed': String(engineering) }),
    );
  } else if (state === 'declined' && reason && reason !== 'no-webgl2') {
    note.append(`${DECLINED[reason]} `, button('Start it anyway', {}, () => enable()));
  } else if (state === 'off') {
    note.append('The live 3D background is off. ', button('Turn it on', {}, () => enable()));
  } else if (state === 'error') {
    note.append('The 3D scene couldn’t start here, so this is a still image of it.');
  }
}

function setState(next: SceneState): void {
  state = next;
  html.dataset.scene = next;
  if (toggle) {
    toggle.hidden = next === 'unsupported' || posterMode;
    toggle.setAttribute('aria-pressed', String(next === 'running' || next === 'starting'));
    toggle.title = next === 'running' ? 'Turn off the live 3D background' : 'Turn on the live 3D background';
  }
  if (next !== 'running' && engineering) setEngineering(false);
  renderNote();
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
      initialTarget: activeId || 'home',
      poster: posterMode,
      onFirstFrame: () => {
        setState('running');
        if (posterMode) (window as Window & { __sceneReady?: boolean }).__sceneReady = true;
      },
      onContextLost: () => {
        stop();
        setState('error');
      },
    });
  } catch (err) {
    console.error('Scene failed to start:', err);
    controller = null;
    setState('error');
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

function enable(): void {
  writePref('on');
  void start();
}

function disable(): void {
  writePref('off');
  stop();
  setState('off');
}

// ---------------------------------------------------------------------------
// Engineering view, sim rate, the header toggle

function setEngineering(on: boolean): void {
  engineering = on;
  html.classList.toggle('engineering', on);
  if (panel) panel.hidden = !on;
  document.querySelectorAll('[data-action="engineering"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  controller?.setEngineering(on);
}

document.addEventListener('click', (e) => {
  const t = (e.target as Element).closest<HTMLElement>('[data-action], [data-sim-rate], [data-scene-toggle]');
  if (!t) return;
  if (t.matches('[data-action="engineering"]')) {
    setEngineering(!engineering);
  } else if (t.matches('[data-sim-rate]')) {
    const rate = Number(t.dataset.simRate);
    controller?.setSimRate(rate);
    document.querySelectorAll('[data-sim-rate]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
  } else if (t.matches('[data-scene-toggle]')) {
    if (state === 'running' || state === 'starting') disable();
    else enable();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && engineering) setEngineering(false);
});

// ---------------------------------------------------------------------------
// Live readouts in the page (4 Hz is plenty for text).

const dtgEls = new Map<string, HTMLElement[]>();
document.querySelectorAll<HTMLElement>('[data-dtg], [data-dist]').forEach((el) => {
  const id = el.dataset.dtg ?? el.dataset.dist!;
  dtgEls.set(id, [...(dtgEls.get(id) ?? []), el]);
});
const readouts = {
  gs: document.querySelector<HTMLElement>('[data-readout="gs"]'),
  alt: document.querySelector<HTMLElement>('[data-readout="alt"]'),
  hdg: document.querySelector<HTMLElement>('[data-readout="hdg"]'),
  mode: document.querySelector<HTMLElement>('[data-fms-mode]'),
};
const fixOf = new Map<string, string>();
fmsLinks.forEach((a, id) => fixOf.set(id, a.querySelector('.fix')?.textContent ?? id.toUpperCase()));

window.setInterval(() => {
  if (!controller || state !== 'running' || document.hidden) return;
  const r = controller.readout();
  dtgEls.forEach((els, id) => {
    const d = r.distances[id];
    const text = d === undefined ? '' : `${(d * M_TO_NM).toFixed(1)} NM`;
    els.forEach((el) => (el.textContent = text));
  });
  if (readouts.gs) readouts.gs.textContent = `${Math.round(r.groundSpeed * MS_TO_KT)} KT`;
  if (readouts.alt) readouts.alt.textContent = `${(Math.round((r.altitude * M_TO_FT) / 10) * 10).toLocaleString('en-US')} FT`;
  if (readouts.hdg) readouts.hdg.textContent = `${headingLabel(r.heading)}°`;
  if (readouts.mode) readouts.mode.textContent = `${r.mode === 'orbit' ? 'HOLD' : 'DIR'} ${fixOf.get(r.target) ?? ''}`;
}, 250);

// ---------------------------------------------------------------------------
// Decide.

const pref = readPref();
reason = probe();
const forced = posterMode || params.get('scene') === 'on';

if (reason === 'no-webgl2') setState('unsupported');
else if (forced || pref === 'on') void start();
else if (pref === 'off') setState('off');
else if (reason) setState('declined');
else void start();
