import { createModel } from './model.js';
import { mountEditor } from './editor.js';

const $ = selector => document.querySelector(selector);
let toastTimer;
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
try {
  const model = createModel($('#model'));
  $('.model-loading').remove();
  function setView(value) { model.setView(value); }
  document.querySelectorAll('[data-look]').forEach(button => button.onclick = () => {
    model.setRepresentation(button.dataset.look);
    document.querySelectorAll('[data-look]').forEach(other => {
      other.classList.toggle('selected', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    });
  });
  $('#whole-view').onclick = () => setView('exterior');
  $('#top-view').onclick = () => model.top(); $('#reset-view').onclick = () => model.home();
  $('#zoom-in').onclick = () => model.zoom(.85); $('#zoom-out').onclick = () => model.zoom(1.18);
  mountEditor(model, { setView, toast }).open();
} catch (error) {
  console.error(error);
  $('#model').textContent = 'The model editor needs WebGL. Try a browser with hardware acceleration enabled.';
}
$('#model-help').onclick = () => $('#help').showModal();
$('#close-help').onclick = () => $('#help').close();
