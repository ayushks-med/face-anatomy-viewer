const $ = (s) => document.querySelector(s);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
}

export function buildUI(viewer, config) {
  $('#title').textContent = config.title ?? 'Anatomy';
  buildLayers(viewer);
  buildPeel(viewer, config);
  buildInfo(viewer);
  buildSearch(viewer);
  buildHover(viewer);

  $('#reset-view').addEventListener('click', () => viewer.resetView());
  const showAll = $('#show-all');
  showAll.addEventListener('click', () => viewer.showAllParts());
  viewer.onChange = () => {
    const n = viewer.hiddenCount();
    showAll.hidden = n === 0;
    showAll.textContent = `Show ${n} hidden`;
    // keep controls in sync (picking from search can turn a layer on / change peel)
    for (const layer of viewer.layers.values()) if (layer.ui) layer.ui.check.checked = layer.visible;
    const peel = $('#peel');
    if (Math.round(peel.value) !== Math.round(viewer.peel * 100)) {
      peel.value = String(viewer.peel * 100);
      peel.dispatchEvent(new Event('input'));
    }
  };
  viewer.onChange();

  const credits = Object.values(config.sources ?? {}).map((s) => `${s.label} · ${s.licence}`);
  $('#credit').textContent = credits.join('  |  ');
}

function buildLayers(viewer) {
  const list = $('#layer-list');
  for (const [id, layer] of viewer.layers) {
    if (!layer.meshes.length) continue;
    const check = el('input', { type: 'checkbox', checked: layer.visible, title: 'Show / hide layer' });
    const slider = el('input', { type: 'range', min: 0, max: 100, value: Math.round(layer.opacity * 100), title: 'Opacity' });
    const value = el('span', { className: 'muted small num' }, `${slider.value}%`);
    check.addEventListener('change', () => viewer.setLayerVisible(id, check.checked));
    slider.addEventListener('input', () => {
      value.textContent = `${slider.value}%`;
      viewer.setLayerOpacity(id, slider.value / 100);
    });
    layer.ui = { check };
    list.append(
      el('li', {},
        el('label', { className: 'row' },
          check,
          el('span', { className: 'swatch', style: `background:${layer.def.color}` }),
          el('span', { className: 'grow' }, layer.def.label),
          el('span', { className: 'muted small' }, String(layer.meshes.length))),
        el('div', { className: 'row' }, slider, value))
    );
  }
}

function buildPeel(viewer, config) {
  const stages = config.peel ?? [];
  const labels = config.peelLabels ?? [...stages, 'Bone'];
  const input = $('#peel');
  input.max = String(stages.length * 100);
  const ticks = $('#peel-ticks');
  labels.forEach((l) => ticks.append(el('span', {}, l)));
  const stage = $('#peel-stage');
  const update = () => {
    const v = input.value / 100;
    viewer.setPeel(v);
    stage.textContent = labels[Math.round(v)] ?? '';
  };
  input.addEventListener('input', update);
  ticks.querySelectorAll('span').forEach((s, i) =>
    s.addEventListener('click', () => {
      input.value = String(i * 100);
      update();
    })
  );
}

function buildInfo(viewer) {
  const panel = $('#info');
  let current = null;
  const render = (d) => {
    current = d;
    panel.hidden = !d;
    if (!d) return;
    $('#info-name').textContent = d.name;
    $('#info-layer').textContent = d.layerLabel;
    $('#info-swatch').style.background = d.color;
    $('#info-desc').textContent = d.description || 'No description yet. Add one in models/parts/head.json.';
    $('#info-desc').classList.toggle('muted', !d.description);
    $('#btn-isolate').textContent = viewer.isolatedId === d.id ? 'Exit isolate' : 'Isolate';
    const text = d.description && d.descriptionSource === 'wikipedia' ? ' · Text: Wikipedia (CC BY-SA 3.0)' : '';
    $('#info-source').textContent = d.source ? `Model: ${d.source.label} (${d.source.licence})${text}` : '';
  };
  viewer.onSelect = render;
  $('#info-close').addEventListener('click', () => viewer.select(null));
  $('#btn-hide').addEventListener('click', () => current && viewer.hidePart(current.id));
  $('#btn-isolate').addEventListener('click', () => {
    if (!current) return;
    viewer.isolate(current.id);
    render(current);
  });
  $('#btn-focus').addEventListener('click', () => current && viewer.focus(current.id));
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (viewer.isolatedId) viewer.isolate(viewer.isolatedId);
      viewer.select(null);
    }
    if ((e.key === 'h' || e.key === 'H') && current) viewer.hidePart(current.id);
  });
}

function buildSearch(viewer) {
  const input = $('#search');
  const results = $('#search-results');
  input.addEventListener('input', () => {
    results.replaceChildren(
      ...viewer.searchParts(input.value).map((r) =>
        el('li', { onclick: () => viewer.selectById(r.id) },
          el('span', {}, r.name), el('span', { className: 'muted small' }, r.layer))
      )
    );
  });
}

function buildHover(viewer) {
  const tip = $('#hover-label');
  viewer.onHover = (name, x, y) => {
    tip.hidden = !name;
    if (!name) return;
    tip.textContent = name;
    tip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  };
}
