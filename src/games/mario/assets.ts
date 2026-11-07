import doubaoUrl from './assets/doubao/spritesheet.webp?url';
import slideUrl from './assets/niulai/niulai-slide-sheet.svg?url';
import chargeUrl from './assets/niulai/niulai-charge-sheet.svg?url';
import niulaiConfig from './assets/niulai/animations.json';
import glideUrl from './assets/naiwa/ski-safari-rig/actions/01-ski-glide.svg?url';
import boostUrl from './assets/naiwa/ski-safari-rig/actions/02-ski-boost.svg?url';
import jumpUrl from './assets/naiwa/ski-safari-rig/actions/03-ski-jump-laugh.svg?url';
import flipUrl from './assets/naiwa/ski-safari-rig/actions/04-ski-backflip.svg?url';
import tuckUrl from './assets/naiwa/ski-safari-rig/actions/05-ski-belly-slide.svg?url';
import crashUrl from './assets/naiwa/ski-safari-rig/actions/06-ski-crash.svg?url';
import rideUrl from './assets/naiwa/ski-safari-rig/actions/07-ski-ride-penguin.svg?url';
import idleUrl from './assets/naiwa/ski-safari-rig/actions/08-orig-idle.svg?url';
import type { Partner } from './model';

export type NaiwaAction = 'glide' | 'boost' | 'jump' | 'flip' | 'tuck' | 'crash' | 'ride' | 'idle';
export interface SpriteClip {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  row: number;
  anchor: readonly [number, number];
}
export interface SkiAssets {
  naiwa: Partial<Record<NaiwaAction, SpriteClip>>;
  doubao: SpriteClip | null;
  niulai: Record<Partner, SpriteClip | null>;
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
  const sheet = document.createElement('canvas');
  sheet.width = 280 * frameCount;
  sheet.height = 260;
  const ctx = sheet.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');
  for (let frame = 0; frame < frameCount; frame++) {
    const snapshot = source.cloneNode(true) as Document;
    snapshot.querySelectorAll('animate, animateTransform').forEach(node => {
      sampleAnimation(node, frame * spec.duration / frameCount);
      node.remove();
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(snapshot)], { type: 'image/svg+xml' }));
    try { ctx.drawImage(await decodeImage(url), frame * 280, 0, 280, 260); }
    finally { URL.revokeObjectURL(url); }
  }
  const clip: SpriteClip = { image: sheet, frameWidth: 280, frameHeight: 260, frameCount,
    fps: frameCount / spec.duration, row: 0, anchor: spec.anchor };
  clipCache.set(action, clip);
  return clip;
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

async function loadAll(): Promise<SkiAssets> {
  const assets: SkiAssets = { naiwa: {}, doubao: null, niulai: { slide: null, charge: null }, errors: [], fallback: false };
  async function attempt(name: string, load: () => Promise<void>) {
    try { await load(); }
    catch (error) { assets.errors.push(`${name}：${error instanceof Error ? error.message : String(error)}`); }
  }
  await Promise.all([
    ...Object.keys(actionSpecs).map(key => attempt(`奶娃/${key}`, async () => {
      assets.naiwa[key as NaiwaAction] = await loadNaiwa(key as NaiwaAction);
    })),
    attempt('豆包/向右奔跑', async () => {
      assets.doubao = await loadSheet('doubao', doubaoUrl, { frameWidth: 192, frameHeight: 208,
        frameCount: 8, fps: 12, row: 1, anchor: [100, 202] });
    }),
    ...(['slide', 'charge'] as const).map(action => attempt(`牛来/${action}`, async () => {
      const config = niulaiConfig.actions[action];
      assets.niulai[action] = await loadSheet(`niulai-${action}`, action === 'slide' ? slideUrl : chargeUrl,
        { frameWidth: niulaiConfig.frameWidth, frameHeight: niulaiConfig.frameHeight,
          frameCount: config.frameCount, fps: config.fps, row: 0, anchor: [config.groundAnchor[0], config.groundAnchor[1]] });
    })),
  ]);
  assets.errors.sort();
  assets.fallback = assets.errors.length > 0;
  return assets;
}

export function loadAssets(retry = false): Promise<SkiAssets> {
  if (!pending) pending = loadAll();
  if (retry) {
    const previous = pending;
    pending = previous.then(result => result.fallback ? loadAll() : result);
  }
  return pending;
}
