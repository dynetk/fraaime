import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initialState, makeComponent, addFloor, validateState, createHistory } from '../dist/editor-state.js';
import * as THREE from '../dist/vendor/three.module.min.js';

const baseline=[{id:'F-main-north',sourceId:'F-main-north',type:'wall',name:'Main north',floor:'main',x:5,z:0,y:0,width:10,height:9,depth:.45,rotation:0,spacing:16,hidden:false}];
test('floor additions and components survive export/import with dimensions intact',()=>{
  const state=initialState(baseline),{floor}=addFloor(state,'Upper floor',20,true);
  const beam=makeComponent('beam',floor.id);beam.width=18;beam.rotation=35;state.components.push(beam);
  const restored=validateState(JSON.parse(JSON.stringify(state)),baseline);
  assert.equal(restored.floors.length,2);assert.equal(restored.components.length,7);
  assert.deepEqual(restored.components.at(-1),beam);
  assert.equal(restored.components.find(c=>c.type==='slab').y,-.5);
});
test('undo and redo restore a whole floor atomically and a new edit clears redo',()=>{
  const history=createHistory(initialState(baseline),baseline),next=history.state;
  addFloor(next,'Third',22);history.commit(next);history.undo();
  assert.equal(history.state.floors.length,1);assert.equal(history.state.components.length,1);
  history.redo();assert.equal(history.state.floors.length,2);
  history.undo();const edited=history.state;edited.components[0].hidden=true;history.commit(edited);
  assert.equal(history.canRedo,false);history.undo();assert.equal(history.state.components[0].hidden,false);
});
test('invalid import cannot mutate current state or alter source identities',()=>{
  const history=createHistory(initialState(baseline),baseline);
  for(const mutate of [s=>s.components[0].width=NaN,s=>s.components[0].depth=-1,s=>s.components[0].spacing=0,s=>s.floors[0].elevation=12,s=>s.components[0].sourceId=null,s=>s.components[0].floor='missing',s=>s.components=[],s=>s.components.push({...s.components[0]})]){
    const next=history.state;mutate(next);assert.throws(()=>history.commit(next));assert.deepEqual(history.state,initialState(baseline));
  }
});
test('history snapshots do not share mutable arrays and reject unknown formats',()=>{
  const history=createHistory(initialState(baseline),baseline);const leaked=history.state;leaked.components[0].width=35;
  assert.equal(history.state.components[0].width,10);
  assert.throws(()=>validateState({...initialState(baseline),format:'other-project'},baseline));
});
test('geometry uses floor datums, isolates added floors, scales source assemblies, and restores removal',async()=>{
  const src=(await readFile(new URL('../dist/editor-geometry.js',import.meta.url),'utf8')).replace("from 'three'",`from '${new URL('../dist/vendor/three.module.min.js',import.meta.url).href}'`);
  const {createEditorGeometry}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
  const scene=new THREE.Scene(),frame=new THREE.Group(),architecture=new THREE.Group();
  for(const g of [frame,architecture]){g.add(new THREE.Mesh(new THREE.BoxGeometry(10,9,.45),new THREE.MeshBasicMaterial()));scene.add(g);}
  const sources=new Map([['F-main-north',{frame,architecture,level:'main',name:'north',x:5,z:0,length:10,alongX:true}]]);
  const geometry=createEditorGeometry(scene,sources,{},{}),state=initialState(geometry.baseline);
  const {floor}=addFloor(state,'Third',22,false);const beam=makeComponent('beam',floor.id);beam.x=12;beam.z=17;beam.rotation=90;state.components.push(beam);
  state.components[0].width=20;state.components[0].x=11;
  geometry.update(state);geometry.sync('exterior','frame');
  const group=scene.children.find(g=>g.children.some(c=>c.userData.editorId===beam.id));
  const item=group.children.find(g=>g.userData.editorId===beam.id);
  assert.equal(item.position.y,30.25);assert.equal(item.position.x,12);assert.equal(frame.scale.x,2);assert.equal(frame.position.x,11);
  geometry.sync('main','frame');assert.equal(item.visible,false);
  geometry.sync(floor.id,'architecture');assert.equal(item.visible,true);assert.equal(item.position.y,8.25);
  state.components[0].hidden=true;geometry.update(state);assert.equal(frame.visible,false);assert.equal(architecture.visible,false);
  geometry.update(initialState(geometry.baseline));assert.equal(frame.visible,true);assert.equal(frame.scale.x,1);
  geometry.dispose();
});
