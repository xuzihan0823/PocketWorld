import { createFishingAudio } from './audio.ts';
import { BAITS, BAIT_SAMPLES, FIGHT_MS, FISH_CAPACITY, FISH_CATALOG, GUEST_ORDERS, ORDER_CAPACITY, RECIPE_CATALOG, ROD_CATALOG, TAP_MAX_PERCENT, TRIP_TARGET_SCORE } from './catalog.ts';
import type { FishId, RecipeId } from './catalog.ts';
import { createFishingGame } from './engine.ts';
import type { FishingAction, FishingScreen, FishingSnapshot as ViewSnapshot } from './FishingView';
import type { ActionResult, FishingEvent, FishingSnapshot, RejectionReason, TripResult } from './model.ts';
import {
  CAST_LAND_MS, CATCH_EFFECT_MS, IMPULSE_MS, LAND_HOLD_MS, type FishingImpulse, type FishingScene,
} from './renderer.ts';
import { openFishingStorage } from './storage.ts';

type Location = 'boat' | 'dock' | 'tackle' | 'market' | 'journal';
type Overlay = 'career' | 'bait' | 'guide';
type View = { snapshot: ViewSnapshot; scene: FishingScene; active: boolean };
export const CROSSING_MS = 1760;
const DOCK_LOAD_GRACE_MS = 480;
const fishNames = Object.fromEntries(FISH_CATALOG.map(fish => [fish.id, fish.name])) as Record<FishId, string>;
const recipes = (Object.keys(RECIPE_CATALOG) as RecipeId[]).map(id => {
  const recipe = RECIPE_CATALOG[id];
  return {
    id, name: recipe.name, station: recipe.station, coins: recipe.price, saleMs: recipe.durationMs,
    fishPerPortion: recipe.fishPerPortion,
    requirement: recipe.fishIds?.map(fishId => fishNames[fishId]).join(' / ') ?? '任意鱼种',
    eligibleFishIds: recipe.fishIds ?? undefined,
  };
});
const rejectionText: Partial<Record<RejectionReason, string>> = {
  'queue-full': '订单已满', 'no-fish': '鱼的数量不足', 'ineligible-fish': '这道菜不能用这种鱼', 'invalid-quantity': '请选择有效份数',
  'not-enough-coins': '金币不足', 'balance-limit': '金币已到上限，无法备货',
  'bait-empty': '这种鱼饵已经用完', 'bait-full': '鱼饵袋已满',
};

function display(state: FishingSnapshot, location: Location | 'crossing', notice?: string, overlay?: Overlay, showCatch = false): ViewSnapshot {
  const { phase, progress, cast } = state;
  const ticket = GUEST_ORDERS[state.guestIndex];
  const screen: FishingScreen = overlay ?? (phase === 'playing' ? location : phase === 'paused' ? 'pause' : phase === 'settled' ? 'result' : 'home');
  return {
    screen, notice, coins: progress.coins, basket: { count: state.fishCount, capacity: FISH_CAPACITY },
    score: state.score, highScore: state.highScore, goal: TRIP_TARGET_SCORE, victory: !!state.result?.victory,
    seconds: 'remainingMs' in cast ? Math.ceil(cast.remainingMs / 1000) : undefined,
    fight: cast.phase === 'fight' ? cast : undefined,
    reeling: cast.phase === 'reeling',
    angling: progress.angling ?? { bait: 'none', stock: BAIT_SAMPLES, counts: {} },
    baitStore: overlay === 'bait' && location === 'tackle',
    catchCard: showCatch && screen === 'boat' ? state.lastCatch : undefined,
    canTap: cast.phase === 'waiting' && state.tapCooldownMs === 0 && cast.tappedMs < Math.floor(cast.originalWaitMs * TAP_MAX_PERCENT / 100),
    guestsServed: state.guestIndex,
    guest: ticket && { ...ticket, served: state.guestPortions },
    fish: FISH_CATALOG.map(fish => ({ id: fish.id, name: fish.name, rarity: fish.rarity,
      count: progress.fishCounts[fish.id], discovered: progress.discoveredFishIds.includes(fish.id), reelMs: fish.reelMs })),
    recipes, queueCapacity: ORDER_CAPACITY, rod: {
      owned: progress.rodLevel, equipped: progress.equippedRodLevel ?? progress.rodLevel,
    },
    orders: progress.orders.map((order, index) => ({ id: `${index}:${order.fishId}:${order.recipeId}`,
      label: `${RECIPE_CATALOG[order.recipeId].name} · ${fishNames[order.fishId]}`, station: RECIPE_CATALOG[order.recipeId].station,
      progress: 1 - order.remainingMs / RECIPE_CATALOG[order.recipeId].durationMs })),
  };
}

export const initialView: View = {
  snapshot: display(createFishingGame({ random: Math.random }).getSnapshot(), 'boat'),
  scene: { timeMs: 0, phase: 'idle' }, active: false,
};

interface Options {
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  show: (view: View) => void;
  draw: (scene: FishingScene) => void;
  onScore: (score: number, highScore: number) => void;
  onFinish: (result: TripResult) => void;
  onExit: () => void;
  onSaveConflict?: () => void;
  random?: () => number;
  audio?: ReturnType<typeof createFishingAudio>;
}

const STEP_MS = 16;
const MAX_FRAME_MS = 3 * STEP_MS;
const HUD_MS = 100;
const CATCH_CARD_MS = 3_200;
const NIBBLE_LEAD_MS = 540;

export function createFishingSession(options: Options) {
  const storage = openFishingStorage(options.getStorage, options.onSaveConflict);
  const engine = createFishingGame({ random: options.random ?? Math.random, progress: storage.progress, highScore: storage.highScore });
  const audio = options.audio ?? createFishingAudio();
  let state = engine.getSnapshot();
  let active = false;
  let muted = false;
  let reducedMotion = false;
  let disposed = false;
  let location: Location = 'boat';
  let overlay: Overlay | undefined;
  let cardUntil: number | undefined;
  let crossing: { destination: 'boat' | 'dock'; elapsedMs: number; loadingMs: number } | undefined;
  let dockImageReady = false;
  let notice: string | undefined;
  let lastScore: number | undefined;
  let lastBest: number | undefined;
  let timeMs = 0;
  let hudTimeMs = 0;
  let castDeadline = 0, castDuration = 1;
  let castAt = 0;
  let floatLanded = false;
  let nibbled = false;
  let nextImpulseId = 0;
  let impulse: { kind: FishingImpulse; atMs: number; id: number } | undefined;
  let lastHudMs = 0;
  let canTap = false;
  let lastSeconds: number | undefined;
  let catchEffect: { fishId: FishId; atMs: number } | undefined;
  let scene: FishingScene = initialView.scene;
  let frameId: number | undefined;
  let previousMs: number | undefined;
  let remainder = 0;

  function currentScene(): FishingScene {
    const cast = state.cast;
    const phase = cast.phase === 'reeling' ? 'bite' : cast.phase;
    const effect = catchEffect && { fishId: catchEffect.fishId, ageMs: timeMs - catchEffect.atMs };
    const progress = Math.max(0, Math.min(1, 1 - (castDeadline - timeMs) / castDuration));
    return {
      phase, reducedMotion, timeMs, progress, castAgeMs: timeMs - castAt,
      impulse: impulse && { kind: impulse.kind, ageMs: timeMs - impulse.atMs, id: impulse.id },
      reelingFish: cast.phase === 'reeling' ? cast.fishId : undefined,
      rodLevel: state.progress.equippedRodLevel ?? state.progress.rodLevel,
      catchEffect: effect && effect.ageMs < CATCH_EFFECT_MS ? effect : undefined,
      crossing: crossing && { destination: crossing.destination, progress: crossing.elapsedMs / CROSSING_MS },
    };
  }

  function publish(refreshScene: boolean) {
    if (disposed) return;
    if (refreshScene) scene = currentScene();
    const snapshot = display(state, crossing ? 'crossing' : location, notice, overlay, cardUntil !== undefined);
    const soundscape = snapshot.screen === 'bait' || snapshot.screen === 'guide' ? location : snapshot.screen;
    if (soundscape !== 'pause') audio.setScene(snapshot.fight && soundscape === 'boat' ? 'fight' : soundscape);
    lastHudMs = hudTimeMs;
    canTap = snapshot.canTap;
    lastSeconds = snapshot.seconds;
    options.show({ snapshot, scene, active });
  }

  function flush() { storage.flush(engine.getProgress, state.highScore); }
  function running() { return !disposed && active && state.phase === 'playing' && !overlay; }

  function syncLoop() {
    const play = running();
    if (!play) {
      if (frameId !== undefined) options.cancelFrame(frameId);
      frameId = previousMs = undefined;
      remainder = 0;
    } else if (frameId === undefined) frameId = options.requestFrame(tick);
    audio.setEnabled(!disposed && active && !muted && state.phase !== 'paused');
  }

  function signal(kind: FishingImpulse) {
    impulse = { kind, atMs: timeMs, id: ++nextImpulseId };
    audio.play(kind);
  }

  function handleEvents(events: readonly FishingEvent[]) {
    for (const event of events) {
      switch (event.type) {
        case 'trip-started':
          notice = undefined;
          lastScore = lastBest = undefined;
          break;
        case 'cast-started':
          castDuration = event.waitMs;
          castDeadline = timeMs + castDuration;
          castAt = catchEffect ? Math.max(timeMs, catchEffect.atMs + LAND_HOLD_MS) : timeMs;
          floatLanded = nibbled = false;
          audio.play('cast');
          if (event.bait) storage.markDirty();
          break;
        case 'rod-tapped': castDeadline -= event.reducedMs; signal('tap'); break;
        case 'bite': case 'reel-started':
          castDuration = event.durationMs;
          castDeadline = timeMs + (state.cast.phase === 'reeling' ? state.cast.remainingMs : castDuration);
          signal(event.type === 'bite' ? 'bite' : 'locked');
          break;
        case 'fight-started': location = 'boat'; notice = undefined; castDuration = FIGHT_MS; castDeadline = timeMs + FIGHT_MS; signal('strike'); break;
        case 'fight-hit': signal('reel'); break;
        case 'fight-miss': signal('slip'); break;
        case 'fish-escaped': notice = '鱼脱钩了，继续等下一尾'; signal('escape'); break;
        case 'fish-caught':
          notice = `${event.firstDiscovery ? '首次发现' : '钓到'}${fishNames[event.fishId]}！`;
          catchEffect = { fishId: event.fishId, atMs: timeMs };
          cardUntil = timeMs + CATCH_CARD_MS;
          const rare = FISH_CATALOG.some(fish => fish.id === event.fishId && fish.rarity === '稀有');
          audio.play(state.lastCatch?.record ? 'record' : rare ? 'rareCatch' : 'catch');
          storage.markDirty();
          break;
        case 'order-queued':
          notice = `${RECIPE_CATALOG[event.recipeId].name} ×${event.quantity ?? 1} 已加入制作`;
          audio.play(RECIPE_CATALOG[event.recipeId].station === 'board' ? 'chop' : 'stove');
          storage.markDirty();
          break;
        case 'order-sold':
          notice = event.guest
            ? `${event.guest.name}已上齐 · 小费 +${event.guest.bonus} 金币`
            : `${RECIPE_CATALOG[event.recipeId].name}已售 · +${event.price} 金币`;
          audio.play(event.guest ? 'guest' : 'sale');
          storage.markDirty();
          break;
        case 'rod-upgraded': case 'rod-equipped':
          engine.stowCast();
          state = engine.getSnapshot();
          catchEffect = undefined;
          notice = `已装备${ROD_CATALOG[event.rodLevel].name}`;
          if (event.type === 'rod-upgraded') audio.play('upgrade');
          else audio.play('ticket');
          storage.markDirty();
          break;
        case 'trip-finished':
          catchEffect = impulse = undefined;
          cardUntil = undefined;
          notice = undefined;
          audio.play('result');
          break;
        case 'bait-selected': case 'bait-bought':
          notice = event.type === 'bait-bought' ? `已补充${BAITS[event.bait].name}` : `下一竿 · ${BAITS[event.bait].name}`;
          audio.play('ticket');
          storage.markDirty();
          break;
      }
    }
  }

  // Progress and the updated record are committed before any host callbacks.
  function notify(events: readonly FishingEvent[]) {
    for (const event of events) {
      if (disposed) return;
      if (event.type === 'trip-started' || event.type === 'order-sold') {
        if (event.score !== lastScore || event.highScore !== lastBest) {
          lastScore = event.score;
          lastBest = event.highScore;
          options.onScore(event.score, event.highScore);
        }
      } else if (event.type === 'trip-finished') options.onFinish(event.result);
    }
  }

  function tick(now: number) {
    frameId = undefined;
    if (!running()) return;
    const elapsed = previousMs === undefined ? 0 : Math.max(0, now - previousMs);
    previousMs = now;
    if (crossing) {
      const step = Math.min(MAX_FRAME_MS, elapsed);
      if (crossing.destination === 'dock' && !dockImageReady && crossing.loadingMs < DOCK_LOAD_GRACE_MS) {
        crossing.loadingMs += step;
      } else {
        crossing.elapsedMs += step;
        if (crossing.elapsedMs >= CROSSING_MS) arrive();
        else options.draw(currentScene());
      }
      syncLoop();
      return;
    }
    const budget = Math.min(MAX_FRAME_MS, elapsed + remainder);
    let steps = Math.floor(budget);
    remainder = budget - steps;
    const events: FishingEvent[] = [];
    const fishing = location === 'boat';
    if (steps && state.progress.orders.length) storage.markDirty();
    while (steps > 0) {
      const step = Math.min(STEP_MS, steps);
      hudTimeMs += step;
      if (fishing) timeMs += step;
      events.push(...engine.advance(step, fishing));
      steps -= step;
    }
    const impulseExpired = !!impulse && timeMs - impulse.atMs >= IMPULSE_MS;
    if (impulseExpired) impulse = undefined;
    const nextCue = fishing && state.cast.phase === 'waiting' && timeMs < castDeadline;
    let showCue = false;
    if (nextCue && !floatLanded && timeMs >= castAt + CAST_LAND_MS) {
      floatLanded = true;
      signal('splash');
      showCue = true;
    }
    if (nextCue && floatLanded && !nibbled && castDeadline - timeMs <= NIBBLE_LEAD_MS) {
      nibbled = true;
      signal('nibble');
      showCue = true;
    }
    const cardExpired = cardUntil !== undefined && timeMs >= cardUntil;
    if (cardExpired) cardUntil = undefined;
    if (events.length) {
      state = engine.getSnapshot();
      handleEvents(events);
      if (events.some(event => event.type === 'fish-caught' || event.type === 'order-sold' || (event.type === 'cast-started' && event.bait))) flush();
      publish(true);
    } else if (cardExpired || showCue || impulseExpired) {
      state = engine.getSnapshot();
      publish(true);
    } else if (hudTimeMs - lastHudMs >= HUD_MS && (location === 'market' || location === 'boat')) {
      state = engine.getSnapshot();
      const cast = state.cast;
      const seconds = 'remainingMs' in cast ? Math.ceil(cast.remainingMs / 1000) : undefined;
      if ((location === 'market' && state.progress.orders.length) || (location === 'boat' && (seconds !== lastSeconds || (!canTap && cast.phase === 'waiting' && state.tapCooldownMs === 0 && cast.tappedMs < cast.originalWaitMs * TAP_MAX_PERCENT / 100)))) {
        publish(false);
      } else lastHudMs = hudTimeMs;
    }
    const effectEnded = catchEffect && timeMs - catchEffect.atMs >= CATCH_EFFECT_MS;
    if (effectEnded) catchEffect = undefined;
    if (!events.length && running() && fishing && (!reducedMotion || effectEnded)) options.draw(currentScene());
    syncLoop();
    notify(events);
  }

  function arrive() {
    if (!crossing) return;
    location = crossing.destination;
    crossing = undefined;
    remainder = 0;
    if (location === 'dock') audio.play('dock');
    publish(true);
  }

  function dispatch(action: FishingAction, gesture = false) {
    if (!active || disposed || crossing) return;
    if (overlay && action.type !== 'close-overlay' && action.type !== 'select-bait' && action.type !== 'buy-bait') return;
    let outcome: ActionResult | undefined;
    switch (action.type) {
      case 'career': case 'bait': case 'guide':
        if (state.phase === 'paused' || state.cast.phase === 'fight' || state.cast.phase === 'reeling') return;
        if (action.type === 'bait' && (state.phase !== 'playing' || (location !== 'boat' && location !== 'tackle'))) return;
        if (action.type === 'guide' && (state.phase !== 'playing' || location !== 'boat')) return;
        overlay = action.type;
        cardUntil = undefined;
        syncLoop();
        if (gesture) audio.unlock();
        audio.play(overlay === 'career' ? 'honors' : 'ticket');
        publish(true);
        return;
      case 'close-overlay':
        if (!overlay) return;
        overlay = undefined;
        syncLoop();
        publish(true);
        return;
      case 'dismiss-catch':
        if (cardUntil === undefined) return;
        cardUntil = undefined;
        publish(false);
        return;
      case 'select-bait': if (overlay === 'bait') outcome = engine.selectBait(action.bait); break;
      case 'buy-bait': if (overlay === 'bait' && location === 'tackle') outcome = engine.buyBait(action.bait); break;
      case 'start': outcome = engine.startTrip(); break;
      case 'pause': outcome = engine.pause(); break;
      case 'resume': outcome = engine.resume(); break;
      case 'finish': outcome = engine.finishTrip(); break;
      case 'home': outcome = engine.returnHome(); break;
      case 'tap': if (location === 'boat') outcome = engine.tapRod(); break;
      case 'fight': if (location === 'boat') outcome = engine.fight(action.key); break;
      case 'prepare': if (location === 'market') outcome = engine.queueOrder(action.fishId, action.recipeId, action.quantity); break;
      case 'upgrade': if (location === 'tackle' && action.level === state.progress.rodLevel + 1) outcome = engine.upgradeRod(); break;
      case 'equip': if (location === 'tackle') outcome = engine.equipRod(action.level); break;
      case 'dock': case 'journal': case 'boat': case 'tackle': case 'market':
        if (!running() || state.cast.phase === 'fight' || state.cast.phase === 'reeling') return;
        if ((action.type === 'tackle' || action.type === 'market') && location !== 'dock') return;
        state = engine.getSnapshot();
        cardUntil = undefined;
        impulse = undefined;
        if (gesture) audio.unlock();
        const destination = action.type;
        if (!reducedMotion && ((location === 'boat' && destination === 'dock') || (location === 'dock' && destination === 'boat'))) {
          crossing = { destination, elapsedMs: 0, loadingMs: 0 };
          audio.play('crossing');
        } else {
          location = destination;
          if (location === 'market' || location === 'tackle') audio.play('door');
          if (location === 'dock') audio.play('dock');
          if (location === 'journal') audio.play('journal');
        }
        publish(true);
        return;
      case 'exit': if (state.phase === 'home') options.onExit(); return;
    }
    if (outcome?.ok) {
      state = engine.getSnapshot();
      if (action.type === 'start' || action.type === 'home') location = 'boat';
      syncLoop();
      if (gesture) audio.unlock();
      handleEvents(outcome.events);
      if (action.type === 'pause' || action.type === 'finish' || action.type === 'prepare' || action.type === 'upgrade' ||
          action.type === 'equip' || action.type === 'select-bait' || action.type === 'buy-bait') flush();
      publish(true);
      notify(outcome.events);
    } else {
      if (gesture) audio.unlock();
      const text = outcome && rejectionText[outcome.reason];
      if (text && notice !== text) {
        notice = text;
        state = engine.getSnapshot();
        publish(false);
      }
    }
  }

  return {
    dispatch,
    interfaceSound(gesture: boolean) {
      if (!active || disposed) return;
      if (gesture) audio.unlock();
      audio.play('ticket');
    },
    get active() { return active; },
    get screen() { return overlay ?? (state.phase === 'playing' ? crossing ? 'crossing' : location : state.phase); },
    get fighting() { return state.cast.phase === 'fight'; },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      engine.setActive(value);
      syncLoop();
      state = engine.getSnapshot();
      if (!value) flush();
      publish(true);
    },
    setMuted(value: boolean) { muted = value; syncLoop(); },
    setDockImageReady() { dockImageReady = true; },
    setReducedMotion(value: boolean) {
      if (reducedMotion === value) return;
      reducedMotion = value;
      if (reducedMotion && crossing) arrive();
      else publish(true);
    },
    checkpoint: flush,
    checkForChanges: storage.checkForChanges,
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      engine.setActive(false);
      syncLoop();
      audio.dispose();
      flush();
    },
  };
}
