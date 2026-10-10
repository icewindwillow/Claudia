export const BREEDS = [
  {value:'狸花猫', label:'狸花猫', icon:'lihua'},
  {value:'英国短毛猫', label:'英国短毛猫', icon:'british-shorthair'},
  {value:'金渐层', label:'金渐层', icon:'golden-shaded'},
  {value:'银渐层', label:'银渐层', icon:'silver-shaded'},
  {value:'橘猫', label:'橘猫', icon:'orange-tabby'},
  {value:'三花猫', label:'三花猫', icon:'calico'},
  {value:'黑猫', label:'黑猫', icon:'black-cat'},
  {value:'白猫', label:'白猫', icon:'white-cat'},
  {value:'奶牛猫', label:'奶牛猫', icon:'calico'},
  {value:'暹罗猫', label:'暹罗猫', icon:'unknown'},
  {value:'布偶猫', label:'布偶猫', icon:'white-cat'},
  {value:'混种／其他', label:'混种／其他', icon:'unknown'},
  {value:'未知', label:'未知', icon:'unknown'}
];
const byValue = new Map(BREEDS.map(item=>[item.value,item]));
export function breedInfo(value){return byValue.get(value)||null;}
export function breedIcon(value){const item=breedInfo(value);if(!item||item.icon==='unknown')return null;const el=document.createElement('span');el.className=`breed-icon breed-${item.icon}`;el.setAttribute('aria-hidden','true');el.title=item.label;return el;}
