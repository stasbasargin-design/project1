(() => {
  'use strict';
  const lessons = {
    incoming:{n:'УРОК 1',title:'Входящий звонок → запись в календарь',video:'assets/training/video/01_incoming_call_calendar.mp4',track:'assets/training/subtitles/01.vtt',poster:'assets/training/img/lesson1.jpg',text:'При входящем звонке событие создаётся телефонией, поэтому вид обращения устанавливается автоматически: «Входящий звонок». Если пользователь создаёт событие вручную, вид обращения должен быть «Встреча».'},
    ko:{n:'УРОК 2',title:'Событие → задача в КО',video:'assets/training/video/02_event_to_ko.mp4',track:'assets/training/subtitles/02.vtt',poster:'assets/training/img/lesson2.jpg',text:'Передайте обращение через штатную задачу CRM. Перед созданием задачи проверьте вид обращения: вручную созданное событие — «Встреча», входящий звонок — «Входящий звонок», исходящий звонок — «Исходящий звонок».'},
    bitrix:{n:'УРОК 3',title:'Задача для КО в Bitrix24',video:'assets/training/video/03_ko_in_bitrix24.mp4',track:'assets/training/subtitles/03.vtt',poster:'assets/training/img/lesson3.jpg',text:'Сотрудник КО получает в Bitrix24 задачу с контекстом из 1С. Содержание должно быть понятным без дополнительного звонка мастеру-приёмщику.'}
  };
  const portal=document.getElementById('trainingPortal'); const app=document.getElementById('trainerApp'); const video=document.getElementById('portalVideo'); const source=document.getElementById('portalVideoSource'); const track=document.getElementById('portalVideoTrack'); const caption=document.getElementById('portalCaption');
  const n=document.getElementById('portalLessonNo'), title=document.getElementById('portalLessonTitle'), text=document.getElementById('portalLessonText');
  function openTrainer(){ portal.classList.add('portal-hidden'); app.classList.remove('portal-hidden'); window.scrollTo(0,0); }
  function openPortal(){ try{video.pause()}catch(e){} app.classList.add('portal-hidden'); portal.classList.remove('portal-hidden'); window.scrollTo(0,0); }
  function pick(id){ const l=lessons[id]; if(!l)return; document.querySelectorAll('[data-portal-lesson]').forEach(b=>b.classList.toggle('active',b.dataset.portalLesson===id)); source.src=l.video; track.src=l.track; video.poster=l.poster; video.load(); try{ video.textTracks[0].mode='showing'; }catch(e){} n.textContent=l.n; title.textContent=l.title; text.textContent=l.text; caption.textContent=l.text; }
  document.querySelectorAll('[data-open-trainer]').forEach(b=>b.addEventListener('click',openTrainer)); document.querySelectorAll('[data-portal-lesson]').forEach(b=>b.addEventListener('click',()=>pick(b.dataset.portalLesson)));
  const home=document.getElementById('homeButton'); if(home)home.addEventListener('click',openPortal);
  video.addEventListener('loadedmetadata',()=>{ try{video.textTracks[0].mode='showing'}catch(e){} });
  video.addEventListener('timeupdate',()=>{ try{const cues=video.textTracks[0]&&video.textTracks[0].activeCues;if(cues&&cues.length)caption.textContent=cues[0].text}catch(e){} });
})();
