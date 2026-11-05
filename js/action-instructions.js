/* Contextual action instructions, using SignalMaker's compact blue panel
   palette and Inter/Overpass typography (GPL-3.0). Original live status nodes
   remain the accessible source; the fixed top-right copy never intercepts input. */
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const sources = [...document.querySelectorAll([
      '#elementsHint', '#lineStatus', '#markingStatus', '#signStatus', '#assemblyStatus',
      '#intersectionStatus', '#intersectionSheetMessage', '#simulatorStatus',
      '#matchLineStatus', '#levelsStatus', '#selectStatus', '#scaleEditor .scaleHint',
    ].join(','))];
    const hint = document.createElement('div');
    hint.id = 'actionInstruction';hint.hidden = true;hint.setAttribute('aria-hidden', 'true');
    document.body.append(hint);
    let owner = null, source = null, dismissed = true, activation = 0, hovered = null, focused = null;
    const visible = node => node && !node.closest('[hidden]') && node.getClientRects().length;
    const instructional = text => /\b(click|drag|release|press|hold|choose|select|double-click|zoom)\b/i.test(text)
      && !/\b(canceled|cancelled|removed|deleted|playing|paused|cleared)\b/i.test(text);
    const panelFor = node => node?.closest('.editor,.headsMenu');
    function restoreSource() { source?.classList.remove('actionInstructionSource'); }
    function hide() { restoreSource();hint.hidden = true; }
    function dismiss() { activation++;hovered=null;focused=null;hide();dismissed = true;owner = null;source = null; }
    function refresh(preferred = null) {
      const help=[hovered,focused].find(node=>visible(node)&&node.dataset.help);
      if(help&&!document.querySelector('dialog[open]')){
        restoreSource();hint.textContent=help.dataset.help;hint.hidden=false;return;
      }
      if(dismissed || !visible(owner) || document.querySelector('dialog[open]')) { hide();return; }
      const candidates = sources.filter(node => panelFor(node) === owner && visible(node));
      const next = candidates.includes(preferred) ? preferred : candidates.includes(source) ? source : candidates[0];
      const text = next?.textContent.trim() ?? '';
      if(source !== next) { restoreSource();source = next; }
      if(!instructional(text)) { hide();return; }
      if(hint.textContent !== text)hint.textContent = text;
      source.classList.add('actionInstructionSource');hint.hidden = false;
    }
    const helpAt=node=>node instanceof Element?node.closest('[data-help]'):null;
    document.addEventListener('pointerover',event=>{hovered=helpAt(event.target);refresh();});
    document.addEventListener('pointerout',event=>{hovered=helpAt(event.relatedTarget);refresh();});
    document.addEventListener('focusin',event=>{focused=helpAt(event.target);refresh();});
    document.addEventListener('focusout',event=>{focused=helpAt(event.relatedTarget);refresh();});
    // Capture activation before a panel rebuild removes the clicked button.
    // Defer reading its status until the action has supplied its next step.
    document.addEventListener('click', event => {
      const button = event.target.closest('button,[role="button"]');
      if(!button || button.matches('[role="combobox"],.symbolPickerItem') || button.closest('dialog'))return;
      const requested = panelFor(button) ?? document.getElementById(button.dataset.editor ?? '');
      if(!requested && !button.closest('[role="menu"]'))return;
      const ticket=++activation;
      setTimeout(() => {
        if(ticket!==activation)return;
        restoreSource();source = null;
        owner = visible(requested) ? requested : [...document.querySelectorAll('.editor:not([hidden])')].find(visible);
        dismissed = false;refresh();
      },0);
    }, true);
    window.addEventListener('keydown', event => {
      if(event.key === 'Escape')dismiss();
    }, true);
    window.addEventListener('blur', dismiss);
    for(const event of ['sheetchange','sheethistory'])document.addEventListener(event,dismiss);
    const messages = new MutationObserver(records => {
      const changed = records.map(record => sources.find(node => node === record.target || node.contains(record.target))).filter(Boolean);
      refresh(changed.find(node => panelFor(node) === owner));
    });
    for(const node of sources)messages.observe(node,{childList:true,characterData:true,subtree:true});
    const panels = new MutationObserver(() => { if(owner && !visible(owner)){hide();owner=null;source=null;}else refresh(); });
    for(const panel of document.querySelectorAll('.editor,.headsMenu'))panels.observe(panel,{attributes:true,subtree:true,attributeFilter:['hidden']});
  });
})();
