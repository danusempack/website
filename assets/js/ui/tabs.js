/* ui/tabs.js — five-tab panel switcher.

   Keyboard: ArrowLeft/Right and Home/End move between tabs (WAI-ARIA tabs
   pattern with manual activation, which suits panels that can be expensive).
*/

import { $, $$ } from '../core/util.js';
import { on, EV } from '../core/bus.js';
import { state } from '../core/store.js';

const ORDER = ['proyek', 'media', 'audio', 'layer', 'ekspor'];
let current = 'proyek';

const paneOf = (name) => $('#pane-' + name);

export function select(name, { focus = false } = {}) {
  if (!ORDER.includes(name)) name = 'proyek';
  current = name;

  for (const btn of $$('#tabbar .tabbtn')) {
    const on_ = btn.dataset.tab === name;
    btn.setAttribute('aria-selected', String(on_));
    btn.tabIndex = on_ ? 0 : -1;
    btn.classList.toggle('on', on_);
    const pane = paneOf(btn.dataset.tab);
    pane.hidden = !on_;
    pane.toggleAttribute('data-active', on_);
  }

  // Desktop moves the Layer pane into the bottom dock instead of the sidebar.
  const dock = $('#dock');
  const layerPane = paneOf('layer');
  if (dock) {
    if (name === 'layer' && matchMedia('(min-width: 1080px)').matches) {
      if (layerPane.parentElement !== dock) dock.append(layerPane);
    } else if (layerPane.parentElement !== $('#panes')) {
      $('#panes').append(layerPane);
    }
  }

  if (focus) $(`#tb-${name}`)?.focus();
  return name;
}

export const currentTab = () => current;

export function initTabs() {
  const bar = $('#tabbar');

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tabbtn');
    if (btn) select(btn.dataset.tab);
  });

  bar.addEventListener('keydown', (e) => {
    const i = ORDER.indexOf(current);
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % ORDER.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ORDER.length) % ORDER.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ORDER.length - 1;
    if (next == null) return;
    e.preventDefault();
    select(ORDER[next], { focus: true });
  });

  // Keep the dock placement correct when the viewport crosses the breakpoint.
  matchMedia('(min-width: 1080px)').addEventListener('change', () => select(current));

  on(EV.PRESET_CLEARED, () => state.selLayer = null);
}
