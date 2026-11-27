import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldSceneProps } from '../../../types/world';
import { roomAudio } from '../../audioEngine';
import { CLOCK_POSITION } from '../cabinLayout';
import { ObjectHandle } from '../ObjectHandle';
import { ClockAudioPlayer } from './clockAudio';
import { ClockDurationPicker, ClockTimePicker } from './ClockPickers';
import {
  CLOCK_RINGTONES,
  clockHandAngles,
  evaluateClockTick,
  formatClockTime,
  formatCountdown,
  formatTimeUntilAlarm,
  loadClockState,
  normalizeAlarmTime,
  pauseCountdown,
  resetCountdown,
  saveClockState,
  startCountdown,
  type ClockMode,
  type ClockPersistentState,
  type ClockRingingSource,
  type ClockRingtoneId,
} from './clockState';
import './clock.css';

interface ClockRuntimeSnapshot {
  state: ClockPersistentState;
  ringingSource: ClockRingingSource;
  previewing: boolean;
  now: Date;
}

class ClockStore {
  private state: ClockPersistentState = loadClockState();
  private ringingSource: ClockRingingSource = null;
  private previewing = false;
  private now = new Date();
  private snapshot: ClockRuntimeSnapshot = {
    state: this.state,
    ringingSource: this.ringingSource,
    previewing: this.previewing,
    now: this.now,
  };
  private listeners = new Set<() => void>();
  public readonly audio = new ClockAudioPlayer();

  public getSnapshot = (): ClockRuntimeSnapshot => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    this.snapshot = {
      state: this.state,
      ringingSource: this.ringingSource,
      previewing: this.previewing,
      now: this.now,
    };
    this.listeners.forEach(listener => listener());
  }

  private persist(next: ClockPersistentState): void {
    this.state = next;
    saveClockState(next);
  }

  public tick(now = new Date()): void {
    const { nextState, triggered } = evaluateClockTick(this.state, now, this.now);
    this.now = now;
    const stateChanged = nextState !== this.state;
    if (stateChanged) {
      this.persist(nextState);
    }
    if (triggered) {
      this.ringingSource = triggered;
      this.previewing = false;
      this.audio.start(this.state.ringtone);
    }
    this.emit();
  }

  public setMode(mode: ClockMode): void {
    this.audio.unlock();
    this.persist({ ...this.state, mode });
    this.emit();
  }

  public setRingtone(ringtone: ClockRingtoneId): void {
    this.audio.unlock();
    this.persist({ ...this.state, ringtone });
    if (this.ringingSource || this.previewing) {
      this.audio.start(ringtone);
    }
    this.emit();
  }

  public togglePreview(): void {
    this.audio.unlock();
    if (this.ringingSource) {
      this.stopRinging();
      return;
    }
    if (this.previewing) {
      this.previewing = false;
      this.audio.stop();
    } else {
      this.previewing = true;
      this.audio.start(this.state.ringtone);
    }
    this.emit();
  }

  public stopPreview(): void {
    if (!this.previewing) return;
    this.previewing = false;
    if (!this.ringingSource) {
      this.audio.stop();
    }
    this.emit();
  }

  public stopRinging(): void {
    this.ringingSource = null;
    this.previewing = false;
    this.audio.stop();
    this.emit();
  }

  public snooze(minutes = 5): void {
    this.audio.unlock();
    const now = new Date();
    this.ringingSource = null;
    this.previewing = false;
    this.audio.stop();
    const next = startCountdown(this.state, now.getTime(), minutes * 60);
    this.persist(next);
    this.emit();
  }

  public setAlarmTime(time: string): void {
    this.audio.unlock();
    this.now = new Date();
    const alarmTime = normalizeAlarmTime(time, this.state.alarmTime);
    this.persist({
      ...this.state,
      alarmTime,
      lastTriggeredKey: null,
    });
    this.emit();
  }

  public toggleAlarmEnabled(): void {
    this.audio.unlock();
    this.now = new Date();
    const nextEnabled = !this.state.alarmEnabled;
    if (!nextEnabled && this.ringingSource === 'alarm') {
      this.ringingSource = null;
      this.audio.stop();
    }
    this.persist({
      ...this.state,
      alarmEnabled: nextEnabled,
      lastTriggeredKey: null,
    });
    this.emit();
  }

  public setCountdownDuration(seconds: number): void {
    if (this.state.countdownRunning) return;
    this.audio.unlock();
    if (this.ringingSource === 'countdown') {
      this.ringingSource = null;
      this.audio.stop();
    }
    this.persist(resetCountdown(this.state, seconds));
    this.emit();
  }

  public toggleCountdownRunning(): void {
    this.audio.unlock();
    if (this.ringingSource === 'countdown') {
      this.stopRinging();
      return;
    }
    const nowMs = Date.now();
    if (this.state.countdownRunning) {
      this.persist(pauseCountdown(this.state, nowMs));
    } else {
      this.persist(startCountdown(this.state, nowMs));
    }
    this.emit();
  }

  public resetCountdownTimer(): void {
    this.audio.unlock();
    if (this.ringingSource === 'countdown') {
      this.ringingSource = null;
      this.audio.stop();
    }
    this.persist(resetCountdown(this.state));
    this.emit();
  }
}

export const clockStore = new ClockStore();

const TICK_INDICES = Array.from({ length: 12 }, (_, i) => i);

export function AlarmClock3D(world: WorldSceneProps) {
  const snapshot = useSyncExternalStore(clockStore.subscribe, clockStore.getSnapshot);
  const clockGroup = useRef<THREE.Group>(null);
  const hourHand = useRef<THREE.Group>(null);
  const minuteHand = useRef<THREE.Group>(null);
  const secondHand = useRef<THREE.Group>(null);
  const targetHand = useRef<THREE.Group>(null);
  const hammer = useRef<THREE.Group>(null);
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  const focused = world.focusedObject === 'clock';
  const ringing = snapshot.ringingSource !== null || snapshot.previewing;
  const activeIndicator = snapshot.state.alarmEnabled || snapshot.state.countdownRunning;

  useFrame(({ clock }) => {
    const now = new Date();
    const { hourAngle, minuteAngle, secondAngle, targetAngle } = clockHandAngles(now, snapshot.state);
    if (hourHand.current) hourHand.current.rotation.z = hourAngle;
    if (minuteHand.current) minuteHand.current.rotation.z = minuteAngle;
    if (secondHand.current) secondHand.current.rotation.z = secondAngle;
    if (targetHand.current) {
      targetHand.current.visible = targetAngle !== null;
      if (targetAngle !== null) targetHand.current.rotation.z = targetAngle;
    }
    // R3F advances this shared clock once per frame. getElapsedTime() also calls
    // getDelta(), stealing this frame's CPU time from every next-frame consumer.
    const t = clock.elapsedTime;
    if (hammer.current) {
      hammer.current.rotation.z = ringing && !world.reducedMotion ? Math.sin(t * 54) * 0.42 : 0;
    }
    if (clockGroup.current) {
      clockGroup.current.rotation.z = ringing && !world.reducedMotion ? Math.sin(t * 46) * 0.035 : 0;
    }
  });

  const triggerPanoramaClock = (event: ThreeEvent<PointerEvent>) => {
    if (focused || event.button !== 0) return;
    if (world.library && world.library.flow.current.phase !== 'idle') return;
    event.stopPropagation();
    void roomAudio.unlock();
    clockStore.audio.unlock();
    if (snapshot.ringingSource) {
      roomAudio.playSfx('switch');
      clockStore.stopRinging();
      return;
    }
    const action: WorldAction = { sceneId: world.sceneId, objectId: 'clock', kind: 'inspect' };
    const openClock = () => {
      roomAudio.playSfx('switch');
      world.onAction(action);
    };
    if (world.onApproach) {
      world.onApproach(CLOCK_POSITION, action, openClock);
    } else {
      openClock();
    }
  };

  const handleClockAction = (action: WorldAction) => {
    void roomAudio.unlock();
    clockStore.audio.unlock();
    roomAudio.playSfx('switch');
    if (snapshot.ringingSource || snapshot.previewing) {
      clockStore.stopRinging();
      return;
    }
    if (action.objectId === 'clock-button') {
      if (snapshot.state.mode === 'countdown') {
        clockStore.toggleCountdownRunning();
      } else {
        clockStore.toggleAlarmEnabled();
      }
      return;
    }
    world.onAction(action);
  };

  const clockWorld: WorldSceneProps = { ...world, onAction: handleClockAction };

  return (
    <group
      ref={clockGroup}
      position={CLOCK_POSITION}
      name="Furniture_AlarmClock"
      onPointerOver={event => {
        if (!world.focusedObject) {
          event.stopPropagation();
          world.onHover('clock', snapshot.ringingSource ? '点击关闭闹钟响铃' : 'E · 点击或靠近设置闹钟');
        }
      }}
      onPointerOut={() => {
        if (!world.focusedObject) world.onHover(null);
      }}
      onPointerDown={event => {
        if (!world.focusedObject && event.button === 0) {
          event.stopPropagation();
          pointerDown.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={event => {
        if (!world.focusedObject && pointerDown.current) {
          const distance = Math.hypot(event.clientX - pointerDown.current.x, event.clientY - pointerDown.current.y);
          pointerDown.current = null;
          if (distance < 9) triggerPanoramaClock(event);
        }
      }}
    >
      <ObjectHandle
        id="clock"
        action="inspect"
        hint={
          snapshot.ringingSource
            ? '点击闹钟 · 关闭响铃'
            : activeIndicator
              ? '床头闹钟 · 已启用定时'
              : '床头闹钟 · 设置闹钟与倒计时'
        }
        world={clockWorld}
      >
        {/* Invisible interaction volume covering the alarm clock body and bells */}
        <mesh position={[0, 0.01, 0.01]}>
          <boxGeometry args={[0.34, 0.36, 0.14]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Dynamic ivory dial face covering the static baked clock hands */}
        <mesh position={[0, 0, 0.056]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.121, 0.121, 0.01, 48]} />
          <meshStandardMaterial color="#e6c89c" roughness={0.62} metalness={0.05} />
        </mesh>

        {/* Subtle status LED dot at 12 o'clock below the index when alarm or countdown is active */}
        <mesh position={[0, 0.068, 0.0615]}>
          <circleGeometry args={[0.006, 16]} />
          <meshBasicMaterial color={ringing ? '#d94e34' : activeIndicator ? '#4f7a5a' : '#cbb089'} />
        </mesh>

        {/* 12 hour index markers */}
        {TICK_INDICES.map(index => {
          const angle = (index / 12) * Math.PI * 2;
          const major = index % 3 === 0;
          const radius = major ? 0.097 : 0.101;
          return (
            <mesh
              key={index}
              position={[Math.sin(angle) * radius, Math.cos(angle) * radius, 0.062]}
              rotation={[0, 0, -angle]}
            >
              <boxGeometry args={[major ? 0.0075 : 0.005, major ? 0.018 : 0.011, 0.003]} />
              <meshStandardMaterial color="#2a1c15" roughness={0.5} />
            </mesh>
          );
        })}

        {/* Alarm / Countdown target hand (warm brass gold) */}
        <group ref={targetHand} position={[0, 0, 0.063]}>
          <mesh position={[0, 0.034, 0]}>
            <boxGeometry args={[0.0045, 0.068, 0.002]} />
            <meshStandardMaterial color="#c88d32" metalness={0.55} roughness={0.35} />
          </mesh>
        </group>

        {/* Hour hand */}
        <group ref={hourHand} position={[0, 0, 0.0645]}>
          <mesh position={[0, 0.027, 0]} castShadow>
            <boxGeometry args={[0.0095, 0.062, 0.003]} />
            <meshStandardMaterial color="#261913" roughness={0.45} />
          </mesh>
        </group>

        {/* Minute hand */}
        <group ref={minuteHand} position={[0, 0, 0.066]}>
          <mesh position={[0, 0.039, 0]} castShadow>
            <boxGeometry args={[0.0072, 0.088, 0.003]} />
            <meshStandardMaterial color="#261913" roughness={0.45} />
          </mesh>
        </group>

        {/* Second hand */}
        <group ref={secondHand} position={[0, 0, 0.0675]}>
          <mesh position={[0, 0.036, 0]}>
            <boxGeometry args={[0.0032, 0.092, 0.002]} />
            <meshStandardMaterial color="#b84a39" roughness={0.4} />
          </mesh>
        </group>

        {/* Center brass cap pin */}
        <mesh position={[0, 0, 0.0685]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0085, 0.0085, 0.005, 20]} />
          <meshStandardMaterial color="#a86d2c" metalness={0.75} roughness={0.28} />
        </mesh>

        {/* Animated brass hammer between the twin bells */}
        <group ref={hammer} position={[0, 0.132, 0]}>
          <mesh position={[0, 0.018, 0]}>
            <cylinderGeometry args={[0.0035, 0.0035, 0.036, 12]} />
            <meshStandardMaterial color="#a86d2c" metalness={0.75} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.036, 0]}>
            <sphereGeometry args={[0.011, 16, 16]} />
            <meshStandardMaterial color="#c68b42" metalness={0.8} roughness={0.22} />
          </mesh>
        </group>
      </ObjectHandle>

      {/* Top clickable brass plunger button in focused view */}
      <ObjectHandle
        id="clock-button"
        action="toggle"
        hint={
          snapshot.ringingSource
            ? '按下顶部按钮 · 停止响铃'
            : snapshot.state.mode === 'countdown'
              ? snapshot.state.countdownRunning
                ? '按下顶部按钮 · 暂停倒计时'
                : '按下顶部按钮 · 开始倒计时'
              : snapshot.state.alarmEnabled
                ? '按下顶部按钮 · 关闭闹钟'
                : '按下顶部按钮 · 开启闹钟'
        }
        world={clockWorld}
        position={[0, 0.15, 0]}
      >
        <mesh position={[0, activeIndicator ? -0.004 : 0, 0]}>
          <cylinderGeometry args={[0.016, 0.02, 0.024, 20]} />
          <meshStandardMaterial color="#b87b35" metalness={0.72} roughness={0.28} />
        </mesh>
      </ObjectHandle>

      {/* 3D label above the alarm clock when ringing or counting down in the room */}
      {(snapshot.ringingSource || (snapshot.state.countdownRunning && !focused)) && (
        <Html
          center
          position={[0, 0.25, 0]}
          distanceFactor={4}
          style={{
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            padding: '3px 8px',
            background: snapshot.ringingSource ? '#9e4b33e6' : '#303831d9',
            color: '#fff6e3',
            border: '1px solid #d7b46e',
            font: '600 11px "PingFang SC", monospace',
            letterSpacing: '0.5px',
          }}
        >
          {snapshot.ringingSource
            ? '🔔 叮铃铃！点击关闭'
            : `⏳ ${formatCountdown(snapshot.state.countdownRemainingSec)}`}
        </Html>
      )}
    </group>
  );
}

export function AlarmClockSurface({
  focused,
  isMuted,
  onReturn,
  onFocusClock,
}: {
  focused: boolean;
  isMuted: boolean;
  onReturn: () => void;
  onFocusClock: () => void;
}) {
  const snapshot = useSyncExternalStore(clockStore.subscribe, clockStore.getSnapshot);
  const { state, ringingSource, previewing, now } = snapshot;
  const panelRef = useRef<HTMLElement>(null);
  const [, setTickCount] = useState(0);

  useEffect(() => {
    clockStore.audio.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    const tick = () => {
      clockStore.tick(new Date());
      setTickCount(c => (c + 1) % 1000);
    };
    const resume = () => { if (document.visibilityState === 'visible') tick(); };
    const unlockAudio = () => clockStore.audio.unlock();
    tick();
    const timer = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, []);

  useEffect(() => {
    if (!focused) {
      clockStore.stopPreview();
      return;
    }
    panelRef.current?.focus();
  }, [focused]);

  if (!focused && !ringingSource) return null;

  if (!focused && ringingSource) {
    return (
      <aside
        className="clock-floating-toast"
        role="alert"
        aria-label="闹钟响铃提醒"
        onPointerDown={e => e.stopPropagation()}
      >
        <div>
          <strong>{ringingSource === 'alarm' ? `⏰ 闹钟时间到 (${state.alarmTime})` : '⏳ 倒计时结束！'}</strong>
          <p>当前铃声：{state.ringtone === 'special' ? '特供版（唢呐前奏）' : '经典版（普通闹钟）'}</p>
        </div>
        <div className="clock-floating-toast-actions">
          <button
            type="button"
            className="clock-toast-stop"
            onClick={() => {
              roomAudio.playSfx('switch');
              clockStore.stopRinging();
            }}
          >
            关闭响铃
          </button>
          <button
            type="button"
            onClick={() => {
              roomAudio.playSfx('switch');
              clockStore.snooze(5);
            }}
          >
            贪睡 5 分钟
          </button>
          <button
            type="button"
            onClick={() => {
              clockStore.audio.unlock();
              roomAudio.playSfx('switch');
              onFocusClock();
            }}
          >
            查看闹钟
          </button>
        </div>
      </aside>
    );
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="clock-surface"
      aria-label="床头闹钟设置"
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
      <header>
        <div>
          <h2>床头黄铜闹钟</h2>
          <p className="clock-now-time">当前时间 · {formatClockTime(now)}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            clockStore.stopPreview();
            onReturn();
          }}
          aria-label="离开闹钟"
        >
          返回房间
        </button>
      </header>

      {ringingSource && (
        <div className="clock-ringing-alert" role="alert">
          <strong>
            {ringingSource === 'alarm'
              ? `🔔 闹钟时间到（${state.alarmTime}）！`
              : '🔔 倒计时时间到！'}
          </strong>
          <div className="clock-ringing-actions">
            <button
              type="button"
              className="clock-danger"
              onClick={() => {
                roomAudio.playSfx('switch');
                clockStore.stopRinging();
              }}
            >
              关闭响铃
            </button>
            <button
              type="button"
              onClick={() => {
                roomAudio.playSfx('switch');
                clockStore.snooze(5);
              }}
            >
              贪睡 5 分钟
            </button>
          </div>
        </div>
      )}

      <nav className="clock-tabs" aria-label="计时模式">
        <button
          type="button"
          aria-pressed={state.mode === 'alarm'}
          onClick={() => clockStore.setMode('alarm')}
        >
          闹钟设定{state.alarmEnabled ? ' · 已开启' : ''}
        </button>
        <button
          type="button"
          aria-pressed={state.mode === 'countdown'}
          onClick={() => clockStore.setMode('countdown')}
        >
          倒计时{state.countdownRunning ? ` · ${formatCountdown(state.countdownRemainingSec)}` : ''}
        </button>
      </nav>

      {state.mode === 'alarm' ? (
        <>
          <div className="clock-display-card">
            <div className="clock-big-digits" aria-label="设定闹钟时间">
              {state.alarmTime}
            </div>
            <ClockTimePicker
              value={state.alarmTime}
              onChange={time => clockStore.setAlarmTime(time)}
            />
            <p className="clock-substatus" role="status">
              {state.alarmEnabled
                ? `已开启 · 将在 ${state.alarmTime} 响起（${formatTimeUntilAlarm(state.alarmTime, now)}）`
                : '闹钟未开启 · 滚动选择时间后点击下方开启'}
            </p>
          </div>

          <div className="clock-action-row">
            <button
              type="button"
              className={state.alarmEnabled ? 'clock-danger' : 'clock-primary'}
              onClick={() => {
                roomAudio.playSfx('switch');
                clockStore.toggleAlarmEnabled();
              }}
            >
              {state.alarmEnabled ? '关闭闹钟' : '开启闹钟'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="clock-display-card">
            <div className="clock-big-digits" aria-label="倒计时剩余时间">
              {formatCountdown(state.countdownRemainingSec)}
            </div>
            {!state.countdownRunning && (
              <ClockDurationPicker
                seconds={state.countdownRemainingSec}
                onChange={totalSeconds => clockStore.setCountdownDuration(totalSeconds)}
              />
            )}
            <p className="clock-substatus" role="status">
              {state.countdownRunning
                ? '倒计时进行中 · 离开近景后仍会在后台继续计时'
                : `总时长 ${formatCountdown(state.countdownDurationSec)} · 滚动选择时长后点击下方开始计时`}
            </p>
          </div>

          <div className="clock-action-row">
            <button
              type="button"
              className="clock-primary"
              onClick={() => {
                roomAudio.playSfx('switch');
                clockStore.toggleCountdownRunning();
              }}
            >
              {state.countdownRunning
                ? '暂停倒计时'
                : state.countdownRemainingSec < state.countdownDurationSec
                  ? '继续倒计时'
                  : '开始倒计时'}
            </button>
            <button
              type="button"
              onClick={() => {
                roomAudio.playSfx('switch');
                clockStore.resetCountdownTimer();
              }}
              disabled={
                !state.countdownRunning &&
                state.countdownRemainingSec === state.countdownDurationSec
              }
            >
              重置
            </button>
          </div>
        </>
      )}

      <div className="clock-ringtones" role="group" aria-label="铃声选择">
        <div className="clock-ringtone-header">
          <p className="clock-section-label">铃声选择</p>
          <button
            type="button"
            onClick={() => clockStore.togglePreview()}
            aria-pressed={previewing}
          >
            {ringingSource ? '停止响铃' : previewing ? '停止试听' : '试听当前铃声'}
          </button>
        </div>
        <div className="clock-ringtone-list">
          {CLOCK_RINGTONES.map(option => (
            <button
              key={option.id}
              type="button"
              className="clock-ringtone-option"
              aria-pressed={state.ringtone === option.id}
              onClick={() => clockStore.setRingtone(option.id)}
            >
              <strong>{option.label}</strong>
              <small>{option.subtitle}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
