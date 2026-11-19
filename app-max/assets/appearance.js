(function(root){
  'use strict';
  const START=Date.parse('2026-12-10T00:00:00+05:00'),END=Date.parse('2027-01-13T00:00:00+05:00');
  const KEY='itus.appearance.v1';
  let theme='system',holiday=true,timer,dialog;
  try{const saved=JSON.parse(root.localStorage?.getItem(KEY)||'{}');if(['system','light','dark'].includes(saved.theme))theme=saved.theme;if(typeof saved.holiday==='boolean')holiday=saved.holiday;}catch{}
  const media=root.matchMedia?.('(prefers-color-scheme: dark)');
  const seasonActive=(time=Date.now())=>Number(time)>=START&&Number(time)<END;
  const canPreview=()=>['max-test.ea-itus.ru','localhost','127.0.0.1'].includes(root.location?.hostname);
  function save(){try{root.localStorage?.setItem(KEY,JSON.stringify({theme,holiday}));}catch{}}
  function apply(){
    const doc=root.document;if(!doc)return;
    const effective=theme==='system'?(media?.matches?'dark':'light'):theme;
    doc.documentElement.dataset.appearanceTheme=effective;doc.documentElement.style.colorScheme=effective;
    doc.documentElement.classList.toggle('holiday-active',holiday&&seasonActive());
    doc.querySelector('meta[name="theme-color"]')?.setAttribute('content',effective==='dark'?'#191e25':'#f2f4f6');
    const garland=doc.getElementById('holidayGarland');if(garland)garland.hidden=!(holiday&&seasonActive());
    doc.querySelectorAll('button[data-appearance-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.appearanceTheme===theme)));
    const toggle=doc.getElementById('holidayEnabled');if(toggle)toggle.checked=holiday;
    doc.querySelectorAll('button[data-appearance-action="preview"]').forEach(button=>button.disabled=!holiday);
    if(dialog?.open&&(!holiday||(!seasonActive()&&dialog.dataset.preview!=='true')))dialog.close?.();
    root.dispatchEvent?.(new root.Event('resize'));
    clearTimeout(timer);const now=Date.now(),next=now<START?START:now<END?END:now+3600000;
    timer=root.setTimeout?.(apply,Math.max(1000,Math.min(3600000,next-now+25)));
  }
  function setTheme(value){if(!['system','light','dark'].includes(value))return;theme=value;save();apply();}
  function setHoliday(value){holiday=Boolean(value);save();apply();}
  function back(){if(!dialog?.open)return false;if(dialog.close)dialog.close();else dialog.removeAttribute('open');return true;}
  function greeting({preview=false}={}){
    if(!holiday||(!seasonActive()&&!(preview&&canPreview())))return false;
    if(!dialog)return false;
    dialog.dataset.preview=String(preview);
    if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}
    dialog.classList.remove('celebrate');void dialog.offsetWidth;dialog.classList.add('celebrate');
    return true;
  }
  function settings(){
    const preview=canPreview()?`<button class="settings-link" type="button" data-appearance-action="preview" ${holiday?'':'disabled'}><span>🎁 Предпросмотр поздравления</span><span aria-hidden="true">›</span></button>`:'';
    const themes=[['light','☀','Светлая'],['dark','◐','Тёмная'],['system','◒','Системная']].map(([value,symbol,label])=>`<button type="button" data-appearance-theme="${value}" aria-pressed="${theme===value}"><span aria-hidden="true">${symbol}</span>${label}</button>`).join('');
    return `<section class="settings-section"><h3>Оформление</h3><div class="settings-group"><div class="appearance-theme-field"><b>Тема приложения</b><div class="appearance-themes" role="group" aria-label="Тема приложения">${themes}</div></div><label class="appearance-switch-row" for="holidayEnabled"><span><b>Новогоднее оформление</b><small>10.12.2026–12.01.2027 · Екатеринбург</small></span><input id="holidayEnabled" type="checkbox" role="switch" ${holiday?'checked':''}></label>${preview}</div></section>`;
  }
  function mount(){
    const doc=root.document,chrome=doc.querySelector('.app-chrome');
    if(chrome&&!doc.getElementById('holidayGarland')){const garland=doc.createElement('div');garland.id='holidayGarland';garland.className='holiday-garland';garland.hidden=true;garland.innerHTML='<div class="holiday-lights" aria-hidden="true">'+Array.from({length:12},()=>'<span></span>').join('')+'</div><button type="button" class="holiday-gift" data-appearance-action="greeting" aria-label="Новогодний сюрприз">🎁</button>';chrome.insertBefore(garland,doc.getElementById('tabs'));}
    dialog=doc.createElement('dialog');dialog.id='holidayGreeting';dialog.className='holiday-greeting';dialog.setAttribute('aria-labelledby','holidayGreetingTitle');
    dialog.innerHTML='<button type="button" class="icon-button holiday-close" data-appearance-action="close" aria-label="Закрыть поздравление">×</button><div class="holiday-confetti" aria-hidden="true">'+Array.from({length:9},(_,i)=>`<span style="--piece:${i}"></span>`).join('')+'</div><div class="holiday-discovery">✦ Пасхалка найдена</div><div class="holiday-present" aria-hidden="true"><div class="holiday-box"><span class="holiday-bow"></span><span class="holiday-tag">I-MAX</span></div></div><div class="holiday-year">2027</div><h2 id="holidayGreetingTitle">С Новым годом!</h2><p>Пусть всё заводится с первого раза,<br>планы сбываются, а рядом<br>будут надёжные люди.</p><p>Спасибо за вашу работу<br>и за то, что мы — команда.</p><b>С теплом, I-MAX</b><button type="button" class="primary" data-appearance-action="close">Вернуться к работе</button>';
    doc.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close?.();}});
    doc.addEventListener('click',event=>{const themeButton=event.target.closest?.('button[data-appearance-theme]');if(themeButton){setTheme(themeButton.dataset.appearanceTheme);return;}const action=event.target.closest?.('[data-appearance-action]')?.dataset.appearanceAction;if(action==='greeting')greeting();if(action==='preview')greeting({preview:true});if(action==='close'){if(dialog.close)dialog.close();else dialog.removeAttribute('open');}});
    doc.addEventListener('change',event=>{if(event.target.id==='holidayEnabled')setHoliday(event.target.checked);});
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)apply();});apply();
  }
  root.ITUS_APPEARANCE={get:()=>({theme,holiday,effective:theme==='system'?(media?.matches?'dark':'light'):theme}),setTheme,setHoliday,seasonActive,season:{start:START,endExclusive:END,timeZone:'Asia/Yekaterinburg'},settings,greeting,back,refresh:apply};
  if(media?.addEventListener)media.addEventListener('change',apply);else media?.addListener?.(apply);
  apply();if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount,{once:true});else if(root.document)mount();
})(typeof window==='object'?window:globalThis);
