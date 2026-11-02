import { TYPES, STORAGE_KEY, initialState, makeComponent, addFloor, validateState, createHistory, uid } from './editor-state.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountEditor(model, { setView, toast, onChange }) {
  const $ = s => document.querySelector(s), baseline = model.getBaseline();
  let initial = initialState(baseline), loadError = false;
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) initial = validateState(JSON.parse(saved), baseline); }
  catch { loadError = true; }
  const history = createHistory(initial, baseline);
  let enabled = false, selected = null, activeFloor = 'main', placing = false, editTool = 'move';
  const panel = document.createElement('aside'); panel.className = 'editor-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Model editor');
  panel.innerHTML = `
    <div class="editor-title"><div><div class="eyebrow">FRAAIME / OPEN CONCEPT EDITOR</div><h2>Shape the next idea.</h2></div><span class="editor-live">EDIT</span></div>
    <p class="editor-intro">Drag components on the model. Use Resize or Rotate for mouse handles. Dimensions below are in feet.</p>
    <div class="editor-actions"><button id="edit-undo" class="button outline" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button><button id="edit-redo" class="button outline" title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</button></div>
    <div class="editor-divider"></div>
    <div class="editor-section-heading"><h3>Floors</h3><button id="edit-add-floor" class="text-button">+ Add floor</button></div>
    <label for="edit-floor">Working floor</label><select id="edit-floor"></select>
    <div class="editor-floor-actions"><button id="edit-isolate" class="text-button">View this floor</button><button id="edit-floor-settings" class="text-button">Floor settings</button></div>
    <div class="editor-section-heading"><h3>Components</h3><span id="edit-count"></span></div>
    <div class="editor-add-row"><label class="sr-only" for="edit-type">Component type</label><select id="edit-type">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select><button class="button yellow" id="edit-add">+ Add</button></div>
    <details class="component-library" open><summary>Drag a component onto the model</summary><div class="component-palette">${Object.entries(TYPES).map(([key,value])=>`<button type="button" draggable="true" data-component-type="${key}" title="Drag onto the model, or click to add">⠿ ${value.label}</button>`).join('')}</div></details>
    <label for="edit-selection">Select on working floor</label><select id="edit-selection"></select>
    <p class="editor-empty" id="edit-empty">Choose a wall, add a component, or select an item above to start editing.</p>
    <form id="edit-form" hidden>
      <div class="editor-selection-header"><span id="edit-origin"></span><button type="button" id="edit-focus" class="text-button">Focus ↗</button></div>
      <label for="edit-name">Name</label><input id="edit-name" required maxlength="80">
      <div class="editor-field-grid">
        <div><label for="edit-x">Center X · ft</label><input id="edit-x" type="number" step="any" min="-200" max="200" required></div>
        <div><label for="edit-z">Center Z · ft</label><input id="edit-z" type="number" step="any" min="-200" max="200" required></div>
        <div><label for="edit-y">Bottom above floor · ft</label><input id="edit-y" type="number" step="any" min="-50" max="100" required></div>
        <div><label for="edit-rotation">Rotation · degrees</label><input id="edit-rotation" type="number" step="any" min="-360" max="360" required></div>
        <div><label for="edit-width">Length · ft</label><input id="edit-width" type="number" step="any" min=".02" max="150" required></div>
        <div><label for="edit-height">Height · ft</label><input id="edit-height" type="number" step="any" min=".02" max="150" required></div>
        <div><label for="edit-depth">Depth · ft</label><input id="edit-depth" type="number" step="any" min=".02" max="150" required></div>
        <div id="edit-spacing-field"><label for="edit-spacing">Stud spacing · inches</label><input id="edit-spacing" type="number" step="any" min="6" max="48" required></div>
      </div>
      <p id="edit-source-note" class="editor-note"></p>
      <p class="error" id="edit-error" role="alert"></p>
      <button class="button dark full" type="submit">Apply changes <span>✓</span></button>
      <div class="editor-actions"><button type="button" class="button outline" id="edit-place" aria-pressed="false">Place on plan</button><button type="button" class="button outline" id="edit-duplicate">Duplicate</button><button type="button" class="button outline danger" id="edit-delete">Remove</button></div>
    </form>
    <div class="editor-divider"></div>
    <p id="edit-save-status" class="editor-save-status" role="status"></p>
    <div class="editor-actions"><button class="button outline" id="edit-export">Export design ↓</button><button class="button outline" id="edit-import">Import design ↑</button></div>
    <input id="edit-import-file" type="file" accept="application/json,.json" hidden>
    <button id="edit-reset" class="text-button">Clear concept</button>
    <p class="editor-note">Concept changes only. This public editor contains no customer plans, schedules, source geometry or estimating data. Components use simplified shapes, not engineered member profiles.</p>`;
  $('.model-workspace').appendChild(panel);
  $('#model').setAttribute('role','group');
  const toggle = document.createElement('button'); toggle.id='edit-toggle'; toggle.className='button yellow'; toggle.textContent='Edit model'; toggle.setAttribute('aria-pressed','false');
  const actions = document.createElement('div'); actions.className='viewer-tool-actions';
  $('#model-help').before(actions); actions.append(toggle, $('#model-help'));
  const banner = document.createElement('div'); banner.id='edit-banner'; banner.className='edit-banner'; banner.hidden=true; banner.setAttribute('role','status'); $('.model-card').appendChild(banner);
  const tools=document.createElement('div');tools.className='edit-tools';tools.hidden=true;tools.innerHTML=`<div class="segmented" aria-label="Mouse editing tools"><button data-edit-tool="move" class="selected" aria-pressed="true">Move</button><button data-edit-tool="resize" aria-pressed="false">Resize</button><button data-edit-tool="rotate" aria-pressed="false">Rotate</button><button data-edit-tool="orbit" aria-pressed="false">Orbit</button></div><label class="edit-snap"><input id="edit-snap" type="checkbox" checked> Snap</label>`;$('.model-card').appendChild(tools);
  const summary=document.createElement('p');summary.id='model-edit-summary';summary.className='model-edit-summary';summary.hidden=true;$('.model-workspace').before(summary);
  const floorDialog = document.createElement('dialog'); floorDialog.id='edit-floor-dialog';
  floorDialog.innerHTML=`<div class="dialog-heading"><div class="eyebrow">MODEL LEVELS</div><button id="edit-floor-close" class="icon-button" aria-label="Close floor settings">×</button></div><h2 id="edit-floor-title">Add a floor.</h2><form id="edit-floor-form"><label for="edit-floor-name">Floor name</label><input id="edit-floor-name" required maxlength="80"><label for="edit-floor-elevation">Floor elevation above ground · ft</label><input id="edit-floor-elevation" type="number" min="-50" max="150" step="any" required><label class="editor-check" id="edit-perimeter-label"><input type="checkbox" id="edit-perimeter" checked> Add four perimeter wall panels</label><p id="edit-floor-description">Starts with a rectangular slab matching the generic 20 × 20 ft template. Adjust its size and the walls after adding. Openings and rooms are not copied.</p><p class="error" id="edit-floor-error" role="alert"></p><div class="editor-actions"><button class="button dark" type="submit" id="edit-floor-submit">Add floor</button><button type="button" class="button outline danger" id="edit-floor-delete" hidden>Remove floor</button></div></form>`;
  document.body.appendChild(floorDialog);
  const confirmDialog = document.createElement('dialog'); confirmDialog.innerHTML=`<h2 id="edit-confirm-title"></h2><p id="edit-confirm-text"></p><div class="editor-actions"><button class="button dark" id="edit-confirm-yes">Confirm</button><button class="button outline" id="edit-confirm-no">Cancel</button></div>`; document.body.appendChild(confirmDialog);
  function confirm(title, text, fn) { $('#edit-confirm-title').textContent=title;$('#edit-confirm-text').textContent=text;$('#edit-confirm-yes').onclick=()=>{confirmDialog.close();fn();};$('#edit-confirm-no').onclick=()=>confirmDialog.close();confirmDialog.showModal(); }
  const fields = ['x','z','y','rotation','width','height','depth','spacing'];
  function setPlacing(on) { placing=on;model.setPlacement(on);$('#edit-place').setAttribute('aria-pressed',on);$('#edit-place').textContent=on?'Cancel placement':'Place on plan';updateBanner(); }
  function updateBanner() { banner.hidden=!enabled;banner.textContent=placing?'Click to place · Esc cancels':({move:'Drag a component to move it · empty space or Orbit moves the camera',resize:'Drag L to change length, D for depth, H for height · Alt bypasses snap',rotate:'Drag the ↻ handle around the center · snaps to 15° · Alt for free rotation',orbit:'Drag to orbit the camera · choose Move to edit components'})[editTool]; }
  tools.querySelectorAll('[data-edit-tool]').forEach(b=>b.onclick=()=>{editTool=b.dataset.editTool;setPlacing(false);model.setEditTool(editTool);tools.querySelectorAll('[data-edit-tool]').forEach(t=>{const active=t===b;t.classList.toggle('selected',active);t.setAttribute('aria-pressed',active);});updateBanner();});
  $('#edit-snap').onchange=e=>model.setEditSnap(e.target.checked);
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.state));$('#edit-save-status').textContent='● Saved in this browser · export to share or back up'; }
    catch { $('#edit-save-status').textContent='Not saved: browser storage unavailable. Export your design to keep changes.'; }
  }
  function render(saveNow = false) {
    const state = history.state;
    if (!state.floors.some(f=>f.id===activeFloor)) { activeFloor='main';setView('exterior'); }
    if (!state.components.some(c=>c.id===selected&&!c.hidden)) selected=null;
    $('#edit-floor').innerHTML=state.floors.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · +${Number(f.elevation.toFixed(3))} ft</option>`).join('');$('#edit-floor').value=activeFloor;
    const components=state.components.filter(c=>c.floor===activeFloor&&!c.hidden);
    $('#edit-count').textContent=`${components.length} items`;
    $('#edit-selection').innerHTML='<option value="">Choose a component</option>'+components.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.sourceId?' · source':''}</option>`).join('');$('#edit-selection').value=selected||'';
    const c=state.components.find(c=>c.id===selected);$('#edit-form').hidden=!c;$('#edit-empty').hidden=!!c;
    if(c){$('#edit-name').value=c.name;fields.forEach(k=>$('#edit-'+k).value=Number(c[k].toFixed(5)));$('#edit-spacing-field').hidden=c.type!=='wall'||!!c.sourceId;$('#edit-origin').textContent=c.sourceId?'SOURCE WALL ASSEMBLY':'ADDED CONCEPT COMPONENT';$('#edit-source-note').textContent=c.sourceId?'Resizing scales this assembly, including its openings and stud layout. Original schedule dimensions remain reference-only. Duplicating makes a new solid framed panel.':'X and Z locate the center on the plan; bottom is relative to this floor. Positive rotation turns the length from +X toward +Z.';}
    $('#edit-error').textContent='';$('#edit-undo').disabled=!history.canUndo;$('#edit-redo').disabled=!history.canRedo;
    model.setDropFloor(activeFloor);model.updateEdits(state);model.selectEdit(enabled?selected:null);setPlacing(false);
    const extra=state.floors.length-1;$('#model-level-count').textContent=String(state.floors.length).padStart(2,'0');$('#model-level-note').textContent=extra?`${extra} added concept ${extra===1?'floor':'floors'} · 1 ground level`:'Empty ground-floor workspace';
    const added=state.components.filter(c=>!c.sourceId&&!c.hidden).length,changed=state.components.filter(c=>c.sourceId&&JSON.stringify(c)!==JSON.stringify(baseline.find(b=>b.id===c.id))).length;
    summary.hidden=!added&&!changed&&!extra;summary.textContent=`CUSTOM CONCEPT · ${added} added components · ${changed} source walls changed · no takeoff or pricing is calculated.`;
    $('#model').setAttribute('aria-label',`Interactive blank concept model with ${state.floors.length} floors. Drag to orbit; use Edit model to change wall assemblies or add components.`);
    if(saveNow)save();
  }
  function commit(next, message) { try {history.commit(next);render(true);onChange?.();if(message)toast(message);return true;}catch(e){$('#edit-error').textContent=e.message;toast(e.message);return false;} }
  function select(id) {const c=history.state.components.find(c=>c.id===id&&!c.hidden);if(!c)return;selected=id;activeFloor=c.floor;render();}
  function toggleMode(on) {enabled=on;toggle.textContent=on?'Done editing':'Edit model';toggle.setAttribute('aria-pressed',on);panel.hidden=!on;tools.hidden=!on;$('.review-card').hidden=on;$('.model-workspace').classList.toggle('is-editing',on);model.setEditMode(on);model.selectEdit(on?selected:null);setPlacing(false);}
  toggle.onclick=()=>toggleMode(!enabled);
  model.onViewChange(view=>{setPlacing(false);if(view!=='exterior'&&activeFloor!==view){activeFloor=view;selected=null;render();}});
  model.onEditSelect(select);model.onEditMove((x,z)=>{const next=history.state,c=next.components.find(c=>c.id===selected);if(c){c.x=x;c.z=z;commit(next,'Component placed on the plan.');}});
  model.onEditTransform((id,patch)=>{const next=history.state,c=next.components.find(c=>c.id===id);if(!c)return;Object.assign(c,patch);if(!commit(next))render();});
  model.onEditPreview(patch=>{for(const key of fields)if(key in patch)$('#edit-'+key).value=Number(patch[key].toFixed(5));});
  function addAt(type,floor,x,z){const next=history.state;if(next.components.length>=300){toast('This concept supports up to 300 components.');return;}const c=makeComponent(type,floor,next.components.filter(c=>!c.sourceId).length);if(x!==undefined){c.x=x;c.z=z;}next.components.push(c);selected=c.id;activeFloor=floor;if(commit(next,`${TYPES[c.type].label} added. Drag it or use the mouse handles to adjust it.`)&&x===undefined)setView(activeFloor);}
  model.onComponentDrop(addAt);
  for(const b of panel.querySelectorAll('[data-component-type]')){b.onclick=()=>addAt(b.dataset.componentType,activeFloor);b.ondragstart=e=>{e.dataTransfer.setData('application/x-fraaime-component',b.dataset.componentType);e.dataTransfer.effectAllowed='copy';model.setLibraryDrag(b.dataset.componentType);};b.ondragend=()=>model.setLibraryDrag(null);}
  $('#edit-add').draggable=true;$('#edit-add').title='Drag onto the model, or click to add';$('#edit-add').ondragstart=e=>{const type=$('#edit-type').value;e.dataTransfer.setData('application/x-fraaime-component',type);e.dataTransfer.effectAllowed='copy';model.setLibraryDrag(type);};$('#edit-add').ondragend=()=>model.setLibraryDrag(null);
  $('#edit-floor').onchange=e=>{activeFloor=e.target.value;selected=null;render();setView(activeFloor);};
  $('#edit-isolate').onclick=()=>setView(activeFloor);
  $('#edit-selection').onchange=e=>{if(e.target.value){select(e.target.value);setView(activeFloor);}else{selected=null;render();}};
  $('#edit-add').onclick=()=>addAt($('#edit-type').value,activeFloor);
  $('#edit-form').onsubmit=e=>{e.preventDefault();const next=history.state,c=next.components.find(c=>c.id===selected);if(!c)return;c.name=$('#edit-name').value.trim();fields.forEach(k=>c[k]=Number($('#edit-'+k).value));commit(next,'Component changes saved.');};
  $('#edit-place').onclick=()=>{if(!placing){setView(activeFloor);model.top();}setPlacing(!placing);};
  $('#edit-focus').onclick=()=>{setView(activeFloor);model.focusEdit();};
  $('#edit-duplicate').onclick=()=>{const next=history.state,c=next.components.find(c=>c.id===selected);if(!c)return;const copy={...c,id:uid(),sourceId:null,name:`${c.name.slice(0,70)} copy`,x:Math.min(200,c.x+2),z:Math.min(200,c.z+2)};next.components.push(copy);selected=copy.id;commit(next,c.sourceId?'Duplicated as a solid framed panel. Source openings are not copied.':'Component duplicated.');};
  $('#edit-delete').onclick=()=>{const next=history.state,c=next.components.find(c=>c.id===selected);if(!c)return;if(c.sourceId)c.hidden=true;else next.components=next.components.filter(item=>item.id!==c.id);selected=null;commit(next,'Component removed. Undo restores it.');};
  function step(action) { if(action==='undo')history.undo();else history.redo();render(true);onChange?.(); }
  $('#edit-undo').onclick=()=>step('undo');$('#edit-redo').onclick=()=>step('redo');
  let floorEditing=null;
  function showFloor(settings) {const state=history.state;floorEditing=settings?activeFloor:null;const f=state.floors.find(f=>f.id===floorEditing),source=f&&f.id==='main';$('#edit-floor-title').textContent=settings?'Floor settings.':'Add a floor.';$('#edit-floor-name').value=f?.name||`Floor ${state.floors.length+1}`;$('#edit-floor-elevation').value=f?.elevation||Math.max(...state.floors.map(f=>f.elevation))+10;if(f)$('#edit-floor-elevation').value=f.elevation;$('#edit-floor-elevation').disabled=!!source;$('#edit-perimeter-label').hidden=!!settings;$('#edit-floor-delete').hidden=!settings||source;$('#edit-floor-submit').textContent=settings?'Save floor':'Add floor';$('#edit-floor-description').textContent=settings?(source?'The ground floor stays at elevation zero.':'Changing the elevation moves all components on this floor in whole-building view.'):'Starts with a rectangular slab matching the generic 20 × 20 ft template. Openings and rooms are not copied.';$('#edit-floor-error').textContent='';floorDialog.showModal();}
  $('#edit-add-floor').onclick=()=>showFloor(false);$('#edit-floor-settings').onclick=()=>showFloor(true);$('#edit-floor-close').onclick=()=>floorDialog.close();
  $('#edit-floor-form').onsubmit=e=>{e.preventDefault();const next=history.state,name=$('#edit-floor-name').value.trim(),elevation=Number($('#edit-floor-elevation').value);try {if(floorEditing){Object.assign(next.floors.find(f=>f.id===floorEditing),{name,elevation});}else{const added=addFloor(next,name,elevation,$('#edit-perimeter').checked);activeFloor=added.floor.id;selected=added.slab.id;}validateState(next,baseline);floorDialog.close();commit(next,floorEditing?'Floor updated.':'Floor added. Adjust the slab and wall panels to suit your concept.');setView('exterior');model.home();}catch(error){$('#edit-floor-error').textContent=error.message;}};
  $('#edit-floor-delete').onclick=()=>{const floor=history.state.floors.find(f=>f.id===floorEditing);floorDialog.close();confirm('Remove this floor?',`This removes ${floor.name} and all of its components. You can undo this change.`,()=>{const next=history.state;next.floors=next.floors.filter(f=>f.id!==floor.id);next.components=next.components.filter(c=>c.floor!==floor.id);activeFloor='main';selected=null;commit(next,'Floor removed.');setView('exterior');});};
  $('#edit-reset').onclick=()=>confirm('Clear this concept?','This clears added floors and components and restores the empty workspace. You can undo this change or export your design first.',()=>{selected=null;activeFloor='main';commit(initialState(baseline),'Empty workspace restored.');setView('exterior');});
  $('#edit-export').onclick=()=>{const blob=new Blob([JSON.stringify(history.state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fraaime-public-design.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Design exported. Import it in this editor on another browser.');};
  $('#edit-import').onclick=()=>$('#edit-import-file').click();
  $('#edit-import-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Choose a concept JSON smaller than 2 MB.');const next=validateState(JSON.parse(await file.text()),baseline);confirm('Import this design?',`Replace the current concept with ${next.floors.length} floors and ${next.components.filter(c=>!c.hidden).length} components? This is undoable.`,()=>{selected=null;activeFloor='main';commit(next,'Design imported.');setView('exterior');});}catch(error){toast(`Import failed: ${error.message}`);}};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&placing)setPlacing(false);if(!enabled||document.querySelector('dialog[open]')||e.target.closest('input,select,textarea,[contenteditable]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();step(e.shiftKey?'redo':'undo');}});
  render();$('#edit-save-status').textContent=loadError?'Saved design could not be loaded. Empty workspace shown; invalid saved data has not been overwritten.':'● Browser-local design · export to share or back up';
  return { open(){toggleMode(true);} };
}
