/**
 * 电脑内置小游戏统一「卡带」接口契约
 * mario（src/games/mario）与 shooter（src/games/shooter）两张卡带均需实现此 Props 接口，行为约定见 SPEC.md 第 3 节。
 */
export interface GameCartridgeProps {
  /** 虚拟屏幕逻辑宽度（默认 800px，内部 Canvas 按此坐标系绘制，外层容器负责等比缩放） */
  width?: number;
  /** 虚拟屏幕逻辑高度（默认 600px） */
  height?: number;
  /** 全局静音状态（当房间音乐或系统静音开启时同步传入） */
  isMuted?: boolean;
  /** 游戏运行态：false 时游戏应自动暂停（例如窗口最小化或切出电脑视角） */
  isActive?: boolean;
  /** 分数变化回调，用于同步更新电脑状态栏与本地最高分记录 */
  onScoreChange?: (currentScore: number, highScore: number) => void;
  /** 游戏结束或通关回调，可用于解锁房间内的彩蛋或纪念徽章 */
  onGameOver?: (result: { score: number; highScore: number; victory: boolean }) => void;
  /** 用户在游戏内点击「退出到电脑桌面」时触发 */
  onExit: () => void;
}

export type GameId = 'mario' | 'shooter';

export interface GameMetadata {
  id: GameId;
  title: string;
  subtitle: string;
  author?: string;
  controlsHint: string[];
}
