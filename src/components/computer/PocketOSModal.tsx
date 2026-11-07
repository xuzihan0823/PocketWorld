import React, { useEffect, useState } from 'react';
import { GameCartridgeProps, GameId } from '../../types/game';

interface PocketOSModalProps {
  initialGame?: GameId | null;
  isMuted: boolean;
  onToggleMute: () => void;
  onActiveGameChange?: (gameId: GameId | null) => void;
  onClose: () => void;
}

type GameModuleLoader = () => Promise<{
  default: React.ComponentType<GameCartridgeProps>;
}>;

const gameModules = import.meta.glob<{
  default: React.ComponentType<GameCartridgeProps>;
}>('../../games/*/index.tsx');

function getHighScore(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export const PocketOSModal: React.FC<PocketOSModalProps> = ({
  initialGame = null,
  isMuted,
  onToggleMute,
  onActiveGameChange,
  onClose,
}) => {
  const [activeGame, setActiveGame] = useState<GameId | null>(initialGame);
  const [bootingGame, setBootingGame] = useState<GameId | null>(null);
  const [LoadedCartridge, setLoadedCartridge] =
    useState<React.ComponentType<GameCartridgeProps> | null>(null);
  const [marioHigh, setMarioHigh] = useState(() =>
    getHighScore('pocketworld:mario:highscore')
  );
  const [shooterHigh, setShooterHigh] = useState(() =>
    getHighScore('pocketworld:shooter:highscore')
  );
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockText(
        new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const launchCartridge = (gameId: GameId) => {
    setBootingGame(gameId);
    onActiveGameChange?.(gameId);

    const modulePath = `../../games/${gameId}/index.tsx`;
    const loader: GameModuleLoader | undefined = gameModules[modulePath];

    window.setTimeout(async () => {
      if (loader) {
        try {
          const mod = await loader();
          setLoadedCartridge(() => mod.default);
        } catch {
          setLoadedCartridge(null);
        }
      } else {
        setLoadedCartridge(null);
      }
      setBootingGame(null);
      setActiveGame(gameId);
    }, 460);
  };

  useEffect(() => {
    if (initialGame) {
      launchCartridge(initialGame);
    }
  }, [initialGame]);

  const handleExitGame = () => {
    setActiveGame(null);
    setLoadedCartridge(null);
    onActiveGameChange?.(null);
  };

  return (
    <div className="overlay-backdrop" role="dialog" aria-modal="true" aria-label="PocketOS 复古工作站">
      <div className="monitor-bezel-frame">
        <div className="monitor-top-bar">
          <span className="monitor-brand">POCKET-VISION CRT · 800×600</span>
          <div className="monitor-top-actions">
            <button
              type="button"
              className="monitor-action-btn"
              onClick={onToggleMute}
            >
              {isMuted ? '静音：已开启' : '音量：正常'}
            </button>
            <button
              type="button"
              className="monitor-action-btn is-exit"
              onClick={onClose}
            >
              离开电脑
            </button>
          </div>
        </div>

        {/* 固定 4:3 比例逻辑屏幕容器 */}
        <div className="pocketos-screen-viewport">
          {bootingGame && (
            <div className="crt-boot-animation">
              <div className="crt-scanline-bar" />
              <strong>正在载入虚拟卡带：{bootingGame === 'mario' ? '雪线逃脱' : 'SPACE SHOOTER'}...</strong>
              <span>800 × 600 CANVAS CARTRIDGE BUS</span>
            </div>
          )}

          {!bootingGame && activeGame && LoadedCartridge && (
            <div className="cartridge-mount-stage">
              <LoadedCartridge
                width={800}
                height={600}
                isMuted={isMuted}
                isActive={true}
                onScoreChange={(_score, high) => {
                  if (activeGame === 'mario') setMarioHigh(high);
                  else setShooterHigh(high);
                }}
                onGameOver={({ highScore }) => {
                  if (activeGame === 'mario') setMarioHigh(highScore);
                  else setShooterHigh(highScore);
                }}
                onExit={handleExitGame}
              />
            </div>
          )}

          {!bootingGame && activeGame && !LoadedCartridge && (
            <div className="cartridge-placeholder-stage">
              <div className="placeholder-box">
                <h3>
                  {activeGame === 'mario'
                    ? '雪线逃脱'
                    : '雷电战机 (Space Shooter)'}
                </h3>
                <p>
                  卡带插槽已就绪（标准分辨率 800 × 600，契约接口 <code>GameCartridgeProps</code>）。
                  当组员在 <code>src/games/{activeGame}/index.tsx</code> 完成开发合并后，此处将自动按需加载正式游戏画面。
                </p>
                <div className="placeholder-controls-spec">
                  <span>按键映射：WASD / 方向键</span>
                  <span>暂停键：{activeGame === 'mario' ? 'Esc 菜单暂停' : 'P 键暂停'}</span>
                  <span>最高分记录：{activeGame === 'mario' ? marioHigh : shooterHigh}</span>
                </div>
                <button
                  type="button"
                  className="cartridge-back-btn"
                  onClick={handleExitGame}
                >
                  退回 PocketOS 桌面
                </button>
              </div>
            </div>
          )}

          {!bootingGame && !activeGame && (
            <div className="pocketos-desktop">
              <div className="desktop-main-area">
                <div className="desktop-welcome-banner">
                  <h2>PocketOS 桌面系统</h2>
                  <p>选择下方街机卡带启动 800 × 600 独立画布游戏</p>
                </div>

                <div className="desktop-cartridge-launcher">
                  <button
                    type="button"
                    className="desktop-game-shortcut is-mario"
                    onClick={() => launchCartridge('mario')}
                  >
                    <div className="shortcut-emblem">雪</div>
                    <div className="shortcut-meta">
                      <strong>雪线逃脱</strong>
                      <span>奶娃滑雪 · 豆包追赶 · 牛来护航</span>
                      <small>最高分：{marioHigh}</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="desktop-game-shortcut is-shooter"
                    onClick={() => launchCartridge('shooter')}
                  >
                    <div className="shortcut-emblem">S</div>
                    <div className="shortcut-meta">
                      <strong>雷电太空战机</strong>
                      <span>Space Shooter · 无尽弹幕生存</span>
                      <small>最高分：{shooterHigh}</small>
                    </div>
                  </button>
                </div>
              </div>

              <footer className="pocketos-taskbar">
                <div className="taskbar-left">
                  <span className="taskbar-start-pill">PocketOS 2.4</span>
                  <span className="taskbar-highscore-summary">
                    MARIO HI: {marioHigh} · SHOOTER HI: {shooterHigh}
                  </span>
                </div>
                <div className="taskbar-right">
                  <button
                    type="button"
                    className="taskbar-btn"
                    onClick={onToggleMute}
                  >
                    {isMuted ? '已静音' : '音效开启'}
                  </button>
                  <span className="taskbar-clock">{clockText}</span>
                  <button
                    type="button"
                    className="taskbar-btn is-shutdown"
                    onClick={onClose}
                  >
                    关机返回房间
                  </button>
                </div>
              </footer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
