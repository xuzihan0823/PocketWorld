// Real, evaluated skin triangles versus the unchanged, fully fitted chair mesh.
// three-mesh-bvh is already supplied by the existing drei dependency.
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { loadValidationGltf } from './load-for-validation.mjs';

export async function chairSurface(kind, mesh) {
  const { scene } = await loadValidationGltf(new URL(`../../../../public/models/replaced/${kind}-chair.parts.glb`, import.meta.url));
  const bounds = new T.Box3().setFromObject(scene), extent = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
  const dimensions = kind === 'rolling' ? [.90, 1.40, .90] : [1.04, 1.40, 1];
  const fit = new T.Group();fit.scale.set(...dimensions.map((n, i) => n / extent.getComponent(i)));
  scene.position.set(-center.x, -bounds.min.y, -center.z);fit.add(scene);fit.updateMatrixWorld(true);
  const seat = fit.getObjectByName('seat');
  const chairGeometry = seat.geometry.clone().applyMatrix4(seat.matrixWorld), bvh = new MeshBVH(chairGeometry);
  const skin = mesh.geometry.clone(), points = skin.attributes.position, skinBVH = new MeshBVH(skin), p = new T.Vector3();
  const identity = new T.Matrix4();
  // These two original body vertices share hip + left/right thigh weights. They
  // are the underside of the pelvis, not a skirt hem or a movable marker.
  const buttockPatch = [19863, 19865];
  return { dimensions, sample(seatDrop = 0) {
    mesh.updateWorldMatrix(true, false);mesh.skeleton.update();
    for (let i = 0; i < points.count; i++) {
      mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld);points.setXYZ(i,p.x,p.y+seatDrop,p.z);
    }
    skinBVH.refit();let intersections=0;const failedBounds=new T.Box3();
    bvh.bvhcast(skinBVH,identity,{intersectsTriangles(a,b) {
      if(a.intersectsTriangle(b)){intersections++;failedBounds.expandByPoint(b.a);failedBounds.expandByPoint(b.b);failedBounds.expandByPoint(b.c);}return false;
    }});
    const gaps=buttockPatch.map(index=>{
      p.fromBufferAttribute(points,index);
      const hit=bvh.raycast(new T.Ray(new T.Vector3(p.x,1,p.z),new T.Vector3(0,-1,0)),T.DoubleSide)
        .filter(h=>h.point.y>.65&&h.point.y<.82).sort((a,b)=>b.point.y-a.point.y)[0];
      return hit?p.y-hit.point.y:null;
    });
    return { intersections, buttockGaps:gaps, ...(intersections?{bounds:[failedBounds.min.toArray(),failedBounds.max.toArray()]}:{}) };
  }, dispose(){skin.dispose();chairGeometry.dispose();} };
}
