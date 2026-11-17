const key = 'tokei:appearance:v1';
const sizes = {small: 0.875, normal: 1, large: 1.125};
const root = document.documentElement;
const toggle = document.querySelector('#appearance-toggle');
const panel = document.querySelector('#appearance-panel');
const saturation = document.querySelector('#color-saturation');
const output = document.querySelector('#saturation-value');
const fontSize = document.querySelector('#font-size');

function readSettings() {
  try {return JSON.parse(localStorage.getItem(key)) || {};}
  catch {return {};}
}

function applySettings(settings) {
  const color = Number.isFinite(settings?.saturation) ? Math.max(0, Math.min(100, settings.saturation)) : 100;
  const size = Object.hasOwn(sizes, settings?.fontSize) ? settings.fontSize : 'normal';
  root.style.setProperty('--color-saturation', color / 100);
  root.style.setProperty('--font-scale', sizes[size]);
  saturation.value = color;
  output.value = color === 0 ? 'Mono' : `${color}%`;
  saturation.setAttribute('aria-valuetext', color === 0 ? 'Monochrome' : `${color}%`);
  fontSize.value = size;
}

function saveSettings() {
  const settings = {saturation: Number(saturation.value), fontSize: fontSize.value};
  applySettings(settings);
  try {localStorage.setItem(key, JSON.stringify(settings));} catch {}
}

applySettings(readSettings());
saturation.addEventListener('input', saveSettings);
fontSize.addEventListener('change', saveSettings);
toggle.addEventListener('click', () => {
  const open = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
});
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) applySettings(readSettings());
});
