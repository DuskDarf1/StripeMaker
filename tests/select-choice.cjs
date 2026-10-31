// Exercise the visible SignalMaker-style picker while keeping fixture calls
// expressed in terms of the underlying control's stable ID and option value.
module.exports=async function selectChoice(select,value){
 const choice=await select.evaluate((element,value)=>{
  const options=[...element.options].filter(o=>!o.hidden&&!o.closest('optgroup[hidden]'));
  const option=typeof value==='object'?element.options[value.index]:options.find(o=>o.value===value);
  if(!option)throw Error('Missing option '+JSON.stringify(value));
  return {id:element.id,index:options.indexOf(option)};
 },value);
 const trigger=select.page().locator(`[id="${choice.id}-button"]`);
 await trigger.click();
 const menu=await trigger.getAttribute('aria-controls');
 await select.page().locator(`[id="${menu}"] [data-native-index="${choice.index}"]`).click();
};
