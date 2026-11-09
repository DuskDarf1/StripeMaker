/* App-wide settings (the Settings popover), kept in this browser like
   SignalMaker's project storage. They apply to every sheet and aren't undo steps. */
(() => {
  const KEY = 'stripemaker-settings-v1';
  // Drawing opacity and sign leader arrow thickness (percent), the highest level drawn (0: all), and
  // black contrast for markings on elevated levels (concrete bridge decks).
  const defaults = { drawingOpacity: 100, pavementDarkness: 77, signArrowWeight: 100, hideLevelsAbove: 0, autoContrast: true, leftHandTraffic: false, simulationTemperature: 40, simulationPlaybackRate: 1, simulationOverlay: 'none', simulationOverlays: [], keybindMode: 'all', scrollWheelMode: 'auto' };
  let values = { ...defaults };
  let stored={};
  try { stored=JSON.parse(localStorage.getItem(KEY)??'{}')??{};Object.assign(values,stored); } catch {}
  const validScrollMode=value=>['auto','zoom','pan'].includes(value);
  if(!validScrollMode(values.scrollWheelMode))values.scrollWheelMode=defaults.scrollWheelMode;
  const validArrowWeight=value=>Number.isFinite(value)&&value>=1&&value<=400;
  if(!validArrowWeight(values.signArrowWeight))values.signArrowWeight=defaults.signArrowWeight;
  const validOpacity = value => Number.isFinite(value) && value >= 0 && value <= 100;
  if(typeof values.leftHandTraffic!=='boolean')values.leftHandTraffic=false;
  if (!validOpacity(values.pavementDarkness)) values.pavementDarkness = defaults.pavementDarkness;
  if (!validOpacity(values.drawingOpacity)) values.drawingOpacity = defaults.drawingOpacity;
  // Discard the retired global speed; local road zones own speeds.
  delete values.simulationSpeed;
  const validTemperature = value => Number.isInteger(value) && value >= 0 && value <= 100;
  if (!validTemperature(values.simulationTemperature)) values.simulationTemperature = defaults.simulationTemperature;
  const validPlaybackRate = value => Number.isFinite(value) && value >= 1 && value <= 5;
  if (!validPlaybackRate(values.simulationPlaybackRate)) values.simulationPlaybackRate = defaults.simulationPlaybackRate;
  if (!['none','density','speed','stopped'].includes(values.simulationOverlay)) values.simulationOverlay = defaults.simulationOverlay;
  const overlayNames=['density','speed','stopped'];
  const validOverlays=value=>Array.isArray(value)&&value.every(name=>overlayNames.includes(name));
  values.simulationOverlays=validOverlays(stored.simulationOverlays)?[...new Set(stored.simulationOverlays)]:values.simulationOverlay==='none'?[]:[values.simulationOverlay];
  const settings = {
    pavementColor: () => {
      // Keep the original slightly cool asphalt at the default, with white/black
      // endpoints. This changes the opaque surface color, not marking opacity.
      const d = values.pavementDarkness;
      const channels = [58, 59, 61].map(c => Math.round(d <= 77 ? 255 + (c-255)*d/77 : c*(100-d)/23));
      return '#' + channels.map(c=>c.toString(16).padStart(2,'0')).join('');
    },
    snapshot: () => ({...defaults,...values,simulationOverlays:[...values.simulationOverlays]}),
    get: key => key==='simulationOverlays'?[...values.simulationOverlays]:values[key] ?? defaults[key],
    set(key, value) {
      if(key==='simulationOverlays') {
        if(!validOverlays(value))return;value=[...new Set(value)];
        values.simulationOverlay=value.length===1?value[0]:'none';
      }
      // Accept older projects and development tools with a single overlay.
      if(key==='simulationOverlay') {
        if(!['none',...overlayNames].includes(value))return;
        values.simulationOverlays=value==='none'?[]:[value];
      }
      if(key==='scrollWheelMode'&&!validScrollMode(value))return;
      if(key==='signArrowWeight'&&!validArrowWeight(value))return;
      if ((key === 'drawingOpacity' || key === 'pavementDarkness') && !validOpacity(value)) return;
      if (key === 'simulationTemperature' && !validTemperature(value)) return;
      if (key === 'simulationPlaybackRate') { if (!validPlaybackRate(value)) return; value = Math.round(value * 10) / 10; }
      if (key === 'simulationSpeed') return; // Legacy project setting, intentionally ignored.
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
    const controls = ['drawingOpacity', 'pavementDarkness', 'signArrowWeight'].map(key => {
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
      document.documentElement.style.setProperty('--pavement-color', settings.pavementColor());
      document.documentElement.style.setProperty('--drawing-opacity', settings.get('drawingOpacity') / 100);
    };
    const scrollMode=document.getElementById('scrollWheelMode');
    scrollMode.value=settings.get('scrollWheelMode');
    scrollMode.addEventListener('change',()=>settings.set('scrollWheelMode',scrollMode.value));
    const levels = document.getElementById('hideLevelsAbove');
    levels.value = String(settings.get('hideLevelsAbove'));
    levels.addEventListener('change', () => settings.set('hideLevelsAbove', Number(levels.value)));
    const traffic = document.getElementById('leftHandTraffic');
    traffic.checked = settings.get('leftHandTraffic');
    traffic.addEventListener('change', () => settings.set('leftHandTraffic', traffic.checked));
    const contrast = document.getElementById('autoContrast');
    contrast.checked = settings.get('autoContrast');
    contrast.addEventListener('change', () => settings.set('autoContrast', contrast.checked));
    document.addEventListener('settingschange', event => { show();scrollMode.value=settings.get('scrollWheelMode');traffic.checked=settings.get('leftHandTraffic');levels.value=String(settings.get('hideLevelsAbove'));contrast.checked=settings.get('autoContrast');if(!['pavementDarkness','scrollWheelMode','drawingOpacity','simulationSpeed','simulationTemperature','simulationPlaybackRate','simulationOverlay','simulationOverlays'].includes(event.detail?.key))window.StripeMaker.roadEditor?.render(); });
    show();
  });
})();
