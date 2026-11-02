import * as THREE from 'three';
import { movePatch, resizePatch, heightPatch, rotationPatch } from './manipulator-math.js';
import { TYPES } from './editor-state.js';

// Pointer gestures preview locally; only pointer-up commits to the editor history.
export function createManipulator({container,scene,camera,controls,geometry,pick,onSelect,onCommit,onPreview,onDrop}) {
  let enabled=false,mode='move',snapping=true,drag=null,dropFloor='main',ghostType=null;
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
  const overlay=document.createElement('div');overlay.className='model-handles';overlay.hidden=true;container.appendChild(overlay);
  const line=document.createElementNS('http://www.w3.org/2000/svg','svg');line.classList.add('handle-guides');line.setAttribute('aria-hidden','true');overlay.appendChild(line);
  const linePath=document.createElementNS('http://www.w3.org/2000/svg','path');line.appendChild(linePath);
  const definitions=[['move','Move component','✥'],['length-','Resize length from start','−L'],['length+','Resize length from end','+L'],['depth','Resize depth','D'],['height','Resize height','H'],['rotate','Rotate component','↻']];
  const handles=new Map();
  for(const [key,label,text] of definitions){const button=document.createElement('button');button.type='button';button.className=`model-handle handle-${key.replace(/[+-]/g,'')}`;button.dataset.handle=key;button.setAttribute('aria-label',label);button.title=`${label} · drag or use arrow keys`;button.textContent=text;button.addEventListener('keydown',e=>keyMove(e,key));overlay.appendChild(button);handles.set(key,button);}
  const readout=document.createElement('div');readout.className='handle-readout';readout.hidden=true;overlay.appendChild(readout);
  const ghost=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#b49b30',transparent:true,opacity:.35,depthWrite:false}));ghost.visible=false;ghost.userData.editorHelper=true;scene.add(ghost);
  function cast(e){const r=container.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);return r;}
  function intersection(e,y){cast(e);const p=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-y),p)&&p;}
  function selected(){return geometry.selectionData();}
  function displayPoint(c,dx=0,dz=0,y=c.height){const a=c.rotation*Math.PI/180;return new THREE.Vector3(c.x+Math.cos(a)*dx-Math.sin(a)*dz,c.floorElevation+c.y+y,c.z+Math.sin(a)*dx+Math.cos(a)*dz);}
  function project(p,r){const v=p.clone().project(camera);return {x:(v.x+1)*r.width/2,y:(1-v.y)*r.height/2,visible:v.z>=-1&&v.z<=1&&Math.abs(v.x)<1&&Math.abs(v.y)<1};}
  function update(){
    const c=selected(),r=container.getBoundingClientRect();overlay.hidden=!enabled||mode==='orbit'||!c;
    if(overlay.hidden)return;
    const center=displayPoint(c,0,0,c.height/2),top=displayPoint(c),points={move:center,'length-':displayPoint(c,-c.width/2,0,c.height/2),'length+':displayPoint(c,c.width/2,0,c.height/2),depth:displayPoint(c,0,c.depth/2,c.height/2),height:top,rotate:displayPoint(c,0,Math.max(c.depth/2+4,6),c.height/2)};
    const pc=project(center,r),coords={};
    for(const [key,button] of handles){
      const active=mode==='resize'?['length-','length+','height','depth'].includes(key):key===mode;
      const pos=project(points[key],r);
      // Keep thin-member handles apart on screen without changing their drag math.
      if(key==='length-')pos.x-=20;if(key==='length+')pos.x+=20;if(key==='depth')pos.y+=23;if(key==='height')pos.y-=23;
      button.hidden=!active||!pos.visible||pos.x<16||pos.y<16||pos.x>r.width-16||pos.y>r.height-16;
      button.style.left=`${pos.x}px`;button.style.top=`${pos.y}px`;coords[key]=pos;
    }
    let path='';
    for(const [key,button] of handles)if(!button.hidden){const p=coords[key];path+=`M ${pc.x} ${pc.y} L ${p.x} ${p.y} `;}
    linePath.setAttribute('d',path);
    if(mode==='rotate'){
      const radius=Math.max(c.depth/2+4,6),circle=[];
      for(let i=0;i<=64;i++){const p=project(displayPoint(c,Math.cos(i*Math.PI/32)*radius,Math.sin(i*Math.PI/32)*radius,c.height/2),r);circle.push(`${i?'L':'M'} ${p.x} ${p.y}`);}
      linePath.setAttribute('d',path+circle.join(' '));
    }
    readout.hidden=!drag;readout.style.left=`${Math.max(12,Math.min(r.width-190,pc.x+20))}px`;readout.style.top=`${Math.max(100,Math.min(r.height-100,pc.y-45))}px`;
    readout.textContent=drag?.action==='rotate'?`${c.rotation.toFixed(1)}°`:drag&&['length-','length+','depth','height'].includes(drag.action)?`L ${c.width.toFixed(2)} · H ${c.height.toFixed(2)} · D ${c.depth.toFixed(2)} ft`:`X ${c.x.toFixed(2)} · Z ${c.z.toFixed(2)} ft`;
  }
  function resetCapture(id){if(container.hasPointerCapture(id))container.releasePointerCapture(id);controls.enabled=true;container.classList.remove('is-manipulating');readout.hidden=true;}
  function finish(cancel=false){if(!drag)return;const finished=drag;drag=null;resetCapture(finished.id);
    if(cancel){geometry.preview(finished.original.id,finished.restore);onPreview(finished.restore);}
    else if(finished.patch&&Object.keys(finished.patch).some(k=>Math.abs(finished.patch[k]-finished.original[k])>1e-7))onCommit(finished.original.id,finished.patch);
    update();
  }
  function down(e){
    if(!enabled||mode==='orbit'||e.button!==0||drag)return;
    cast(e);const handle=e.target.closest('[data-handle]')?.dataset.handle;
    const hit=handle?null:pick(ray);if(!handle&&!hit?.object.userData.editorId)return;
    if(hit)onSelect(hit.object.userData.editorId);
    const c=selected();if(!c)return;
    const action=handle||'move',y=action==='move'?(hit?.point.y??c.floorElevation+c.y+c.height/2):c.floorElevation+c.y+c.height/2;
    const start=intersection(e,y);if(!start&&action!=='height')return;
    e.preventDefault();e.stopImmediatePropagation();controls.enabled=false;
    drag={id:e.pointerId,action,original:c,restore:Object.fromEntries(['x','z','width','height','depth','rotation'].map(k=>[k,c[k]])),start,y,clientX:e.clientX,clientY:e.clientY,patch:null,
      angle:start?Math.atan2(start.z-c.z,start.x-c.x):0,scale:2*camera.position.distanceTo(displayPoint(c))*Math.tan(camera.fov*Math.PI/360)/container.clientHeight};
    container.setPointerCapture(e.pointerId);container.classList.add('is-manipulating');update();
  }
  function move(e){
    if(!drag||drag.id!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(Math.hypot(e.clientX-drag.clientX,e.clientY-drag.clientY)<3&&!drag.patch)return;
    const {original:c,action}=drag,step=snapping&&!e.altKey ? .5:0;
    const point=intersection(e,drag.y);if(!point&&action!=='height')return;
    let patch;
    if(action==='move')patch=movePatch(c,point.x-drag.start.x,point.z-drag.start.z,step);
    else if(action==='rotate')patch=rotationPatch(c,drag.angle,Math.atan2(point.z-c.z,point.x-c.x),step?15:0);
    else if(action==='height')patch=heightPatch(c,(drag.clientY-e.clientY)*drag.scale,step);
    else{const axis=action==='depth'?'depth':'length',angle=(c.rotation+(axis==='depth'?90:0))*Math.PI/180;
      patch=resizePatch(c,axis,action==='length-'?-1:1,(point.x-drag.start.x)*Math.cos(angle)+(point.z-drag.start.z)*Math.sin(angle),step);}
    if(['x','z'].some(k=>k in patch&&Math.abs(patch[k])>200))return;
    drag.patch=patch;geometry.preview(c.id,patch);onPreview(patch);update();
  }
  function up(e){if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();move(e);finish();}
  function cancel(e){if(drag&&(!('pointerId' in e)||drag.id===e.pointerId))finish(true);}
  function keyMove(e,handle){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    const c=selected();if(!c)return;e.preventDefault();e.stopPropagation();
    const sign=['ArrowRight','ArrowUp'].includes(e.key)?1:-1,step=snapping&&!e.altKey? .5:.1;
    let patch;if(handle==='move')patch=movePatch(c,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0,0);
    else if(handle==='rotate')patch={rotation:((c.rotation+sign*(snapping&&!e.altKey?15:1)+180)%360+360)%360-180};
    else if(handle==='height')patch=heightPatch(c,sign*step,0);
    else patch=resizePatch(c,handle==='depth'?'depth':'length',handle==='length-'?-1:1,sign*step*(handle==='length-'?-1:1),0);
    onCommit(c.id,patch);
  }
  function escape(e){if(e.key==='Escape'&&drag){e.preventDefault();e.stopImmediatePropagation();finish(true);}}
  const hasType=e=>[...e.dataTransfer.types].includes('application/x-fraaime-component');
  function dragover(e){if(!enabled||!hasType(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';const p=intersection(e,geometry.floorElevation(dropFloor));if(!p||!ghostType)return;
    const type=TYPES[ghostType];ghost.position.set(snapping?Math.round(p.x*2)/2:p.x,geometry.floorElevation(dropFloor)+(type.y||0)+type.height/2,snapping?Math.round(p.z*2)/2:p.z);ghost.scale.set(type.width,type.height,type.depth);ghost.visible=Math.abs(p.x)<=200&&Math.abs(p.z)<=200;}
  function drop(e){if(!enabled||!hasType(e))return;e.preventDefault();const type=e.dataTransfer.getData('application/x-fraaime-component'),p=intersection(e,geometry.floorElevation(dropFloor));ghost.visible=false;if(!TYPES[type]||!p||Math.abs(p.x)>200||Math.abs(p.z)>200)return;onDrop(type,dropFloor,snapping?Math.round(p.x*2)/2:p.x,snapping?Math.round(p.z*2)/2:p.z);}
  function leave(e){if(!container.contains(e.relatedTarget))ghost.visible=false;}
  container.addEventListener('pointerdown',down,true);container.addEventListener('pointermove',move,true);container.addEventListener('pointerup',up,true);
  container.addEventListener('pointercancel',cancel,true);container.addEventListener('lostpointercapture',cancel,true);
  container.addEventListener('dragover',dragover);container.addEventListener('drop',drop);container.addEventListener('dragleave',leave);
  document.addEventListener('keydown',escape,true);window.addEventListener('blur',cancel);
  return {update,cancel(){finish(true);},setEnabled(value){finish(true);enabled=value;ghost.visible=false;update();},setMode(value){finish(true);mode=value;update();},setSnap(value){snapping=value;},setDropFloor(value){dropFloor=value;},setDragType(type){ghostType=type;if(!type)ghost.visible=false;},
    dispose(){finish(true);overlay.remove();ghost.geometry.dispose();ghost.material.dispose();scene.remove(ghost);for(const [name,fn,capture] of [['pointerdown',down,true],['pointermove',move,true],['pointerup',up,true],['pointercancel',cancel,true],['lostpointercapture',cancel,true],['dragover',dragover],['drop',drop],['dragleave',leave]])container.removeEventListener(name,fn,capture);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',cancel);}};
}
