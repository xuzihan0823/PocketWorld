export const TRIPO_SCALE = 1.45;
export const TRIPO_SPEED = .25 * TRIPO_SCALE;
export const tripoRoomTest = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('resident') === 'tripo';
