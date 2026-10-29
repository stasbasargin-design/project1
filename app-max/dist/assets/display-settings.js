(function (root) {
  'use strict';
  const key = 'itus.display-size.v1';
  const choices = [{value:'compact',label:'Компактный',scale:.9},{value:'normal',label:'Обычный',scale:1},{value:'large',label:'Крупный',scale:1.15},{value:'extra',label:'Очень крупный',scale:1.3}];
  let selected = 'normal';
  try { selected = root.localStorage.getItem(key) || selected; } catch {}
  function set(value) {
    const choice = choices.find(item => item.value === value) || choices[1];
    selected = choice.value;
    root.document.documentElement.style.setProperty('--ui-scale', String(choice.scale));
    root.document.documentElement.dataset.displaySize = selected;
    try { root.localStorage.setItem(key, selected); } catch {}
    root.dispatchEvent?.(new Event('resize'));
  }
  root.ITUS_DISPLAY = {choices, get:()=>selected, set};
  set(selected);
  root.document.addEventListener('change', event => { if(event.target?.id === 'appDisplaySize') set(event.target.value); });
})(window);
