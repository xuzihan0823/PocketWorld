export type ClockMode = 'alarm' | 'countdown';
export type ClockRingtoneId = 'classic' | 'special';
export type ClockRingingSource = 'alarm' | 'countdown' | null;

export const CLOCK_STORAGE_KEY = 'pocketworld:clock:v1';

export interface ClockRingtoneOption {
  id: ClockRingtoneId;
  label: string;
  subtitle: string;
}

export const CLOCK_RINGTONES: readonly ClockRingtoneOption[] = [
  { id: 'classic', label: '经典版', subtitle: '传统普通闹钟铃声' },
  { id: 'special', label: '特供版', subtitle: '内置音频开头 · 唢呐前奏' },
] as const;

export interface ClockPersistentState {
  version: 1;
  mode: ClockMode;
  ringtone: ClockRingtoneId;
  alarmTime: string;
  alarmEnabled: boolean;
  lastTriggeredKey: string | null;
  countdownDurationSec: number;
  countdownRemainingSec: number;
  countdownRunning: boolean;
  countdownTargetTimestamp: number | null;
}

export const DEFAULT_CLOCK_STATE: Readonly<ClockPersistentState> = {
  version: 1,
  mode: 'alarm',
  ringtone: 'classic',
  alarmTime: '07:30',
  alarmEnabled: false,
  lastTriggeredKey: null,
  countdownDurationSec: 300,
  countdownRemainingSec: 300,
  countdownRunning: false,
  countdownTargetTimestamp: null,
};

export function clampCountdownSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 300;
  return Math.max(1, Math.min(359999, Math.round(seconds)));
}

export function normalizeAlarmTime(input: string, fallback = '07:30'): string {
  if (typeof input !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(input.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseAlarmTime(alarmTime: string): { hours: number; minutes: number } {
  const normalized = normalizeAlarmTime(alarmTime);
  const [h, m] = normalized.split(':').map(Number);
  return { hours: h, minutes: m };
}

export function stepAlarmTime(alarmTime: string, deltaHours: number, deltaMinutes: number): string {
  const { hours, minutes } = parseAlarmTime(alarmTime);
  const totalMinutes = (((hours + deltaHours) * 60 + (minutes + deltaMinutes)) % 1440 + 1440) % 1440;
  const nextHours = Math.floor(totalMinutes / 60);
  const nextMinutes = totalMinutes % 60;
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`;
}

export function alarmTimeAfterMinutes(now: Date, offsetMinutes: number): string {
  const target = new Date(now.getTime() + offsetMinutes * 60_000);
  return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
}

export function dateMinuteKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatClockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function minutesUntilAlarm(alarmTime: string, now: Date): number {
  const { hours, minutes } = parseAlarmTime(alarmTime);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = hours * 60 + minutes;
  let diff = targetMinutes - nowMinutes;
  if (diff < 0 || (diff === 0 && now.getSeconds() > 0)) diff += 1440;
  return diff;
}

export function formatTimeUntilAlarm(alarmTime: string, now: Date): string {
  const diff = minutesUntilAlarm(alarmTime, now);
  if (diff === 1440 || diff === 0) return '即将响铃';
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (hours === 0) return `还有 ${minutes} 分钟`;
  if (minutes === 0) return `还有 ${hours} 小时`;
  return `还有 ${hours} 小时 ${minutes} 分钟`;
}

export function loadClockState(
  storage?: Pick<Storage, 'getItem'> | null,
  nowMs = Date.now()
): ClockPersistentState {
  if (!storage) return { ...DEFAULT_CLOCK_STATE };
  try {
    const raw = storage.getItem(CLOCK_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLOCK_STATE };
    const parsed = JSON.parse(raw) as Partial<ClockPersistentState>;
    const mode: ClockMode = parsed.mode === 'countdown' ? 'countdown' : 'alarm';
    const ringtone: ClockRingtoneId = parsed.ringtone === 'special' ? 'special' : 'classic';
    const alarmTime = normalizeAlarmTime(parsed.alarmTime ?? DEFAULT_CLOCK_STATE.alarmTime);
    const alarmEnabled = Boolean(parsed.alarmEnabled);
    const lastTriggeredKey = typeof parsed.lastTriggeredKey === 'string' ? parsed.lastTriggeredKey : null;
    const countdownDurationSec = clampCountdownSeconds(parsed.countdownDurationSec ?? DEFAULT_CLOCK_STATE.countdownDurationSec);
    let countdownRemainingSec = clampCountdownSeconds(parsed.countdownRemainingSec ?? countdownDurationSec);
    let countdownRunning = Boolean(parsed.countdownRunning);
    let countdownTargetTimestamp = typeof parsed.countdownTargetTimestamp === 'number' && Number.isFinite(parsed.countdownTargetTimestamp)
      ? parsed.countdownTargetTimestamp
      : null;

    if (countdownRunning && countdownTargetTimestamp !== null) {
      const remaining = Math.max(0, Math.ceil((countdownTargetTimestamp - nowMs) / 1000));
      if (remaining > 0) {
        countdownRemainingSec = remaining;
      } else {
        countdownRunning = false;
        countdownTargetTimestamp = null;
        countdownRemainingSec = countdownDurationSec;
      }
    } else {
      countdownRunning = false;
      countdownTargetTimestamp = null;
    }

    return {
      version: 1,
      mode,
      ringtone,
      alarmTime,
      alarmEnabled,
      lastTriggeredKey,
      countdownDurationSec,
      countdownRemainingSec,
      countdownRunning,
      countdownTargetTimestamp,
    };
  } catch {
    return { ...DEFAULT_CLOCK_STATE };
  }
}

export function saveClockState(
  state: ClockPersistentState,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  if (!storage) return;
  try {
    storage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Ignore quota / private browsing storage errors. */
  }
}

export function startCountdown(
  state: ClockPersistentState,
  nowMs: number,
  durationOverrideSec?: number
): ClockPersistentState {
  const duration = durationOverrideSec !== undefined
    ? clampCountdownSeconds(durationOverrideSec)
    : state.countdownDurationSec;
  const remaining = durationOverrideSec !== undefined
    ? duration
    : (state.countdownRemainingSec > 0 ? state.countdownRemainingSec : duration);
  return {
    ...state,
    mode: 'countdown',
    countdownDurationSec: duration,
    countdownRemainingSec: remaining,
    countdownRunning: true,
    countdownTargetTimestamp: nowMs + remaining * 1000,
  };
}

export function pauseCountdown(state: ClockPersistentState, nowMs: number): ClockPersistentState {
  if (!state.countdownRunning || state.countdownTargetTimestamp === null) {
    return { ...state, countdownRunning: false, countdownTargetTimestamp: null };
  }
  const remaining = Math.max(1, Math.ceil((state.countdownTargetTimestamp - nowMs) / 1000));
  return {
    ...state,
    countdownRemainingSec: remaining,
    countdownRunning: false,
    countdownTargetTimestamp: null,
  };
}

export function resetCountdown(state: ClockPersistentState, newDurationSec?: number): ClockPersistentState {
  const duration = newDurationSec !== undefined
    ? clampCountdownSeconds(newDurationSec)
    : state.countdownDurationSec;
  return {
    ...state,
    countdownDurationSec: duration,
    countdownRemainingSec: duration,
    countdownRunning: false,
    countdownTargetTimestamp: null,
  };
}

export function evaluateClockTick(
  state: ClockPersistentState,
  now: Date,
  previousTick?: Date
): { nextState: ClockPersistentState; triggered: ClockRingingSource; remainingSec: number } {
  let nextState = state;
  let triggered: ClockRingingSource = null;
  const nowMs = now.getTime();

  let remainingSec = state.countdownRemainingSec;
  if (state.countdownRunning && state.countdownTargetTimestamp !== null) {
    remainingSec = Math.max(0, Math.ceil((state.countdownTargetTimestamp - nowMs) / 1000));
    if (remainingSec <= 0) {
      triggered = 'countdown';
      remainingSec = state.countdownDurationSec;
      nextState = {
        ...nextState,
        countdownRemainingSec: state.countdownDurationSec,
        countdownRunning: false,
        countdownTargetTimestamp: null,
      };
    } else if (remainingSec !== state.countdownRemainingSec) {
      nextState = {
        ...nextState,
        countdownRemainingSec: remainingSec,
      };
    }
  }

  if (nextState.alarmEnabled) {
    const { hours, minutes } = parseAlarmTime(nextState.alarmTime);
    const target = new Date(nowMs);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() > nowMs) target.setDate(target.getDate() - 1);
    const targetKey = dateMinuteKey(target);
    const currentMinute = dateMinuteKey(now) === targetKey;
    const crossedTarget = previousTick !== undefined && previousTick.getTime() < target.getTime();
    if ((currentMinute || crossedTarget) && nextState.lastTriggeredKey !== targetKey) {
      nextState = {
        ...nextState,
        lastTriggeredKey: targetKey,
      };
      if (!triggered) triggered = 'alarm';
    }
  }

  return { nextState, triggered, remainingSec };
}

/** Compute clock hand angles in radians (0 = 12 o'clock, clockwise rotation is negative Z in Three.js). */
export function clockHandAngles(now: Date, state: ClockPersistentState): {
  hourAngle: number;
  minuteAngle: number;
  secondAngle: number;
  targetAngle: number | null;
} {
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  const secondAngle = -(seconds / 60) * Math.PI * 2;
  const minuteAngle = -(minutes / 60) * Math.PI * 2;
  const hourAngle = -(hours / 12) * Math.PI * 2;

  let targetAngle: number | null = null;
  if (state.mode === 'countdown' && (state.countdownRunning || state.countdownRemainingSec > 0)) {
    const minutesPart = (state.countdownRemainingSec / 60) % 60;
    targetAngle = -(minutesPart / 60) * Math.PI * 2;
  } else if (state.alarmEnabled) {
    const { hours: ah, minutes: am } = parseAlarmTime(state.alarmTime);
    targetAngle = -(((ah % 12) + am / 60) / 12) * Math.PI * 2;
  }

  return { hourAngle, minuteAngle, secondAngle, targetAngle };
}
