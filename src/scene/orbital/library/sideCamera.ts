import { BOOK_SLOTS, shelfPoint, shelfVector, type Vec3 } from './catalog';

/** The side shot looks at the selected book, with the lens centered in the uncovered canvas. */
export function sideLibraryCamera(scene: string, slotId: string | undefined, reading: boolean, width: number, height: number, fov: number) {
  const slot = BOOK_SLOTS.find(value => value.id === slotId);
  const target: Vec3 = shelfPoint(scene, slot?.position[0] ?? 0, reading ? 1.08 : .85, reading ? .65 : .59);

  // Match the right sidebar, bottom sheet and short-screen layouts in library.css.
  let visibleWidth = width, visibleHeight = height;
  if (height <= 600) visibleWidth -= Math.min(390, width * .48) + 12;
  else if (width <= 720) visibleHeight -= height * (reading ? .47 : .43) + 16;
  else visibleWidth -= Math.min(reading ? 420 : 370, width * (reading ? .36 : .34)) + 28;

  // Use the vertical lens angle to fit the subject in both available dimensions.
  // Pickup includes the stance and all shelves; reading favors hands and the folded page.
  const offset: Vec3 = reading ? [1.70, .99, .53] : [2.64, 1.19, .60];
  const fieldScale = 2 * Math.tan(fov * Math.PI / 360);
  const safeWidth = Math.max(1, visibleWidth - 44), safeHeight = Math.max(1, visibleHeight - 52);
  const distance = Math.hypot(...offset);
  const fit = Math.max(distance, (reading ? .88 : 1.35) * height / (fieldScale * safeWidth),
    (reading ? 1.05 : 1.92) * height / (fieldScale * safeHeight));
  return {
    target,
    offset: shelfVector(scene, ...offset).map(value => value * fit / distance) as Vec3,
    lensOffset: [(width - visibleWidth) / 2, (height - visibleHeight) / 2] as const,
  };
}
