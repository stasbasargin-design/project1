from pathlib import Path
import json,traceback
from datetime import date,timedelta
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v8.html').read_text(encoding='utf-8')
results=[];errors=[]
def test(label,fn):
 try: fn();results.append({'name':label,'passed':True});print('PASS',label,flush=True)
 except Exception as ex:results.append({'name':label,'passed':False,'error':str(ex)[:700]});print('FAIL',label,str(ex)[:280],flush=True);traceback.print_exc(limit=1)
with sync_playwright() as pw:
 kw={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if Path('/usr/bin/chromium').exists():kw['executable_path']='/usr/bin/chromium'
 browser=pw.chromium.launch(**kw)
 def newpage():
  context=browser.new_context(viewport={'width':1680,'height':930},locale='ru-RU',accept_downloads=True)
  p=context.new_page();p.set_default_timeout(6500)
  p.on('pageerror',lambda x:errors.append(str(x)))
  p.on('console',lambda x:errors.append(x.text) if x.type=='error' else None)
  p.on('dialog',lambda d:d.accept());p.set_content(html,wait_until='load',timeout=25000)
  return p,context
 def c(p,s):p.locator(s).first.click()
 def fill(p,s,x):p.locator(s).first.fill(x)
 def pick(p,field,needle):
  c(p,f'[data-target="{field}"][data-choose]')
  p.locator('#pickerRows tr').filter(has_text=needle).first.click()
  c(p,'[data-action="pickSelected"]')
 def nav(p,doc):
  if doc in ['desktop','event','estimate','repair','contacts']:c(p,f'#topNav [data-nav="{doc}"]')
  else:
   if 'drawer-left' not in (p.locator('#app').get_attribute('class') or ''):c(p,'#toggleTutor')
   c(p,f'#docNav [data-nav="{doc}"]')
 def book(p,company='Транслогистика',person='Кузнецов',vehicle='КАМАЗ 65115',date_days=2,time='11:20'):
  nav(p,'event');c(p,'[data-action="create:appointment"]')
  pick(p,'appointment.counterparty',company)
  pick(p,'appointment.contact',person)
  pick(p,'appointment.vehicle',vehicle)
  fill(p,'[data-field="appointment.date"]',(date.today()+timedelta(days=date_days)).isoformat())
  fill(p,'[data-field="appointment.time"]',time)
  fill(p,'[data-field="appointment.reason"]','Проверка тормозной системы и уточнение сроков диагностики')
  c(p,'[data-action="save:appointment"]')
 def max_client(p,company='Транслогистика',person='Кузнецов'):
  nav(p,'max');pick(p,'max.counterparty',company);pick(p,'max.contact',person)
 p,ctx=newpage()
 def t1():
  book(p)
  assert 'ЗР-00001' in p.locator('#screen').inner_text()
  assert p.locator('#screen').get_by_text('SMS',exact=True).count()==1
  assert 'ссылка-приглашение' in p.locator('#screen').inner_text()
  c(p,'[data-action="save:appointment"]')
  assert p.locator('#screen').get_by_text('SMS',exact=True).count()==1
  p.screenshot(path=str(root/'qa/v8-appointment-with-invite.png'),full_page=True)
 test('Booking produces exactly one simulated SMS invitation when no active chat',t1)
 def t2():
  c(p,'[data-action="goto:calendar"]')
  assert p.locator('.calendar-table tr[data-action^="openAppointmentByNo:"]').count()==1
  assert 'КАМАЗ 65115' in p.locator('.calendar-table').inner_text()
  p.screenshot(path=str(root/'qa/v8-calendar-planning.png'),full_page=True)
  c(p,'[data-action="openAppointmentByNo:ЗР-00001"]')
  assert p.locator('[data-field="appointment.time"]').input_value()=='11:20'
 test('Planning calendar opens the exact appointment and shows its details',t2)
 def t3():
  c(p,'[data-action="goto:calendar"]');c(p,'[data-action="calendarRoutineMenu"]')
  c(p,'[data-action="calendarRun:10:00"]')
  assert 'без действующего согласия или чата 1' in p.locator('#statusText').inner_text()
  assert p.locator('#screen').get_by_text('Напоминание за день').count()==0
 test('Automatic MAX reminders are blocked without consent and active chat',t3)
 def t4():
  max_client(p)
  assert p.locator('[data-field="max.consent"]').input_value()=='Не получено'
  fill(p,'[data-field="max.message"]','Учебный вопрос о времени визита')
  c(p,'[data-action="sendMax"]')
  assert 'Отправка заблокирована' in p.locator('#statusText').inner_text()
  p.locator('[data-field="max.consent"]').select_option('Получено')
  assert 'Чат активирован' in p.locator('#screen').inner_text()
  c(p,'[data-action="sendMax"]')
  assert 'без реальной отправки' in p.locator('#statusText').inner_text()
  p.screenshot(path=str(root/'qa/v8-max-consent.png'),full_page=True)
 test('MAX chat requires consent, activates on simulated consent, records only educational message',t4)
 def t5():
  nav(p,'calendar')
  for stage in ['10:00','12:00','14:00']:
   c(p,'[data-action="calendarRoutineMenu"]');c(p,f'[data-action="calendarRun:{stage}"]')
  assert p.locator('#screen').get_by_text('Напоминание за день',exact=False).count()==3
  c(p,'[data-action="calendarRoutineMenu"]');c(p,'[data-action="calendarRun:10:00"]')
  assert p.locator('#screen').get_by_text('Напоминание за день',exact=False).count()==3
  p.screenshot(path=str(root/'qa/v8-calendar-reminders.png'),full_page=True)
 test('Three reminders run at 10, 12, 14 hours without duplicates',t5)
 def t6():
  c(p,'[data-action="calendarRoutineMenu"]');c(p,'[data-action="calendarRun:15:30"]')
  assert 'Ожидает звонка' in p.locator('.calendar-table').inner_text()
  assert 'Задача CRM' in p.locator('.calendar-table').inner_text()
  c(p,'[data-action="calendarRoutineMenu"]');c(p,'[data-action="calendarRun:15:30"]')
  nav(p,'tasks')
  assert p.locator('[data-row^="taskqueue:"]').filter(has_text='Обзвон клиента').count()==1
  p.screenshot(path=str(root/'qa/v8-callback-task.png'),full_page=True)
 test('At 15:30 unanswered booking creates one CRM call task with calendar link',t6)
 def t7():
  max_client(p)
  p.locator('[data-field="max.consent"]').select_option('Отозвано')
  fill(p,'[data-field="max.message"]','Проверка запрета коммуникации после отзыва согласия')
  c(p,'[data-action="sendMax"]')
  assert 'заблокирована' in p.locator('#statusText').inner_text()
  c(p,'[data-action="calendarRoutineMenu"]') if p.locator('[data-action="calendarRoutineMenu"]').count() else None
 test('Withdrawal of consent blocks employee messages again',t7)
 ctx.close()
 p2,ctx2=newpage()
 def t8():
  max_client(p2)
  p2.locator('[data-field="max.consent"]').select_option('Получено')
  book(p2,date_days=4)
  assert 'MAX' in p2.locator('#screen').inner_text()
  assert 'Оповещение о записи' in p2.locator('#screen').inner_text()
  p2.screenshot(path=str(root/'qa/v8-booking-existing-max.png'),full_page=True)
 test('Booking with an active MAX chat creates chat notice, not SMS invitation',t8)
 def t9():
  c(p2,'[data-action="goto:calendar"]')
  assert p2.locator('.calendar-table tr[data-action^="openAppointmentByNo:"]').count()==1
  p2.locator('input[data-calendar-date]').fill((date.today()+timedelta(days=5)).isoformat())
  assert p2.locator('.calendar-table tr[data-action^="openAppointmentByNo:"]').count()==0
  c(p2,'[data-action="calendarPrev"]')
  assert p2.locator('.calendar-table tr[data-action^="openAppointmentByNo:"]').count()==1
 test('Calendar filtering by date and previous/next buttons actually works',t9)
 ctx2.close();browser.close()
report={'total':len(results),'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'pageErrors':errors,'tests':results}
(root/'qa/test_v8_calendar_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY',report['passed'],'/',report['total'],'JS errors',len(errors),flush=True)
raise SystemExit(1 if report['failed'] or errors else 0)
