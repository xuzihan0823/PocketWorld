// Authored room coordinates. The upper deck reuses the original port-side coordinates.
export const CABIN_LEFT = -6.57;
export const CABIN_RIGHT = 4.24;

export const CAT_HOME = [3.02, 2.38] as const;
export const CAT_YAW = -.75;
export const CAT_MAT_Y = .015;
export const CAT_CUSHION_TOP = .08;

// Floor area shared by the resident walker and loose props such as the slippers.
export const HABITAT_SPAWN: [number, number] = [2.52, 1.10];
export const RESIDENT_RADIUS = 0.23;
export const WALK_BOUNDS = { left: CABIN_LEFT + .25 + RESIDENT_RADIUS, right: 3.76, back: -2.96, front: 2.96 };

export const CABIN_DIVIDER_X = -1.86;
export const UPPER_DECK_OFFSET: [number, number, number] = [CABIN_DIVIDER_X - CABIN_LEFT, 3.82, 0];
// Matches the finished return-wall trim in scripts/export-open-cabin.py.
export const BEDROOM_WALL_FRONT = 1.20;
export const BEDROOM_WALL_OUTSET = .135;
export type CabinDeck = 'lower' | 'upper';

export const DECK_WALK_BOUNDS = {
  lower: { ...WALK_BOUNDS, left: CABIN_DIVIDER_X + RESIDENT_RADIUS + .035 },
  upper: { ...WALK_BOUNDS, right: CABIN_DIVIDER_X - RESIDENT_RADIUS - .035 },
};

export function deckFromAuthoredX(x: number): CabinDeck {
  return x < CABIN_DIVIDER_X ? 'upper' : 'lower';
}

export function authoredCabinPoint(point: [number, number, number], deck: CabinDeck): [number, number, number] {
  return deck === 'upper' ? [point[0] - UPPER_DECK_OFFSET[0], point[1] - UPPER_DECK_OFFSET[1], point[2]] : point;
}

export const BED_POSITION: [number, number, number] = [-4.05, 0, -1.897];

// The wardrobe occupies the west half of the combined Wardrobe_Nightstand mesh.
export const WARDROBE_FOOTPRINT: [number, number, number, number] = [-6.47, -4.97, -3.18, -2.29];
export const WARDROBE_STAND: [number, number] = [-5.72, -1.90];

// Armless floor sofa at the open corner in front of the bedside rug.
export const FLOOR_SOFA = {
  position: [-5.39, 0, 1.95] as [number, number, number],
  // Aim the seat centreline at the bedside rug (−4.05, 0.115). The throw offsets the asset pivot.
  yaw: 2.577,
  width: 1.49,
  // X/Z offsets measured after scaling and turning the entire GLB, including its fringe.
  footprint: { left: -.69, right: .83, back: -.86, front: .93 },
};

// Pedal trash can placed against the starboard wall north of the bookcase, pedal facing the room (-X).
export const TRASH_CAN = {
  position: [3.64, 0, 0.42] as [number, number, number],
  yaw: -Math.PI / 2,
  height: 0.56,
  // X/Z offsets measured from trash-can.glb after ReusableAsset centering, scaling and yaw rotation.
  footprint: { left: -0.24, right: 0.24, back: -0.22, front: 0.22 },
};

export interface PlushDollPlacement {
  id: 'plush-bunny' | 'plush-bear' | 'plush-penguin';
  name: string;
  path: string;
  position: [number, number, number];
  yaw: number;
  height: number;
  // Circular solid collision radius on the floor plane (m), matching the plushie's seated girth.
  radius: number;
  // X/Z offsets measured from each GLB after ReusableAsset centering, scaling and yaw rotation.
  footprint: { left: number; right: number; back: number; front: number };
}

// Floor perimeter available to loose dynamic plush dolls (inset from aft/starboard walls and open edges).
export const PLUSH_FLOOR_BOUNDS = { left: -6.42, right: 4.02, back: -3.18, front: 3.02 };

// Three sitting short-pile plush dolls placed around the habitat with solid, kickable floor physics.
export const PLUSH_DOLLS: readonly PlushDollPlacement[] = [
  {
    id: 'plush-bunny',
    name: 'Furniture_PlushBunny',
    path: 'furniture/plush-bunny.glb',
    position: [-4.02, 0, 2.28],
    yaw: 0.26,
    height: 0.58,
    radius: 0.20,
    footprint: { left: -0.21, right: 0.23, back: -0.19, front: 0.22 },
  },
  {
    id: 'plush-bear',
    name: 'Furniture_PlushBear',
    path: 'furniture/plush-bear.glb',
    position: [-5.58, 0, -1.48],
    yaw: 0.40,
    height: 0.55,
    radius: 0.23,
    footprint: { left: -0.25, right: 0.29, back: -0.21, front: 0.26 },
  },
  {
    id: 'plush-penguin',
    name: 'Furniture_PlushPenguin',
    path: 'furniture/plush-penguin.glb',
    position: [1.76, 0, 2.36],
    yaw: -0.52,
    height: 0.47,
    radius: 0.22,
    footprint: { left: -0.27, right: 0.25, back: -0.24, front: 0.26 },
  },
];

// Bedside props share the nightstand's authored upper-deck placement.
export const NIGHTSTAND_X = -2.52;
export const NIGHTSTAND_Z = -2.825;
export const COMPUTER_STAND: [number, number] = [1.55, -1.36];
export const LAMP_POSITION: [number, number, number] = [NIGHTSTAND_X - .31, .829, NIGHTSTAND_Z];
export const PLANT_POSITION: [number, number, number] = [NIGHTSTAND_X + .31, .829, NIGHTSTAND_Z - .09];
export const CLOCK_POSITION: [number, number, number] = [NIGHTSTAND_X + .34, 1.02, NIGHTSTAND_Z + .21];
