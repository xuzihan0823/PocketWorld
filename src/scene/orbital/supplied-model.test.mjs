import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cloneSuppliedModel } from './supplied-model.ts';

test('a multi-material glTF part keeps every primitive and excludes other parts', () => {
  const source = new THREE.Group(), body = new THREE.Group(); body.name = 'body';
  const shell = new THREE.Mesh(new THREE.BoxGeometry()), cap = new THREE.Mesh(), cover = new THREE.Mesh(new THREE.BoxGeometry());
  cover.position.x=3;
  shell.name='body_1'; cap.name='body_2'; cover.name='cover'; body.add(shell,cap);source.add(body,cover);
  const first=cloneSuppliedModel(source,'body'),second=cloneSuppliedModel(source,'cover');
  assert.equal(first.getObjectByName('body_1').visible,true);
  assert.equal(first.getObjectByName('body_2').visible,true);
  assert.equal(first.getObjectByName('cover').visible,false);
  assert.equal(second.getObjectByName('body_1').visible,false);
  assert.equal(second.getObjectByName('cover').visible,true);
  assert.equal(source.getObjectByName('cover').visible,true);
  first.updateMatrixWorld(true);second.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(3,0,5),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(first,true).length,0);
  assert.ok(ray.intersectObject(second,true).length>0);
  assert.equal(source.getObjectByName('cover').raycast,THREE.Mesh.prototype.raycast);
  first.position.x=3;assert.equal(second.position.x,0);assert.equal(source.position.x,0);
});
test('a single primitive and immutable GPU resources remain usable by both scenes',()=>{
  const source=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.name='seat';source.add(mesh);
  const copy=cloneSuppliedModel(source,'seat').getObjectByName('seat');
  assert.notEqual(copy,mesh);assert.equal(copy.geometry,mesh.geometry);assert.equal(copy.material,mesh.material);
  assert.equal(copy.castShadow,true);assert.equal(mesh.castShadow,false);
  assert.throws(()=>cloneSuppliedModel(source,'unknown'),/Missing supplied part/);
});
