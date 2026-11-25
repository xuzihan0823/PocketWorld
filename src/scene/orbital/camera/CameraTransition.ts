import { MathUtils, Matrix4, OrthographicCamera, PerspectiveCamera, Spherical, Vector3, type Camera, type Raycaster, type Vector2 } from 'three';
import { CAMERA_FOV, HOME_ZOOM } from '../cabinView.ts';

const toPolar = new Spherical(), fromPolar = new Spherical();
const offset = new Vector3();
const turn = Math.PI * 2;

export function interpolateEye(out: Vector3, fromEye: Vector3, fromTarget: Vector3, toEye: Vector3, toTarget: Vector3, target: Vector3, t: number) {
  fromPolar.setFromVector3(offset.subVectors(fromEye, fromTarget));
  toPolar.setFromVector3(offset.subVectors(toEye, toTarget));
  const delta = MathUtils.euclideanModulo(toPolar.theta - fromPolar.theta + Math.PI, turn) - Math.PI;
  return out.setFromSphericalCoords(
    MathUtils.lerp(fromPolar.radius, toPolar.radius, t),
    MathUtils.lerp(fromPolar.phi, toPolar.phi, t),
    fromPolar.theta + delta * t,
  ).add(target);
}

export function perspectiveHalfHeight(camera: PerspectiveCamera, distance: number) {
  return Math.tan(MathUtils.degToRad(camera.fov / 2)) * distance / camera.zoom;
}

export function blendProjection(out: Matrix4, orthographic: Matrix4, perspective: Matrix4, distance: number, amount: number) {
  // Normalize both homogeneous weights to 1 on the plane through the target.
  // A linear blend is then exact on that plane, including an off-axis shift.
  for (let i = 0; i < 16; i++) {
    out.elements[i] = MathUtils.lerp(orthographic.elements[i], perspective.elements[i] / distance, amount);
  }
}

export class CameraProjection {
  readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, .08, 2000);
  readonly transitional = new PerspectiveCamera(CAMERA_FOV, 1, .08, 2000);
  private readonly celestial = new PerspectiveCamera(CAMERA_FOV, 1, .08, 2000);

  constructor() {
    this.transitional.userData.blendedProjection = true;
    Object.assign(this.orthographic, { manual: true });
    Object.assign(this.transitional, { manual: true });
  }

  sync(driver: PerspectiveCamera, target: Vector3, amount: number): Camera {
    driver.updateMatrixWorld();
    if (amount === 1) return driver;
    const distance = Math.max(.09, driver.position.distanceTo(target));
    const halfHeight = perspectiveHalfHeight(driver, distance);
    const ortho = this.orthographic;
    ortho.left = -halfHeight * driver.aspect;
    ortho.right = halfHeight * driver.aspect;
    ortho.top = halfHeight;
    ortho.bottom = -halfHeight;
    const view = driver.view;
    if (view?.enabled) ortho.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    else if (ortho.view?.enabled) ortho.clearViewOffset();
    ortho.updateProjectionMatrix();
    const active = amount === 0 ? ortho : this.transitional;
    if (active === this.transitional) {
      blendProjection(active.projectionMatrix, ortho.projectionMatrix, driver.projectionMatrix, distance, amount);
      active.projectionMatrixInverse.copy(active.projectionMatrix).invert();
    }
    const sky = this.celestial;
    sky.aspect = driver.aspect;
    sky.fov = MathUtils.lerp(CAMERA_FOV, driver.fov, amount);
    sky.zoom = MathUtils.lerp(HOME_ZOOM, driver.zoom, amount);
    if (view?.enabled) sky.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    else if (sky.view?.enabled) sky.clearViewOffset();
    sky.updateProjectionMatrix();
    active.userData.celestialProjection = sky.projectionMatrix;
    active.position.copy(driver.position);
    active.quaternion.copy(driver.quaternion);
    active.updateMatrixWorld();
    return active;
  }
}

const rayEnd = new Vector3();
export function setCameraRay(raycaster: Raycaster, pointer: Vector2, camera: Camera) {
  if (!camera.userData.blendedProjection) {
    raycaster.setFromCamera(pointer, camera);
    return;
  }
  raycaster.camera = camera;
  raycaster.ray.origin.set(pointer.x, pointer.y, -1).unproject(camera);
  rayEnd.set(pointer.x, pointer.y, 1).unproject(camera);
  raycaster.ray.direction.subVectors(rayEnd, raycaster.ray.origin).normalize();
}
