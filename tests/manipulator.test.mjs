import test from 'node:test';
import assert from 'node:assert/strict';
import { movePatch, resizePatch, heightPatch, rotationPatch } from '../dist/manipulator-math.js';
import { initialState, makeComponent, createHistory } from '../dist/editor-state.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const component={x:12,z:19,width:12,depth:.5,height:9,rotation:0};
function end(c,axis,sign){const a=(c.rotation+(axis==='depth'?90:0))*Math.PI/180,k=axis==='depth'?'depth':'width';return [c.x+sign*c[k]/2*Math.cos(a),c.z+sign*c[k]/2*Math.sin(a)];}
test('move supports grid snapping, free placement, and bounded coordinates',()=>{
  assert.deepEqual(movePatch(component,.2,1.3),{x:12,z:20.5});
  assert.deepEqual(movePatch(component,.2,1.3,0),{x:12.2,z:20.3});
  assert.deepEqual(movePatch(component,500,-500),{x:200,z:-200});
});
test('both length handles anchor the opposite endpoint at any orientation',()=>{
  for(const rotation of [0,45,90,-90,179])for(const sign of [-1,1]){
    const c={...component,rotation},fixed=end(c,'length',-sign),patch=resizePatch(c,'length',sign,sign*5,0),updated={...c,...patch};
    close(updated.width,17);const after=end(updated,'length',-sign);close(fixed[0],after[0]);close(fixed[1],after[1]);
  }
});
test('depth resizing uses the perpendicular axis and preserves the opposite edge',()=>{
  const c={...component,rotation:35},fixed=end(c,'depth',-1),updated={...c,...resizePatch(c,'depth',1,3,0)};
  close(updated.depth,3.5);const after=end(updated,'depth',-1);close(fixed[0],after[0]);close(fixed[1],after[1]);close(updated.width,12);
});
test('size handles never invert or exceed maximum dimensions',()=>{
  assert.equal(resizePatch(component,'length',1,-99).width,.02);
  assert.equal(resizePatch(component,'length',1,1000).width,150);
  assert.equal(heightPatch(component,-100).height,.02);
  assert.equal(heightPatch(component,1000).height,150);
  assert.equal(heightPatch(component,1.16,0).height,10.16);
});
test('rotation snaps, supports free angles, and crosses the signed-angle boundary',()=>{
  assert.equal(rotationPatch(component,0,Math.PI/2).rotation,90);
  assert.equal(rotationPatch(component,0,20*Math.PI/180).rotation,15);
  close(rotationPatch(component,0,20*Math.PI/180,0).rotation,20);
  close(rotationPatch(component,179*Math.PI/180,-179*Math.PI/180,0).rotation,2);
});
test('many drag previews form one undoable commit and retain export compatibility',()=>{
  const state=initialState([]),c=makeComponent('beam','main');state.components.push(c);const history=createHistory(state,[]);
  let draft=history.state;
  for(let i=1;i<=20;i++)Object.assign(draft.components[0],movePatch(c,i/2,i/3));
  history.commit(draft);assert.notDeepEqual(history.state,state);history.undo();assert.deepEqual(history.state,state);assert.equal(history.canUndo,false);
  history.redo();assert.deepEqual(history.state,draft);
});
