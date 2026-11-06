/* Favorites interaction and star artwork adapted from SignMaker v2.19
   public/js/IconPicker.js (GPL-3.0). Preferences belong to the browser,
   independent of sheets and undo history. */
(() => {
  const app=window.StripeMaker??={},storageKey='StripeMaker.pickerFavorites.v1';
  let saved={};
  try { const value=JSON.parse(localStorage.getItem(storageKey));if(value&&typeof value==='object'&&!Array.isArray(value))saved=value; } catch {}
  app.pickerFavorites = namespace => {
    const favorites=new Set(Array.isArray(saved[namespace])?saved[namespace].filter(key=>typeof key==='string'):[]);
    const has=key=>favorites.has(key);
    const order=(items,key)=>[...items.filter(item=>has(key(item))),...items.filter(item=>!has(key(item)))];
    function append(grid,button,key,label,refresh,{headings=false,otherLabel='Other items'}={}){
      const favorite=has(key),previous=grid.querySelector('.pickerFavoriteCard:last-of-type');
      if(headings&&(!previous||previous.dataset.favorite!==String(favorite))){
        const heading=document.createElement('h4');heading.className='pickerFavoriteHeading';heading.textContent=favorite?'Favorites':otherLabel;grid.append(heading);
      }
      const card=document.createElement('div');card.className='pickerFavoriteCard';card.dataset.favoriteKey=key;card.dataset.favorite=String(favorite);
      const star=document.createElement('button');star.type='button';star.className='pickerFavoriteButton';
      star.setAttribute('aria-label',`${favorite?'Unfavorite':'Favorite'} ${label}`);star.title=star.getAttribute('aria-label');star.setAttribute('aria-pressed',String(favorite));
      star.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.91-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z"/></svg>';
      star.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        if(has(key))favorites.delete(key);else favorites.add(key);
        saved[namespace]=[...favorites];try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}
        const scroll=grid.scrollTop;refresh(key);grid.scrollTop=scroll;
        if(event.detail===0)[...grid.querySelectorAll('.pickerFavoriteCard')].find(node=>node.dataset.favoriteKey===key)?.querySelector('.pickerFavoriteButton')?.focus({preventScroll:true});
      });
      card.append(button,star);grid.append(card);
    }
    return {has,order,append};
  };
})();
