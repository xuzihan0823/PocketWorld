// Room-local metres. The starboard side and window stay fixed as the port side widens.
export const CABIN_LEFT = -6.57;
export const CABIN_RIGHT = 4.24;
export const CABIN_CENTER_X = (CABIN_LEFT + CABIN_RIGHT) / 2;

export const BED_POSITION: [number, number, number] = [-4.05, 0, -1.897];
export const BED_ENTRY: [number, number] = [BED_POSITION[0] + 1.12, BED_POSITION[2] - .27];

// Armless floor sofa at the open corner in front of the bedside rug.
export const FLOOR_SOFA = {
  position: [-5.39, 0, 1.95] as [number, number, number],
  // Aim the seat centreline at the bedside rug (−4.05, 0.115). The throw offsets the asset pivot.
  yaw: 2.577,
  width: 1.49,
  // X/Z offsets measured after scaling and turning the entire GLB, including its fringe.
  footprint: { left: -.69, right: .83, back: -.86, front: .93 },
};

// The table top is a fixed part of the authored cabin mesh.
export const NIGHTSTAND_X = -2.52;
export const NIGHTSTAND_Z = -2.825;
export const LAMP_POSITION: [number, number, number] = [NIGHTSTAND_X - .31, .829, NIGHTSTAND_Z];
export const PLANT_POSITION: [number, number, number] = [NIGHTSTAND_X + .31, .829, NIGHTSTAND_Z - .09];
