/* ui/keys.js — keyboard shortcuts.

   All bindings are ignored while the user is typing in a field, inside a
   dialog, or when a modifier combination would collide with the browser.
*/

import { select } from './tabs.js';
import { mediaBus } from './mediaBus.js';
import { state, setTime, updateSetting } from '../core/store.js';
import log from '../core/log.js';

const isTyping = (e) => {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
};

export function initKeys({ getPlayer } = {}) {
  const player = getPlayer?.();
  const seek = (d) => {
    if (!state.scene) return;
    player?.seek(state.time + d);
  };

  addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (document.querySelector('dialog[open]')) {
      if (e.key === 'Escape') return;          // let <dialog> close itself
      return;
    }

    const k = e.key;
    let handled = true;

    switch (k) {
      case ' ':
      case 'Spacebar':
        player?.toggle();
        break;
      case 'ArrowLeft':
        seek(e.shiftKey ? -1000 : -100);
        break;
      case 'ArrowRight':
        seek(e.shiftKey ? 1000 : 100);
        break;
      case 'Home':
        player?.seek(0);
        break;
      case 'End':
        player?.seek(state.scene?.duration || 0);
        break;
      case 'b': case 'B':
        $('#tlMark')?.click();
        break;
      case ',': case '<':
        $('#tlMarkPrev')?.click();
        break;
      case '.': case '>':
        $('#tlMarkNext')?.click();
        break;
      case 'l': case 'L':
        updateSetting('debug', !state.debug);
        break;
      case 'f': case 'F':
        $('#tlFit')?.click();
        break;
      case 'k': case 'K':
        $('#inMedia')?.click();
        break;
      case '?':
        $('#dlgSettings')?.showModal();
        break;
      case '1': case '2': case '3': case '4': case '5': {
        const names = ['proyek', 'media', 'audio', 'layer', 'ekspor'];
        select(names[Number(k) - 1]);
        break;
      }
      default:
        handled = false;
    }

    if (handled) e.preventDefault();
  });

  // Re-attach a global drop target for media even when no preset is open.
  document.addEventListener('am:gallery', (e) => mediaBus.importFiles(e.detail));

  log.ok('Pintasan papan tik aktif.');
}
