import doubaoUrl from '../../../assets/games/ski/doubao/spritesheet.webp?url';
import slideUrl from '../../../assets/games/ski/niulai/niulai-slide-sheet.svg?url';
import chargeUrl from '../../../assets/games/ski/niulai/niulai-charge-sheet.svg?url';
import niulaiConfig from '../../../assets/games/ski/niulai/animations.json';
import glideUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/01-ski-glide.svg?url';
import boostUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/02-ski-boost.svg?url';
import jumpUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/03-ski-jump-laugh.svg?url';
import flipUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/04-ski-backflip.svg?url';
import tuckUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/05-ski-belly-slide.svg?url';
import crashUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/06-ski-crash.svg?url';
import rideUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/07-ski-ride-penguin.svg?url';
import idleUrl from '../../../assets/games/ski/naiwa/ski-safari-rig/actions/08-orig-idle.svg?url';
import rigUrl from '../../../assets/games/ski/naiwa/ski-volume-rig.svg?url';
import skySvg from '../../../assets/games/ski/winter/sky.svg?raw';
import mountainsSvg from '../../../assets/games/ski/winter/mountains.svg?raw';
import woodlandSvg from '../../../assets/games/ski/winter/woodland.svg?raw';
import decorSvg from '../../../assets/games/ski/winter/decor.svg?raw';
import type { Partner, TrailId } from './model';

export type NaiwaAction = 'glide' | 'boost' | 'jump' | 'flip' | 'tuck' | 'crash' | 'ride' | 'idle';
export interface SpriteClip {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  row: number;
  anchor: readonly [number, number];
  rideAnchors?: readonly (readonly [number, number])[];
}
export interface SkiAssets {
  naiwa: Partial<Record<NaiwaAction, SpriteClip>>;
  rig?: Partial<Record<'body' | 'legs' | 'skis', SpriteClip>>;
  doubao: SpriteClip | null;
  niulai: Record<Partner, SpriteClip | null>;
  scenery?: Partial<Record<TrailId, Record<'sky' | 'mountains' | 'woodland' | 'decor', CanvasImageSource>>>;
  errors: string[];
  fallback: boolean;
}

const actionSpecs: Record<NaiwaAction, { url: string; duration: number; anchor: [number, number] }> = {
  glide: { url: glideUrl, duration: .9, anchor: [150, 214] },
  boost: { url: boostUrl, duration: .56, anchor: [148, 218] },
  jump: { url: jumpUrl, duration: .8, anchor: [150, 207] },
  flip: { url: flipUrl, duration: .56, anchor: [150, 202] },
  tuck: { url: tuckUrl, duration: .7, anchor: [185, 220] },
  crash: { url: crashUrl, duration: .9, anchor: [150, 220] },
  ride: { url: rideUrl, duration: .6, anchor: [150, 188] },
  idle: { url: idleUrl, duration: 3.2, anchor: [150, 217] },
};
const clipCache = new Map<string, SpriteClip>();
let pending: Promise<SkiAssets> | null = null;

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error('图片解码超时')), 12000);
    function finish(error?: Error) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) { image.src = ''; reject(error); }
      else resolve(image);
    }
    image.onload = () => image.naturalWidth ? finish() : finish(new Error('图片尺寸为空'));
    image.onerror = () => finish(new Error('图片加载失败'));
    image.src = url;
  });
}

function sampleAnimation(node: Element, time: number) {
  const parent = node.parentElement;
  if (!parent) return;
  const duration = Number.parseFloat(node.getAttribute('dur') || '1');
  const progress = (time % duration) / duration;
  const values = (node.getAttribute('values') || `${node.getAttribute('from')};${node.getAttribute('to')}`)
    .split(';').map(value => value.trim().split(/[ ,]+/).map(Number));
  if (values.length < 2 || values.some(value => value.some(n => !Number.isFinite(n)))) return;
  const keys = node.getAttribute('keyTimes')?.split(';').map(Number)
    || values.map((_, index) => index / (values.length - 1));
  let index = 0;
  while (index < keys.length - 2 && progress >= keys[index + 1]) index++;
  const fraction = (progress - keys[index]) / (keys[index + 1] - keys[index]);
  const value = values[index].map((number, i) => number + (values[index + 1][i] - number) * fraction);
  const attribute = node.getAttribute('attributeName') || '';
  if (node.localName === 'animateTransform') {
    const transform = `${node.getAttribute('type')}(${value.join(' ')})`;
    parent.setAttribute(attribute, node.getAttribute('additive') === 'sum'
      ? `${parent.getAttribute(attribute) || ''} ${transform}` : transform);
  } else parent.setAttribute(attribute, value.join(' '));
}

function prepareAction(source: string, action: NaiwaAction): Document {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('SVG 格式错误');
  document.querySelectorAll('[id^="fx-"], #penguin-mount').forEach(node => node.remove());
  // Body rotation belongs exclusively to the physics clock, never to SMIL.
  if (action === 'flip') document.querySelectorAll('animateTransform[from]').forEach(node => {
    if (node.getAttribute('from')?.startsWith('360')) {
      node.parentElement?.removeAttribute('transform');
      node.remove();
    }
  });
  if (action === 'ride') {
    document.querySelectorAll('[id^="ski-board"]').forEach(node => node.remove());
    document.querySelector('#leg-back')?.setAttribute('transform', 'translate(104 138) rotate(-38) scale(1 .72)');
    document.querySelector('#leg-front')?.setAttribute('transform', 'translate(74 140) rotate(-32) scale(1 .72)');
    document.querySelector('#action-ski-ride-penguin > animateTransform')?.remove();
  }
  return document;
}

async function loadNaiwa(action: NaiwaAction): Promise<SpriteClip> {
  const cached = clipCache.get(action);
  if (cached) return cached;
  const spec = actionSpecs[action];
  const response = await fetch(spec.url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = prepareAction(await response.text(), action);
  const frameCount = action === 'idle' ? 16 : 8;
  const clip = await sampleSvg(source, frameCount, spec.duration, spec.anchor);
  clipCache.set(action, clip);
  return clip;
}

async function sampleSvg(source: Document, frameCount: number, duration: number, anchor: readonly [number, number]): Promise<SpriteClip> {
  const sheet = document.createElement('canvas');
  sheet.width = 280 * frameCount;
  sheet.height = 260;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  for (let frame = 0; frame < frameCount; frame++) {
    const snapshot = source.cloneNode(true) as Document;
    snapshot.querySelectorAll('animate, animateTransform').forEach(node => {
      sampleAnimation(node, frame * duration / frameCount);
      node.remove();
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(snapshot)], { type: 'image/svg+xml' }));
    try { ctx.drawImage(await decodeImage(url), frame * 280, 0, 280, 260); }
    finally { URL.revokeObjectURL(url); }
  }
  return { image: sheet, frameWidth: 280, frameHeight: 260, frameCount,
    fps: frameCount / duration, row: 0, anchor };
}

async function loadSheet(key: string, url: string, spec: Omit<SpriteClip, 'image'>): Promise<SpriteClip> {
  const cached = clipCache.get(key);
  if (cached) return cached;
  const image = await decodeImage(url);
  if (image.naturalWidth < spec.frameWidth * spec.frameCount || image.naturalHeight < spec.frameHeight * (spec.row + 1)) {
    throw new Error('序列帧尺寸不正确');
  }
  const clip = { image, ...spec };
  clipCache.set(key, clip);
  return clip;
}

async function loadRig(): Promise<NonNullable<SkiAssets['rig']>> {
  const response = await fetch(rigUrl, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const source = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  if (source.querySelector('parsererror')) throw new Error('SVG 格式错误');
  const rig: NonNullable<SkiAssets['rig']> = {};
  for (const layer of ['body', 'legs', 'skis'] as const) {
    const key = `rig-${layer}`;
    const cached = clipCache.get(key);
    if (cached) { rig[layer] = cached; continue; }
    const frameCount = 1;
    const snapshot = source.cloneNode(true) as Document;
    snapshot.querySelectorAll('[data-layer]').forEach(node => {
      if (node.getAttribute('data-layer') !== layer) node.remove();
    });
    const clip = await sampleSvg(snapshot, frameCount, 3.2, [150, 220]);
    clipCache.set(key, clip);
    rig[layer] = clip;
  }
  return rig;
}

async function loadAll(): Promise<SkiAssets> {
  const assets: SkiAssets = { naiwa: {}, doubao: null, niulai: { slide: null, charge: null }, errors: [], fallback: false };
  async function attempt(name: string, load: () => Promise<void>) {
    try { await load(); }
    catch (error) { assets.errors.push(`${name}：${error instanceof Error ? error.message : String(error)}`); }
  }
  const loadAction = (action: NaiwaAction) => attempt(`奶娃/${action}`, async () => {
    assets.naiwa[action] = await loadNaiwa(action);
  });
  await Promise.all([
    attempt('奶娃/分层骨骼', async () => { assets.rig = await loadRig(); }),
    attempt('冬日分层背景', async () => { assets.scenery = await loadScenery(); }),
    attempt('豆包/向右奔跑', async () => {
      assets.doubao = await loadSheet('doubao', doubaoUrl, { frameWidth: 192, frameHeight: 208,
        frameCount: 8, fps: 12, row: 1, anchor: [100, 202] });
    }),
    ...(['slide', 'charge'] as const).map(action => attempt(`牛来/${action}`, async () => {
      const config = niulaiConfig.actions[action];
      assets.niulai[action] = await loadSheet(`niulai-${action}`, action === 'slide' ? slideUrl : chargeUrl,
        { frameWidth: niulaiConfig.frameWidth, frameHeight: niulaiConfig.frameHeight,
          frameCount: config.frameCount, fps: config.fps, row: 0, anchor: [config.groundAnchor[0], config.groundAnchor[1]] });
      assets.niulai[action]!.rideAnchors = config.rideAnchors.map(point => [point[0], point[1]] as const);
    })),
  ]);
  if (!assets.rig) await Promise.all((Object.keys(actionSpecs) as NaiwaAction[]).map(loadAction));
  assets.errors.sort();
  assets.fallback = assets.errors.length > 0;
  return assets;
}

async function loadScenery(): Promise<NonNullable<SkiAssets['scenery']>> {
  const result: NonNullable<SkiAssets['scenery']> = {};
  const colors: Partial<Record<TrailId, Record<string, string>>> = {
    forest: { '#d5edf6': '#e2eaf1', '#edf8fa': '#fff1dc', '#c7e0e9': '#d0d8e3', '#a2c5d5': '#b1becf', '#b8d6e1': '#c5ced8', '#789fae': '#879fab' },
    night: { '#d5edf6': '#293f5e', '#edf8fa': '#7698b1', '#c7e0e9': '#7192ac', '#e9f3f3': '#d2e4ed', '#a2c5d5': '#577d99', '#b8d6e1': '#7599b2', '#f5f8ee': '#dceaf0', '#d7e9ec': '#a1bdcd', '#789fae': '#5b8297', '#edf5ef': '#c5dce6', '#fff9ec': '#e9f3fa', '#e6f1ef': '#cee2e9', '#fffdf1': '#d2e2ec' },
  };
  await Promise.all((['valley', 'forest', 'night'] as const).map(async trail => {
    const layers = {} as NonNullable<SkiAssets['scenery']>[TrailId] & {};
    await Promise.all(Object.entries({ sky: skySvg, mountains: mountainsSvg, woodland: woodlandSvg, decor: decorSvg }).map(async ([name, svg]) => {
      const source = svg.replace(/#[a-f\d]{6}/gi, color => colors[trail]?.[color.toLowerCase()] || color);
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
      try {
        const image = await decodeImage(url);
        // Keep twelve reusable 800×450 surfaces, rather than full-size textures.
        const surface = document.createElement('canvas');
        surface.width = 800; surface.height = 450;
        const context = surface.getContext('2d');
        if (!context) throw new Error('Canvas 2D 不可用');
        context.drawImage(image, 0, 0, 800, 450);
        layers[name as keyof typeof layers] = surface;
      } finally { URL.revokeObjectURL(url); }
    }));
    result[trail] = layers;
  }));
  return result;
}

export function loadAssets(retry = false): Promise<SkiAssets> {
  if (!pending) pending = loadAll();
  if (retry) {
    const previous = pending;
    pending = previous.then(result => result.fallback ? loadAll() : result);
  }
  return pending;
}
