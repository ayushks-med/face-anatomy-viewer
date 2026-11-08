import { Viewer } from './viewer.js';
import { buildUI } from './ui.js';

const BASE = import.meta.env.BASE_URL; // models/ is Vite's publicDir -> served at BASE

async function fetchJSON(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Later parts files override earlier ones field by field. Missing files are skipped. */
async function loadParts(files = []) {
  const merged = {};
  for (const f of files) {
    try {
      const data = await fetchJSON(f);
      for (const [id, entry] of Object.entries(data)) {
        if (id.startsWith('_')) continue;
        merged[id] = { ...merged[id], ...entry };
      }
    } catch (e) {
      console.warn(`parts file skipped: ${e.message}`);
    }
  }
  return merged;
}

async function main() {
  const config = await fetchJSON('models.json');
  const parts = await loadParts(config.partsFiles);
  document.title = config.title ?? document.title;

  const viewer = new Viewer(document.getElementById('viewport'), config, parts);
  const bar = document.querySelector('#loading .bar span');
  await viewer.load(BASE, (p) => (bar.style.width = `${Math.round(p * 100)}%`));
  document.getElementById('loading').remove();

  buildUI(viewer, config);
  if (viewer.failed.length) alert(`Some models failed to load:\n${viewer.failed.join('\n')}`);
  window.viewer = viewer; // handy for debugging in the console
}

main().catch((e) => {
  console.error(e);
  document.querySelector('#loading p').textContent = `Failed to start: ${e.message}`;
});
