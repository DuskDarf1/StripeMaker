/* Run after import-florida-signs.py; use the same legend renderer as the editor. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');global.window=global;
const D=require('../js/sign-designs.js');require('../assets/signs/lettering.js');
const entries=JSON.parse(fs.readFileSync(path.join(root,'assets/signs/florida.json'))).signs;
for(const entry of entries){
 require(path.join(root,'assets/signs/data',entry.code+'.js'));
 const art=StripeMaker.signArtwork[entry.id];
 if(art.staticLegend){art.paths.push(...D.legend(art.staticLegend.value,art.staticLegend,StripeMaker.signAlphabets).paths);delete art.staticLegend;}
 for(const field of art.fields){const error=D.legend(field.default,field,StripeMaker.signAlphabets).error;if(error)throw Error(entry.id+': '+error);}
 const paths=D.compose(art.paths,art.fields,{},StripeMaker.signAlphabets,entry.box);
 fs.writeFileSync(path.join(root,entry.src),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${entry.box.join(' ')}">${paths.map(p=>'<path '+Object.entries(p).map(([k,v])=>`${k}="${v}"`).join(' ')+'/>').join('')}</svg>`);
}

for(const code of new Set(entries.map(e=>e.code))){const pack=Object.fromEntries(entries.filter(e=>e.code===code).map(e=>[e.id,StripeMaker.signArtwork[e.id]]));fs.writeFileSync(path.join(root,'assets/signs/data',code+'.js'),'window.StripeMaker ??= {}; window.StripeMaker.signArtwork ??= {}; Object.assign(window.StripeMaker.signArtwork,'+JSON.stringify(pack)+');\n');}
