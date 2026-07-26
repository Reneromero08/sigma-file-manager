import {
  analysisMap,
  createWaveformSvg,
  enrichAssetsWithAudio,
  formatDuration,
  formatSampleRate,
} from './audio-ui.js';

const MEDIA_FILTERS = [
  ['all', 'All'],
  ['audio', 'Audio'],
  ['image', 'Images'],
  ['design', 'Design'],
  ['project', 'Projects'],
  ['video', 'Video'],
  ['document', 'Documents'],
  ['font', 'Fonts'],
  ['archive', 'Archives'],
  ['code', 'Code'],
  ['other', 'Other'],
];

const KIND_GLYPHS = {
  audio: '◒',
  image: '◇',
  design: '◆',
  project: '⬡',
  video: '▶',
  document: '▤',
  font: 'Aa',
  archive: '▣',
  code: '</>',
  other: '·',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return 'Unknown';
  const date = new Date(value > 10_000_000_000_000 ? value / 1_000_000 : value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function normalizeCollectionAsset(item) {
  return {
    id: item.assetId,
    canonicalName: item.canonicalName,
    mediaKind: item.mediaKind,
    primaryPath: item.primaryPath ?? null,
    isOnline: Boolean(item.primaryPath),
    sizeBytes: null,
    modifiedAtNs: null,
    position: item.position,
    sectionName: item.sectionName ?? null,
    note: item.note ?? null,
  };
}

function debounce(callback, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function installStyles(container) {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    button, input, select { font: inherit; }

    .ul-shell {
      --ul-bg: hsl(222 18% 9%);
      --ul-panel: hsl(222 17% 12%);
      --ul-panel-2: hsl(222 16% 15%);
      --ul-border: hsl(220 14% 24%);
      --ul-text: hsl(210 20% 95%);
      --ul-muted: hsl(215 12% 62%);
      --ul-accent: hsl(267 90% 70%);
      --ul-accent-soft: hsl(267 70% 55% / 0.18);
      --ul-positive: hsl(158 72% 56%);
      --ul-danger: hsl(2 80% 64%);

      display: grid;
      width: 100%;
      height: 100%;
      min-width: 0;
      grid-template-columns: 230px minmax(0, 1fr) 300px;
      color: var(--ul-text);
      background:
        radial-gradient(circle at 34% -10%, hsl(267 60% 30% / 0.18), transparent 38%),
        var(--ul-bg);
    }

    .ul-sidebar, .ul-inspector {
      min-height: 0;
      background: hsl(222 17% 11% / 0.94);
      backdrop-filter: blur(16px);
    }

    .ul-sidebar {
      overflow-y: auto;
      padding: 20px 14px;
      border-right: 1px solid var(--ul-border);
    }

    .ul-brand {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 0 8px 20px;
    }

    .ul-brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid hsl(267 80% 72% / 0.45);
      border-radius: 10px;
      color: white;
      background: linear-gradient(145deg, hsl(267 86% 66%), hsl(230 75% 57%));
      box-shadow: 0 8px 28px hsl(267 72% 45% / 0.25);
      font-size: 17px;
      font-weight: 800;
    }

    .ul-brand-copy strong { display: block; font-size: 14px; letter-spacing: 0.01em; }
    .ul-brand-copy span { color: var(--ul-muted); font-size: 11px; }

    .ul-section { margin-top: 18px; }
    .ul-section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px 8px;
      color: var(--ul-muted);
      font-size: 10px;
      font-weight: 750;
      letter-spacing: 0.13em;
      text-transform: uppercase;
    }

    .ul-sidebar-list { display: grid; gap: 3px; }
    .ul-nav-button {
      display: flex;
      width: 100%;
      min-width: 0;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: 9px;
      color: var(--ul-muted);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .ul-nav-button:hover { color: var(--ul-text); background: hsl(220 15% 20% / 0.62); }
    .ul-nav-button.is-active {
      border-color: hsl(267 72% 65% / 0.35);
      color: var(--ul-text);
      background: var(--ul-accent-soft);
    }

    .ul-nav-icon { width: 18px; color: var(--ul-accent); text-align: center; font-weight: 800; }
    .ul-nav-label { overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; }
    .ul-nav-count { color: var(--ul-muted); font-size: 10px; }

    .ul-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px; }
    .ul-tag-chip {
      max-width: 100%;
      overflow: hidden;
      padding: 5px 8px;
      border: 1px solid var(--ul-border);
      border-radius: 999px;
      color: var(--ul-muted);
      background: hsl(220 16% 16%);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ul-main { display: flex; overflow: hidden; min-width: 0; min-height: 0; flex-direction: column; }
    .ul-main-header { padding: 22px 24px 14px; }
    .ul-title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .ul-eyebrow { color: var(--ul-accent); font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
    .ul-title { margin: 4px 0 0; font-size: 25px; font-weight: 760; letter-spacing: -0.035em; }
    .ul-status { display: flex; align-items: center; gap: 7px; color: var(--ul-muted); font-size: 11px; }
    .ul-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ul-positive); box-shadow: 0 0 12px var(--ul-positive); }
    .ul-status-dot.is-error { background: var(--ul-danger); box-shadow: 0 0 12px var(--ul-danger); }

    .ul-stats { display: grid; margin-top: 18px; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
    .ul-stat {
      padding: 12px 13px;
      border: 1px solid var(--ul-border);
      border-radius: 11px;
      background: linear-gradient(150deg, hsl(220 16% 17% / 0.92), hsl(220 15% 13% / 0.82));
    }
    .ul-stat-label { color: var(--ul-muted); font-size: 10px; }
    .ul-stat-value { margin-top: 4px; font-size: 18px; font-weight: 750; letter-spacing: -0.03em; }

    .ul-controls { display: flex; align-items: center; gap: 9px; padding: 0 24px 14px; }
    .ul-search-wrap { position: relative; min-width: 180px; flex: 1; }
    .ul-search {
      width: 100%;
      height: 38px;
      padding: 0 36px 0 13px;
      border: 1px solid var(--ul-border);
      border-radius: 10px;
      outline: none;
      color: var(--ul-text);
      background: hsl(220 16% 14% / 0.9);
    }
    .ul-search:focus { border-color: hsl(267 72% 65% / 0.65); box-shadow: 0 0 0 3px var(--ul-accent-soft); }
    .ul-search-shortcut { position: absolute; top: 9px; right: 10px; color: var(--ul-muted); font-size: 10px; }
    .ul-select, .ul-toggle {
      height: 38px;
      border: 1px solid var(--ul-border);
      border-radius: 10px;
      color: var(--ul-text);
      background: hsl(220 16% 14% / 0.9);
    }
    .ul-select { padding: 0 30px 0 11px; }
    .ul-toggle { display: flex; align-items: center; gap: 7px; padding: 0 11px; cursor: pointer; }
    .ul-toggle input { accent-color: var(--ul-accent); }

    .ul-content { overflow-y: auto; min-height: 0; flex: 1; padding: 0 24px 28px; }
    .ul-content-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 0 12px; }
    .ul-result-label { color: var(--ul-muted); font-size: 11px; }
    .ul-result-label strong { color: var(--ul-text); }

    .ul-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 11px; }
    .ul-grid.is-compact { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
    .ul-asset-card {
      position: relative;
      overflow: hidden;
      min-width: 0;
      padding: 0;
      border: 1px solid var(--ul-border);
      border-radius: 12px;
      color: inherit;
      background: var(--ul-panel);
      text-align: left;
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    }
    .ul-asset-card:hover { border-color: hsl(267 72% 65% / 0.48); transform: translateY(-1px); }
    .ul-asset-card.is-selected { border-color: var(--ul-accent); box-shadow: 0 0 0 2px var(--ul-accent-soft); }
    .ul-asset-preview {
      position: relative;
      display: grid;
      height: 112px;
      place-items: center;
      background:
        linear-gradient(145deg, hsl(267 55% 28% / 0.28), transparent 55%),
        repeating-linear-gradient(45deg, hsl(220 15% 17%), hsl(220 15% 17%) 10px, hsl(220 15% 15%) 10px, hsl(220 15% 15%) 20px);
    }
    .ul-grid.is-compact .ul-asset-preview { height: 82px; }
    .ul-kind-glyph { color: hsl(267 90% 80%); font-size: 29px; font-weight: 750; text-shadow: 0 8px 22px hsl(267 80% 55% / 0.4); }
    .ul-waveform { width: calc(100% - 18px); height: 62px; overflow: visible; }
    .ul-waveform path { fill: hsl(267 88% 72% / 0.78); filter: drop-shadow(0 5px 12px hsl(267 80% 45% / 0.35)); }
    .ul-inspector-waveform { width: calc(100% - 28px); height: 92px; overflow: visible; }
    .ul-inspector-waveform path { fill: hsl(267 90% 76% / 0.82); filter: drop-shadow(0 8px 18px hsl(267 80% 45% / 0.4)); }
    .ul-audio-facts { display: flex; align-items: center; gap: 5px; overflow: hidden; }
    .ul-audio-fact { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ul-audio-fact + .ul-audio-fact::before { margin-right: 5px; color: var(--ul-border); content: '·'; }
    .ul-offline-badge { position: absolute; top: 8px; right: 8px; padding: 3px 6px; border-radius: 999px; color: hsl(3 90% 80%); background: hsl(3 65% 25% / 0.75); font-size: 8px; text-transform: uppercase; }
    .ul-asset-body { padding: 10px 11px 11px; }
    .ul-asset-name { overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .ul-asset-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 5px; color: var(--ul-muted); font-size: 9px; }
    .ul-kind-label { overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; white-space: nowrap; }

    .ul-empty, .ul-error, .ul-loading { display: grid; min-height: 250px; place-items: center; text-align: center; }
    .ul-empty-card { max-width: 420px; padding: 28px; border: 1px dashed var(--ul-border); border-radius: 14px; color: var(--ul-muted); }
    .ul-empty-card strong { display: block; margin-bottom: 7px; color: var(--ul-text); font-size: 14px; }
    .ul-spinner { width: 28px; height: 28px; border: 2px solid var(--ul-border); border-top-color: var(--ul-accent); border-radius: 50%; animation: ul-spin 0.8s linear infinite; }
    @keyframes ul-spin { to { transform: rotate(360deg); } }

    .ul-inspector {
      overflow-y: auto;
      padding: 20px;
      border-left: 1px solid var(--ul-border);
    }
    .ul-inspector-empty { display: grid; height: 100%; place-items: center; color: var(--ul-muted); text-align: center; }
    .ul-inspector-hero {
      display: grid;
      height: 170px;
      place-items: center;
      border: 1px solid var(--ul-border);
      border-radius: 14px;
      background:
        radial-gradient(circle at 50% 25%, hsl(267 75% 55% / 0.25), transparent 50%),
        var(--ul-panel-2);
    }
    .ul-inspector-hero .ul-kind-glyph { font-size: 44px; }
    .ul-inspector h2 { overflow-wrap: anywhere; margin: 16px 0 4px; font-size: 16px; line-height: 1.3; }
    .ul-inspector-path { overflow-wrap: anywhere; color: var(--ul-muted); font-size: 10px; line-height: 1.45; }
    .ul-inspector-actions { display: grid; margin-top: 16px; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ul-button {
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid var(--ul-border);
      border-radius: 9px;
      color: var(--ul-text);
      background: var(--ul-panel-2);
      cursor: pointer;
    }
    .ul-button:hover { border-color: hsl(267 72% 65% / 0.55); }
    .ul-button.is-primary { border-color: hsl(267 72% 65% / 0.55); background: hsl(267 62% 48%); }
    .ul-button:disabled { opacity: 0.45; cursor: not-allowed; }
    .ul-detail-list { display: grid; margin-top: 18px; gap: 1px; }
    .ul-detail-row { display: grid; padding: 9px 0; border-bottom: 1px solid var(--ul-border); grid-template-columns: 84px minmax(0, 1fr); gap: 8px; font-size: 10px; }
    .ul-detail-label { color: var(--ul-muted); }
    .ul-detail-value { overflow-wrap: anywhere; text-align: right; }

    .ul-modal-backdrop {
      position: fixed;
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
      background: hsl(220 30% 4% / 0.72);
      backdrop-filter: blur(8px);
      inset: 0;
    }
    .ul-modal-backdrop.is-open { display: flex; }
    .ul-modal { width: min(420px, calc(100% - 32px)); padding: 20px; border: 1px solid var(--ul-border); border-radius: 14px; background: var(--ul-panel); box-shadow: 0 28px 80px hsl(220 40% 2% / 0.55); }
    .ul-modal h3 { margin: 0; font-size: 15px; }
    .ul-modal p { margin: 7px 0 16px; color: var(--ul-muted); font-size: 11px; line-height: 1.5; }
    .ul-modal-field { display: grid; gap: 6px; }
    .ul-modal-field label { color: var(--ul-muted); font-size: 10px; }
    .ul-modal-input { width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--ul-border); border-radius: 9px; outline: none; color: var(--ul-text); background: hsl(220 17% 10%); }
    .ul-modal-input:focus { border-color: var(--ul-accent); }
    .ul-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }

    @media (max-width: 1050px) {
      .ul-shell { grid-template-columns: 200px minmax(0, 1fr); }
      .ul-inspector { display: none; }
    }
    @media (max-width: 720px) {
      .ul-shell { grid-template-columns: 1fr; }
      .ul-sidebar { display: none; }
      .ul-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ul-controls { flex-wrap: wrap; }
      .ul-search-wrap { flex-basis: 100%; }
    }
  `;
  container.append(style);
}

function buildShell(container) {
  const shell = element('div', 'ul-shell');
  shell.innerHTML = `
    <aside class="ul-sidebar">
      <div class="ul-brand">
        <div class="ul-brand-mark">U</div>
        <div class="ul-brand-copy"><strong>Universal Library</strong><span>Machine-wide creative memory</span></div>
      </div>
      <section class="ul-section">
        <div class="ul-section-title"><span>Library</span></div>
        <div class="ul-sidebar-list" data-role="media-nav"></div>
      </section>
      <section class="ul-section">
        <div class="ul-section-title"><span>Collections</span><button class="ul-button" data-action="new-collection" aria-label="New collection">+</button></div>
        <div class="ul-sidebar-list" data-role="collections"></div>
      </section>
      <section class="ul-section">
        <div class="ul-section-title"><span>Tags</span></div>
        <div class="ul-tags" data-role="tags"></div>
      </section>
    </aside>
    <main class="ul-main">
      <header class="ul-main-header">
        <div class="ul-title-row">
          <div><div class="ul-eyebrow">Indexed workspace</div><h1 class="ul-title" data-role="title">All assets</h1></div>
          <div class="ul-status"><span class="ul-status-dot" data-role="status-dot"></span><span data-role="status">Connecting</span></div>
        </div>
        <div class="ul-stats">
          <div class="ul-stat"><div class="ul-stat-label">Visible assets</div><div class="ul-stat-value" data-stat="assets">0</div></div>
          <div class="ul-stat"><div class="ul-stat-label">Library roots</div><div class="ul-stat-value" data-stat="roots">0</div></div>
          <div class="ul-stat"><div class="ul-stat-label">Collections</div><div class="ul-stat-value" data-stat="collections">0</div></div>
          <div class="ul-stat"><div class="ul-stat-label">Tags</div><div class="ul-stat-value" data-stat="tags">0</div></div>
        </div>
      </header>
      <div class="ul-controls">
        <div class="ul-search-wrap"><input class="ul-search" data-role="search" placeholder="Search names and paths"><span class="ul-search-shortcut">/</span></div>
        <select class="ul-select" data-role="kind"></select>
        <label class="ul-toggle"><input type="checkbox" data-role="offline"> Offline</label>
      </div>
      <div class="ul-content">
        <div class="ul-content-head"><div class="ul-result-label" data-role="result-label"></div></div>
        <div data-role="content"></div>
      </div>
    </main>
    <aside class="ul-inspector" data-role="inspector"></aside>
    <div class="ul-modal-backdrop" data-role="modal-backdrop">
      <div class="ul-modal" role="dialog" aria-modal="true">
        <h3 data-role="modal-title"></h3>
        <p data-role="modal-description"></p>
        <div data-role="modal-fields"></div>
        <div class="ul-modal-actions"><button class="ul-button" data-action="modal-cancel">Cancel</button><button class="ul-button is-primary" data-action="modal-save">Save</button></div>
      </div>
    </div>
  `;
  container.append(shell);
  return shell;
}

export async function mount(container, context) {
  const { sigma, toolbarContainer } = context;
  container.replaceChildren();
  installStyles(container);
  const shell = buildShell(container);

  const state = {
    snapshot: null,
    assets: [],
    audioByAsset: new Map(),
    selectedAssetId: null,
    query: '',
    kind: 'all',
    includeOffline: true,
    activeCollectionId: null,
    loading: false,
    error: null,
    compact: await sigma.storage.get('workspace.compact') === true,
    modalMode: null,
  };

  const refs = {
    mediaNav: shell.querySelector('[data-role="media-nav"]'),
    collections: shell.querySelector('[data-role="collections"]'),
    tags: shell.querySelector('[data-role="tags"]'),
    title: shell.querySelector('[data-role="title"]'),
    status: shell.querySelector('[data-role="status"]'),
    statusDot: shell.querySelector('[data-role="status-dot"]'),
    search: shell.querySelector('[data-role="search"]'),
    kind: shell.querySelector('[data-role="kind"]'),
    offline: shell.querySelector('[data-role="offline"]'),
    content: shell.querySelector('[data-role="content"]'),
    resultLabel: shell.querySelector('[data-role="result-label"]'),
    inspector: shell.querySelector('[data-role="inspector"]'),
    modalBackdrop: shell.querySelector('[data-role="modal-backdrop"]'),
    modalTitle: shell.querySelector('[data-role="modal-title"]'),
    modalDescription: shell.querySelector('[data-role="modal-description"]'),
    modalFields: shell.querySelector('[data-role="modal-fields"]'),
  };

  for (const [value, label] of MEDIA_FILTERS) {
    const option = element('option', '', label);
    option.value = value;
    refs.kind.append(option);
  }
  refs.offline.checked = state.includeOffline;

  async function execute(request) {
    return sigma.commands.executeCommand('browse-assets', { workspace: true, ...request });
  }

  function currentAssets() {
    let assets = state.assets;
    const query = state.query.trim().toLocaleLowerCase();
    if (state.activeCollectionId && query) {
      assets = assets.filter((asset) => {
        return asset.canonicalName.toLocaleLowerCase().includes(query)
          || asset.primaryPath?.toLocaleLowerCase().includes(query);
      });
    }
    if (state.activeCollectionId && state.kind !== 'all') {
      assets = assets.filter(asset => asset.mediaKind === state.kind);
    }
    if (!state.includeOffline) {
      assets = assets.filter(asset => asset.isOnline);
    }
    return assets;
  }

  function selectedAsset() {
    return state.assets.find(asset => asset.id === state.selectedAssetId) ?? null;
  }

  function renderNavigation() {
    refs.mediaNav.replaceChildren();
    for (const [value, label] of MEDIA_FILTERS) {
      const button = element('button', `ul-nav-button${!state.activeCollectionId && state.kind === value ? ' is-active' : ''}`);
      button.type = 'button';
      button.dataset.kind = value;
      button.append(
        element('span', 'ul-nav-icon', KIND_GLYPHS[value] ?? '∞'),
        element('span', 'ul-nav-label', label),
      );
      refs.mediaNav.append(button);
    }

    refs.collections.replaceChildren();
    const all = element('button', `ul-nav-button${!state.activeCollectionId ? ' is-active' : ''}`);
    all.type = 'button';
    all.dataset.collection = '';
    all.append(element('span', 'ul-nav-icon', '∞'), element('span', 'ul-nav-label', 'All assets'));
    refs.collections.append(all);

    for (const collection of state.snapshot?.collections ?? []) {
      const button = element('button', `ul-nav-button${state.activeCollectionId === collection.id ? ' is-active' : ''}`);
      button.type = 'button';
      button.dataset.collection = collection.id;
      button.append(
        element('span', 'ul-nav-icon', '▱'),
        element('span', 'ul-nav-label', collection.name),
      );
      refs.collections.append(button);
    }

    refs.tags.replaceChildren();
    for (const tag of (state.snapshot?.tags ?? []).slice(0, 24)) {
      const chip = element('span', 'ul-tag-chip', `#${tag.name}`);
      if (tag.color) chip.style.borderColor = tag.color;
      refs.tags.append(chip);
    }
  }

  function renderStats() {
    const assets = currentAssets();
    shell.querySelector('[data-stat="assets"]').textContent = String(assets.length);
    shell.querySelector('[data-stat="roots"]').textContent = String(state.snapshot?.health?.rootCount ?? 0);
    shell.querySelector('[data-stat="collections"]').textContent = String(state.snapshot?.collections?.length ?? 0);
    shell.querySelector('[data-stat="tags"]').textContent = String(state.snapshot?.tags?.length ?? 0);
  }

  function renderInspector() {
    refs.inspector.replaceChildren();
    const asset = selectedAsset();
    if (!asset) {
      const empty = element('div', 'ul-inspector-empty');
      empty.append(element('div', '', 'Select an asset to inspect and organize it.'));
      refs.inspector.append(empty);
      return;
    }

    const hero = element('div', 'ul-inspector-hero');
    const inspectorWaveform = createWaveformSvg(
      document,
      asset.audioAnalysis,
      'ul-inspector-waveform',
    );
    hero.append(
      inspectorWaveform
      ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
    );
    const name = element('h2', '', asset.canonicalName);
    const path = element('div', 'ul-inspector-path', asset.primaryPath ?? 'No current file location');
    const actions = element('div', 'ul-inspector-actions');

    const copy = element('button', 'ul-button is-primary', 'Copy file');
    copy.type = 'button';
    copy.dataset.action = 'copy-asset';
    copy.disabled = !asset.primaryPath;
    const tag = element('button', 'ul-button', 'Add tag');
    tag.type = 'button';
    tag.dataset.action = 'tag-asset';
    tag.disabled = !asset.primaryPath;
    const collection = element('button', 'ul-button', 'Add to collection');
    collection.type = 'button';
    collection.dataset.action = 'collect-asset';
    collection.disabled = !asset.primaryPath || !(state.snapshot?.collections?.length);
    const analyze = element(
      'button',
      'ul-button',
      asset.audioAnalysis ? 'Refresh waveform' : 'Analyze audio',
    );
    analyze.type = 'button';
    analyze.dataset.action = 'analyze-audio';
    analyze.disabled = asset.mediaKind !== 'audio' || !asset.primaryPath;
    actions.append(copy, tag, collection, analyze);

    const details = element('div', 'ul-detail-list');
    const rows = [
      ['Type', asset.mediaKind],
      ['Size', formatBytes(asset.sizeBytes)],
      ['State', asset.isOnline ? 'Online' : 'Offline'],
      ['Modified', formatTimestamp(asset.modifiedAtNs)],
      ['Asset ID', asset.id],
    ];
    if (asset.audioAnalysis) {
      rows.splice(1, 0,
        ['Duration', formatDuration(asset.audioAnalysis.durationMs)],
        ['Sample rate', formatSampleRate(asset.audioAnalysis.sampleRateHz)],
        ['Channels', asset.audioAnalysis.channels],
        ['Peak', asset.audioAnalysis.peak.toFixed(3)],
        ['RMS', asset.audioAnalysis.rms.toFixed(3)],
      );
    }
    if (asset.sectionName) rows.splice(1, 0, ['Section', asset.sectionName]);
    if (asset.note) rows.splice(2, 0, ['Note', asset.note]);
    for (const [label, value] of rows) {
      const row = element('div', 'ul-detail-row');
      row.append(element('div', 'ul-detail-label', label), element('div', 'ul-detail-value', String(value)));
      details.append(row);
    }
    refs.inspector.append(hero, name, path, actions, details);
  }

  function renderAssets() {
    const assets = currentAssets();
    refs.content.replaceChildren();
    refs.resultLabel.replaceChildren();
    refs.resultLabel.append(element('strong', '', String(assets.length)), document.createTextNode(` result${assets.length === 1 ? '' : 's'}`));

    if (state.loading) {
      const loading = element('div', 'ul-loading');
      loading.append(element('div', 'ul-spinner'));
      refs.content.append(loading);
      return;
    }
    if (state.error) {
      const error = element('div', 'ul-error');
      const card = element('div', 'ul-empty-card');
      card.append(element('strong', '', 'Catalog unavailable'), element('div', '', state.error));
      error.append(card);
      refs.content.append(error);
      return;
    }
    if (!assets.length) {
      const empty = element('div', 'ul-empty');
      const card = element('div', 'ul-empty-card');
      card.append(
        element('strong', '', 'Nothing matches this view'),
        element('div', '', 'Index a folder, clear the search, or include offline assets.'),
      );
      empty.append(card);
      refs.content.append(empty);
      return;
    }

    if (!assets.some(asset => asset.id === state.selectedAssetId)) {
      state.selectedAssetId = assets[0].id;
    }

    const grid = element('div', `ul-grid${state.compact ? ' is-compact' : ''}`);
    for (const asset of assets) {
      const card = element('button', `ul-asset-card${state.selectedAssetId === asset.id ? ' is-selected' : ''}`);
      card.type = 'button';
      card.dataset.assetId = asset.id;
      const preview = element('div', 'ul-asset-preview');
      const waveform = createWaveformSvg(document, asset.audioAnalysis);
      preview.append(
        waveform ?? element('div', 'ul-kind-glyph', KIND_GLYPHS[asset.mediaKind] ?? '·'),
      );
      if (!asset.isOnline) preview.append(element('span', 'ul-offline-badge', 'offline'));
      const body = element('div', 'ul-asset-body');
      body.append(
        element('div', 'ul-asset-name', asset.canonicalName),
        (() => {
          const meta = element('div', 'ul-asset-meta');
          meta.append(element('span', 'ul-kind-label', asset.mediaKind));
          if (asset.audioAnalysis) {
            const audioFacts = element('span', 'ul-audio-facts');
            audioFacts.append(
              element('span', 'ul-audio-fact', formatDuration(asset.audioAnalysis.durationMs)),
              element('span', 'ul-audio-fact', formatSampleRate(asset.audioAnalysis.sampleRateHz)),
            );
            meta.append(audioFacts);
          }
          else {
            meta.append(element('span', '', asset.sizeBytes == null ? '' : formatBytes(asset.sizeBytes)));
          }
          return meta;
        })(),
      );
      card.append(preview, body);
      grid.append(card);
    }
    refs.content.append(grid);
  }

  function render() {
    refs.title.textContent = state.activeCollectionId
      ? state.snapshot?.collections?.find(item => item.id === state.activeCollectionId)?.name ?? 'Collection'
      : state.kind === 'all'
        ? 'All assets'
        : MEDIA_FILTERS.find(([value]) => value === state.kind)?.[1] ?? 'Assets';
    refs.status.textContent = state.error
      ? 'Catalog unavailable'
      : state.loading
        ? 'Synchronizing'
        : `Catalog online · schema ${state.snapshot?.health?.schemaVersion ?? '?'}`;
    refs.statusDot.classList.toggle('is-error', Boolean(state.error));
    refs.kind.value = state.kind;
    refs.offline.checked = state.includeOffline;
    renderNavigation();
    renderStats();
    renderAssets();
    renderInspector();
  }

  async function loadSnapshot() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const snapshot = await execute({
        action: 'snapshot',
        query: state.activeCollectionId ? '' : state.query,
        kind: state.activeCollectionId ? 'all' : state.kind,
        includeOffline: state.includeOffline,
        limit: 500,
      });
      state.snapshot = snapshot;
      state.audioByAsset = analysisMap(snapshot.audioAnalyses);
      if (!state.activeCollectionId) {
        state.assets = enrichAssetsWithAudio(snapshot.assets, state.audioByAsset);
      }
      state.error = null;
    }
    catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.assets = [];
    }
    finally {
      state.loading = false;
      render();
    }
  }

  async function loadCollection(collectionId) {
    if (!collectionId) {
      state.activeCollectionId = null;
      await loadSnapshot();
      return;
    }
    state.activeCollectionId = collectionId;
    state.loading = true;
    state.error = null;
    render();
    try {
      const items = await execute({ action: 'collection-items', collection: collectionId });
      state.assets = enrichAssetsWithAudio(
        items.map(normalizeCollectionAsset),
        state.audioByAsset,
      );
      state.error = null;
    }
    catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.assets = [];
    }
    finally {
      state.loading = false;
      render();
    }
  }

  function closeModal() {
    state.modalMode = null;
    refs.modalBackdrop.classList.remove('is-open');
    refs.modalFields.replaceChildren();
  }

  function openModal(mode) {
    const asset = selectedAsset();
    state.modalMode = mode;
    refs.modalFields.replaceChildren();
    refs.modalBackdrop.classList.add('is-open');

    if (mode === 'tag') {
      refs.modalTitle.textContent = 'Tag asset';
      refs.modalDescription.textContent = asset ? `Apply a reusable tag to ${asset.canonicalName}.` : '';
      const field = element('div', 'ul-modal-field');
      field.append(element('label', '', 'Tag name'));
      const input = element('input', 'ul-modal-input');
      input.dataset.modalValue = 'tag';
      input.placeholder = 'dark, favorite, client-ready…';
      field.append(input);
      refs.modalFields.append(field);
      requestAnimationFrame(() => input.focus());
      return;
    }

    if (mode === 'collection') {
      refs.modalTitle.textContent = 'Add to collection';
      refs.modalDescription.textContent = asset ? `Place ${asset.canonicalName} into an ordered mixed-media collection.` : '';
      const field = element('div', 'ul-modal-field');
      field.append(element('label', '', 'Collection'));
      const select = element('select', 'ul-modal-input');
      select.dataset.modalValue = 'collection';
      for (const collection of state.snapshot?.collections ?? []) {
        const option = element('option', '', collection.name);
        option.value = collection.id;
        select.append(option);
      }
      field.append(select);
      refs.modalFields.append(field);
      return;
    }

    refs.modalTitle.textContent = 'New collection';
    refs.modalDescription.textContent = 'Create a virtual playlist for any mix of files. Source files stay where they are.';
    const field = element('div', 'ul-modal-field');
    field.append(element('label', '', 'Collection name'));
    const input = element('input', 'ul-modal-input');
    input.dataset.modalValue = 'name';
    input.placeholder = 'Album 03, Brand System, Dark Percussion…';
    field.append(input);
    refs.modalFields.append(field);
    requestAnimationFrame(() => input.focus());
  }

  async function saveModal() {
    const mode = state.modalMode;
    const asset = selectedAsset();
    const input = refs.modalFields.querySelector('[data-modal-value]');
    const value = input?.value?.trim();
    if (!value) return;

    try {
      if (mode === 'tag' && asset?.primaryPath) {
        await execute({ action: 'tag-asset', asset: asset.primaryPath, tag: value });
        sigma.ui.showNotification({ title: 'Tag applied', description: `#${value} → ${asset.canonicalName}`, type: 'success' });
      }
      else if (mode === 'collection' && asset?.primaryPath) {
        await execute({ action: 'add-to-collection', asset: asset.primaryPath, collection: value });
        sigma.ui.showNotification({ title: 'Added to collection', description: asset.canonicalName, type: 'success' });
      }
      else if (mode === 'new-collection') {
        await execute({ action: 'create-collection', name: value });
        sigma.ui.showNotification({ title: 'Collection created', description: value, type: 'success' });
      }
      closeModal();
      await loadSnapshot();
    }
    catch (error) {
      sigma.ui.showNotification({
        title: 'Universal Library action failed',
        description: error instanceof Error ? error.message : String(error),
        type: 'error',
      });
    }
  }

  const reloadFromSearch = debounce(async () => {
    if (state.activeCollectionId) render();
    else await loadSnapshot();
  }, 220);

  refs.search.addEventListener('input', () => {
    state.query = refs.search.value;
    reloadFromSearch();
  });
  refs.kind.addEventListener('change', async () => {
    state.kind = refs.kind.value;
    if (state.activeCollectionId) render();
    else await loadSnapshot();
  });
  refs.offline.addEventListener('change', async () => {
    state.includeOffline = refs.offline.checked;
    if (state.activeCollectionId) render();
    else await loadSnapshot();
  });

  refs.mediaNav.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-kind]');
    if (!button) return;
    state.activeCollectionId = null;
    state.kind = button.dataset.kind;
    await loadSnapshot();
  });
  refs.collections.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-collection]');
    if (!button) return;
    await loadCollection(button.dataset.collection);
  });
  refs.content.addEventListener('click', (event) => {
    const card = event.target.closest('[data-asset-id]');
    if (!card) return;
    state.selectedAssetId = card.dataset.assetId;
    renderAssets();
    renderInspector();
  });
  refs.inspector.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const asset = selectedAsset();
    if (action === 'copy-asset' && asset?.primaryPath) {
      await sigma.ui.clipboardWriteFiles([asset.primaryPath], 'copy');
      sigma.ui.showNotification({ title: 'Copied for another application', description: asset.canonicalName, type: 'success' });
    }
    else if (action === 'tag-asset') openModal('tag');
    else if (action === 'collect-asset') openModal('collection');
    else if (action === 'analyze-audio' && asset?.primaryPath) {
      try {
        await execute({
          action: 'analyze-audio',
          asset: asset.primaryPath,
          points: 256,
        });
        sigma.ui.showNotification({
          title: 'Audio waveform analyzed',
          description: asset.canonicalName,
          type: 'success',
        });
        await loadSnapshot();
      }
      catch (error) {
        sigma.ui.showNotification({
          title: 'Audio analysis failed',
          description: error instanceof Error ? error.message : String(error),
          type: 'error',
        });
      }
    }
  });
  shell.querySelector('[data-action="new-collection"]').addEventListener('click', () => openModal('new-collection'));
  shell.querySelector('[data-action="modal-cancel"]').addEventListener('click', closeModal);
  shell.querySelector('[data-action="modal-save"]').addEventListener('click', saveModal);
  refs.modalBackdrop.addEventListener('click', (event) => {
    if (event.target === refs.modalBackdrop) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== refs.search) {
      event.preventDefault();
      refs.search.focus();
    }
    if (event.key === 'Escape' && state.modalMode) closeModal();
  });

  sigma.ui.renderToolbar(
    toolbarContainer,
    [
      sigma.ui.button({ id: 'refresh', label: 'Refresh', variant: 'secondary' }),
      sigma.ui.button({ id: 'index', label: 'Index folders', variant: 'primary' }),
      sigma.ui.button({ id: 'analyze-audio', label: 'Analyze audio', variant: 'secondary' }),
      sigma.ui.button({ id: 'configure', label: 'Catalog', variant: 'secondary' }),
      sigma.ui.button({ id: 'density', label: state.compact ? 'Comfortable' : 'Compact', variant: 'secondary' }),
    ],
    async (buttonId) => {
      if (buttonId === 'refresh') await loadSnapshot();
      if (buttonId === 'index') {
        await sigma.commands.executeCommand('scan-roots');
        await loadSnapshot();
      }
      if (buttonId === 'analyze-audio') {
        try {
          const report = await execute({
            action: 'analyze-missing-audio',
            limit: 500,
            points: 256,
          });
          sigma.ui.showNotification({
            title: 'Audio analysis complete',
            description: `${report.analyzed ?? 0} analyzed · ${report.issues?.length ?? 0} issue(s)`,
            type: report.issues?.length ? 'warning' : 'success',
          });
        }
        catch (error) {
          sigma.ui.showNotification({
            title: 'Audio analysis failed',
            description: error instanceof Error ? error.message : String(error),
            type: 'error',
          });
        }
        await loadSnapshot();
      }
      if (buttonId === 'configure') {
        await sigma.commands.executeCommand('catalog-health');
        await loadSnapshot();
      }
      if (buttonId === 'density') {
        state.compact = !state.compact;
        await sigma.storage.set('workspace.compact', state.compact);
        renderAssets();
      }
    },
  );

  await loadSnapshot();
}
