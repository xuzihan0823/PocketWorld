import React, { useState } from 'react';
import MarioGame from '../../games/mario';
import { CartridgePlayer } from './CartridgePlayer';

export default function SkiStandalone() {
  const [muted, setMuted] = useState(false);
  const exit = () => { window.location.assign(window.location.pathname); };
  return <CartridgePlayer title="雪线逃脱" muted={muted} onMute={() => setMuted(value => !value)} onExit={exit}>
    <MarioGame isActive isMuted={muted} onExit={exit} />
  </CartridgePlayer>;
}
