const selectChoice=require('./select-choice.cjs');
module.exports=async(page,type)=>{await selectChoice(page.locator('#elementToAdd'),type);await page.locator('#addElement').click();};
