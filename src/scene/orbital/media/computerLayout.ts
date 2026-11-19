// The wider CRT keeps its original depth so the keyboard and transfer lane stay clear.
export const CRT_SCALE = 1.16;
export const CRT_SCREEN: [number, number, number] = [1.55, 1.12 + .56 * CRT_SCALE, -2.343];
export const CRT_SIZE: [number, number, number] = [1.25 * CRT_SCALE, 1.05 * CRT_SCALE, .65];
