/* App-wide settings (the Settings popover), kept in this browser like
   SignalMaker's project storage. They apply to every sheet and aren't undo steps. */
(() => {
  const KEY = 'stripemaker-settings-v1';
  // Sign leader arrow thickness (percent), the highest level drawn (0: all), and
  // black contrast for markings on elevated levels (concrete bridge decks).
  const defaults = { signArrowWeight: 100, hideLevelsAbove: 0, autoContrast: true, keybindMode: 'all' };
  let values = { ...defaults };
  try { Object.assign(values, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {}
  const settings = {
    snapshot: () => ({...defaults,...values}),
    get: key => values[key] ?? defaults[key],
    set(key, value) {
      values[key] = value;
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
      document.dispatchEvent(new CustomEvent('settingschange', { detail: { key } }));
    },
  };
  (window.StripeMaker ??= {}).settings = settings;

  document.addEventListener('DOMContentLoaded', () => {
    const range = document.getElementById('signArrowWeight'), number = document.getElementById('signArrowWeightValue');
    const show = () => { range.value = number.value = settings.get('signArrowWeight'); };
    for (const input of [range, number]) input.addEventListener('input', () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || !input.checkValidity()) return;
      settings.set('signArrowWeight', value);
      if (input === range) number.value = value; else range.value = value;
    });
    number.addEventListener('change', show);
    const levels = document.getElementById('hideLevelsAbove');
    levels.value = String(settings.get('hideLevelsAbove'));
    levels.addEventListener('change', () => settings.set('hideLevelsAbove', Number(levels.value)));
    const contrast = document.getElementById('autoContrast');
    contrast.checked = settings.get('autoContrast');
    contrast.addEventListener('change', () => settings.set('autoContrast', contrast.checked));
    document.addEventListener('settingschange', () => { show();levels.value=String(settings.get('hideLevelsAbove'));contrast.checked=settings.get('autoContrast');window.StripeMaker.roadEditor?.render(); });
    show();
  });
})();
