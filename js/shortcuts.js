/* Keyboard shortcuts, after SignMaker v2.2's remappable shortcuts (public/js/form.js,
   GPL-3.0): the same token format ("CTRL+SHIFT+Z", CTRL also meaning Cmd, "|"
   between alternatives), the same Keybinds mode (all, undo/redo only, none),
   and the same editing: click a field in Settings › Shortcuts and press the
   new keys; Backspace clears it. StripeMaker's actions stand in for
   SignMaker's: the number keys open the toolbar tools as SignMaker's open its
   menus, and Undo, Redo, Copy, Cut, Paste, Clear All, Zoom, Show/Hide Menus,
   Close Menu, and Dark Mode match. Kept in this browser like other settings. */
(() => {
  const KEY = 'stripemaker-shortcuts-v1';
  const app = window.StripeMaker ??= {};
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const click = id => () => document.getElementById(id)?.click();
  const tool = editor => () => document.querySelector(`#configBar [data-editor="${editor}"]`)?.click();
  const key = (code, ctrl = false, shift = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key: code, metaKey: ctrl && isMac, ctrlKey: ctrl && !isMac, shiftKey: shift, bubbles: true }));
  // [id, label, default keys, action]
  const SHORTCUTS = [
    ['Sheets', 'Sheets', '1', tool('sheetsMenu')],
    ['Elements', 'Elements', '2', tool('elementsEditor')],
    ['Markings', 'Markings', '3', tool('markingsEditor')],
    ['Intersections', 'Intersections', '4', tool('intersectionsEditor')],
    ['Signs', 'Signs', '5', tool('signsEditor')],
    ['Simulator', 'Simulator', '6', tool('simulatorEditor')],
    ['Levels', 'Levels', '7', tool('levelsEditor')],
    ['Download', 'Download', '8', tool('downloadMenu')],
    ['DarkMode', 'Toggle Dark Mode', '9', click('darkMode')],
    ['Select', 'Select', '0', tool('selectEditor')],
    ['AddRoad', 'Add Road', 'R', () => { tool('elementsEditor')(); if (document.getElementById('addRoad').getAttribute('aria-pressed') !== 'true') click('addRoad')(); }],
    ['AddMedian', 'Add Median', 'M', () => { tool('elementsEditor')(); click('addMedian')(); }],
    ['AddBikeLane', 'Add Bike Lane', 'B', click('addBikeLane')],
    ['NewIntersection', 'New Intersection', 'I', click('newIntersection')],
    ['CloseMenu', 'Close Menu', 'ESC', null],
    ['ShowHideMenus', 'Show/Hide All Menus', 'F1', () => document.body.classList.toggle('menusHidden')],
    ['UndoEdit', 'Undo', 'CTRL+Z', () => document.getElementById('undoButton')?.click()],
    ['RedoEdit', 'Redo', 'CTRL+SHIFT+Z|CTRL+Y', () => document.getElementById('redoButton')?.click()],
    ['CopyElements', 'Copy selection', 'CTRL+C', null],
    ['CutElements', 'Cut selection', 'CTRL+X', null],
    ['PasteElements', 'Paste', 'CTRL+V', null],
    ['DuplicateElements', 'Duplicate selection', 'CTRL+D', null],
    ['SelectAll', 'Select all', 'CTRL+A', null],
    ['ClearAll', 'Clear All', 'CTRL+BACKSPACE', click('clearAll')],
    ['ZoomIn', 'Zoom In', '=', () => app.sheets?.zoomBy?.(1.25)],
    ['ZoomOut', 'Zoom Out', '-', () => app.sheets?.zoomBy?.(0.8)],
  ];
  // Shortcuts other code handles directly (selection, history, Escape); when
  // remapped, the new keys are sent on as the original ones.
  const BUILT_IN = { CloseMenu: 'Escape', CopyElements: ['c', true], CutElements: ['x', true], PasteElements: ['v', true], DuplicateElements: ['d', true], SelectAll: ['a', true] };
  const UNDO_REDO = new Set(['UndoEdit', 'RedoEdit']);

  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch {}
  const valueOf = id => (Object.hasOwn(overrides, id) ? String(overrides[id] ?? '') : SHORTCUTS.find(s => s[0] === id)?.[2] ?? '');
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch {} };
  const normalize = value => String(value || '').toUpperCase().replace(/\s+/g, '').replace(/CMD|⌘|⌃/g, 'CTRL').replace(/⇧/g, 'SHIFT').replace(/⌥/g, 'ALT').replace(/ESCAPE/g, 'ESC');
  const NAMES = { Escape: 'ESC', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BACKSPACE', Delete: 'DELETE', Enter: 'ENTER', Tab: 'TAB', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN', ' ': 'SPACE' };
  function tokenOf(event) {
    const code = event.code || '';
    const k = NAMES[event.key] || (/^Key[A-Z]$/.test(code) ? code.slice(-1) : /^Digit\d$/.test(code) ? code.slice(-1) : String(event.key || '').toUpperCase());
    if (['CONTROL', 'META', 'ALT', 'SHIFT'].includes(k)) return '';
    return [(event.ctrlKey || event.metaKey) && 'CTRL', event.altKey && 'ALT', event.shiftKey && 'SHIFT', k].filter(Boolean).join('+');
  }
  const format = value => String(value || '').split('|').filter(Boolean).map(token => {
    const parts = normalize(token).split('+');
    return isMac ? parts.map(p => ({ CTRL: '⌘', SHIFT: '⇧', ALT: '⌥' })[p] || p).join('') : parts.join('+');
  }).join(' | ');
  const typing = el => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
    || (el.tagName === 'INPUT' && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes((el.type || '').toLowerCase())));
  // Without Ctrl/Cmd or Alt a shortcut never fires while typing in a field.
  const matches = (event, id) => {
    const token = normalize(tokenOf(event));
    return !!token && valueOf(id).split('|').map(normalize).includes(token) && (/(^|\+)(CTRL|ALT)\+/.test(token) || !typing(event.target));
  };
  const defaultMatches = (event, id) => {
    const token = normalize(tokenOf(event));
    return !!token && (SHORTCUTS.find(s => s[0] === id)?.[2] ?? '').split('|').map(normalize).includes(token);
  };
  const mode = () => app.settings?.get('keybindMode') ?? 'all';

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || document.querySelector('dialog[open]') || event.target.closest?.('.shortcutList')) return;
    const current = mode();
    if (current === 'none') {
      // Built-in shortcuts stay off too, except plain Escape, which closes things.
      if (event.key !== 'Escape' && (event.metaKey || event.ctrlKey || /^[0-9A-Za-z=\-]$/.test(event.key))) event.stopImmediatePropagation();
      return;
    }
    for (const [id, , , action] of SHORTCUTS) {
      if (current === 'undo-redo' && !UNDO_REDO.has(id)) continue;
      const builtIn = BUILT_IN[id];
      if (builtIn || UNDO_REDO.has(id)) {
        // Built-in keys still work unless remapped away; remapped keys are sent on.
        if (defaultMatches(event, id) && !matches(event, id) && Object.hasOwn(overrides, id)) { event.stopImmediatePropagation(); event.preventDefault(); return; }
        if (matches(event, id) && !defaultMatches(event, id)) {
          event.preventDefault(); event.stopImmediatePropagation();
          if (UNDO_REDO.has(id)) action(); else if (Array.isArray(builtIn)) key(builtIn[0], builtIn[1]); else key(builtIn);
          return;
        }
        continue;
      }
      if (!matches(event, id)) continue;
      event.preventDefault(); event.stopImmediatePropagation();
      action();
      return;
    }
  }, true);

  // Settings › Shortcuts.
  document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('shortcutList'), modeSelect = document.getElementById('keybindMode');
    modeSelect.value = mode();
    modeSelect.addEventListener('change', () => app.settings.set('keybindMode', modeSelect.value));
    for (const [id, label] of SHORTCUTS) {
      const row = document.createElement('label');
      row.textContent = label;
      const input = Object.assign(document.createElement('input'), { type: 'text', readOnly: true, value: format(valueOf(id)) });
      input.dataset.shortcut = id;
      input.setAttribute('aria-label', `${label} shortcut`);
      input.addEventListener('keydown', event => {
        if (event.key === 'Tab') return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') return input.blur();
        const value = event.key === 'Backspace' && !event.ctrlKey && !event.metaKey ? '' : tokenOf(event);
        if (value === '' && event.key !== 'Backspace') return;
        overrides[id] = value;
        save();
        input.value = format(value);
      });
      row.append(input);
      list.append(row);
    }
    document.getElementById('resetShortcuts').addEventListener('click', () => {
      overrides = {};
      save();
      list.querySelectorAll('input').forEach(input => { input.value = format(valueOf(input.dataset.shortcut)); });
    });
  });
  app.shortcuts = { snapshot:()=>({...overrides}), restore(value) {
    overrides={...value};save();
    document.querySelectorAll('[data-shortcut]').forEach(input=>{input.value=format(valueOf(input.dataset.shortcut));});
    const modeInput=document.getElementById('keybindMode');if(modeInput)modeInput.value=mode();
  }, list: SHORTCUTS.map(([id, label]) => ({ id, label, keys: format(valueOf(id)) })) };
})();
