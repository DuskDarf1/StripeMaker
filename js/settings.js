/* App-wide settings (the Settings popover), kept in this browser like
   SignalMaker's project storage. They apply to every sheet and aren't undo steps. */
(() => {
  const KEY = 'stripemaker-settings-v1';
  // Drawing opacity and sign leader arrow thickness (percent), the highest level drawn (0: all), and
  // black contrast for markings on elevated levels (concrete bridge decks).
  const defaults = { drawingOpacity: 100, signArrowWeight: 100, hideLevelsAbove: 0, autoContrast: true, leftHandTraffic: false, simulationSpeed: 30, keybindMode: 'all' };
  let values = { ...defaults };
  try { Object.assign(values, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {}
  const validOpacity = value => Number.isFinite(value) && value >= 0 && value <= 100;
  if(typeof values.leftHandTraffic!=='boolean')values.leftHandTraffic=false;
  if (!validOpacity(values.drawingOpacity)) values.drawingOpacity = defaults.drawingOpacity;
  const validSpeed = value => Number.isFinite(value) && value >= 0 && value <= 999;
  if (!validSpeed(values.simulationSpeed)) values.simulationSpeed = defaults.simulationSpeed;
  const settings = {
    snapshot: () => ({...defaults,...values}),
    get: key => values[key] ?? defaults[key],
    set(key, value) {
      if (key === 'drawingOpacity' && !validOpacity(value)) return;
      if (key === 'simulationSpeed') { if (!validSpeed(value)) return; value = Math.round(value * 10) / 10; }
      values[key] = value;
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
      document.dispatchEvent(new CustomEvent('settingschange', { detail: { key } }));
    },
  };
  (window.StripeMaker ??= {}).settings = settings;

  // Saved geometry uses one canonical lane graph. Reversing its traffic is a
  // view of that graph: positions, anchors, links and undo snapshots stay exact.
  window.StripeMaker.traffic = {
    get reversed() { return settings.get('leftHandTraffic') === true; },
    get sign() { return this.reversed ? -1 : 1; },
    incoming(canonical) { return canonical !== this.reversed; },
    path(points) { return this.reversed ? [...points].reverse() : points; },
    angle(angle=0) { return angle + (this.reversed ? 180 : 0); },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const controls = ['drawingOpacity', 'signArrowWeight'].map(key => {
      const range = document.getElementById(key), number = document.getElementById(`${key}Value`);
      const show = () => { range.value = number.value = settings.get(key); };
      for (const input of [range, number]) input.addEventListener('input', () => {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value) || !input.checkValidity()) return;
        settings.set(key, value);
      });
      number.addEventListener('change', show);
      return show;
    });
    const show = () => {
      controls.forEach(update => update());
      document.documentElement.style.setProperty('--drawing-opacity', settings.get('drawingOpacity') / 100);
    };
    const levels = document.getElementById('hideLevelsAbove');
    levels.value = String(settings.get('hideLevelsAbove'));
    levels.addEventListener('change', () => settings.set('hideLevelsAbove', Number(levels.value)));
    const traffic = document.getElementById('leftHandTraffic');
    traffic.checked = settings.get('leftHandTraffic');
    traffic.addEventListener('change', () => settings.set('leftHandTraffic', traffic.checked));
    const contrast = document.getElementById('autoContrast');
    contrast.checked = settings.get('autoContrast');
    contrast.addEventListener('change', () => settings.set('autoContrast', contrast.checked));
    document.addEventListener('settingschange', event => { show();traffic.checked=settings.get('leftHandTraffic');levels.value=String(settings.get('hideLevelsAbove'));contrast.checked=settings.get('autoContrast');if(!['drawingOpacity','simulationSpeed'].includes(event.detail?.key))window.StripeMaker.roadEditor?.render(); });
    show();
  });
})();
