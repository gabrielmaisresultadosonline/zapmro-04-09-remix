import { isAlreadyInLanguage as f } from './language-detect.ts';
const c:[string,string,boolean][]=[['Ok','pt',true],['Bom dia, tudo bem?','pt',true],['👍','pt',true],['Hello, how are you?','pt',false],['Hola, quiero saber el precio','pt',false],['Quero saber o preço','pt',true],['Thanks!','en',true],['Bom dia','en',false]];
Deno.test('lang',()=>{for(const [t,l,e] of c) if(f(t,l)!==e) throw new Error(t+' '+l);});
