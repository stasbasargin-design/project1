from pathlib import Path
import json, traceback
from datetime import date,timedelta
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v8.html').read_text(encoding='utf-8');results=[];errors=[]
def check(label,fn):
 try:fn();results.append({'name':label,'passed':True});print('PASS',label,flush=True)
 except Exception as ex:results.append({'name':label,'passed':False,'error':str(ex)[:600]});print('FAIL',label,str(ex)[:200],flush=True);traceback.print_exc(limit=1)
with sync_playwright() as pw:
 kw={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if Path('/usr/bin/chromium').exists():kw['executable_path']='/usr/bin/chromium'
 browser=pw.chromium.launch(**kw)
 page=browser.new_page(viewport={'width':1600,'height':900},locale='ru-RU')
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
 page.on('dialog',lambda d:d.accept())
 page.set_default_timeout(6500);page.set_content(html,wait_until='load')
 def click(s):page.locator(s).first.click()
 def fill(s,val):page.locator(s).first.fill(val)
 def pick(target,name):
  click(f'[data-target="{target}"][data-choose]');page.locator('#pickerRows tr').filter(has_text=name).first.click();click('[data-action="pickSelected"]')
 def order_work(name):
  click('[data-tab="repair.works"]');click('[data-action="repairAdd:works"]')
  fill('[data-repair-list="works.0.name"]',name);fill('[data-repair-list="works.0.quantity"]','1')
 def t1():
  click('#topNav [data-nav="event"]');click('[data-action="create:appointment"]')
  pick('appointment.counterparty','Транслогистика');pick('appointment.contact','Кузнецов');pick('appointment.vehicle','КАМАЗ 65115')
  fill('[data-field="appointment.date"]',(date.today()+timedelta(days=3)).isoformat())
  fill('[data-field="appointment.time"]','10:40');fill('[data-field="appointment.reason"]','Дефектовка пневмосистемы и устранение неисправности')
  click('[data-action="save:appointment"]')
  click('[data-action="appointmentToRepair"]')
  assert page.locator('[data-field="repair.vehicle"]').input_value()=='КАМАЗ 65115'
  assert page.locator('[data-field="repair.counterparty"]').input_value()=='ООО «Транслогистика»'
  page.locator('[data-field="repair.type"]').select_option('Текущий ремонт')
  click('[data-action="save:repair"]')
  assert 'Не менее одной автоработы' in page.locator('#statusText').inner_text()
  order_work('Диагностика пневмосистемы')
  click('[data-action="save:repair"]')
  assert 'ЗН-00001' in page.locator('#screen').inner_text()
  page.screenshot(path=str(root/'qa/v8-zn-first.png'),full_page=True)
 check('Booking creates linked ZN and ZN requires at least one valid auto-work',t1)
 def t2():
  click('[data-action="new:repair"]')
  assert page.locator('[data-field="repair.counterparty"]').input_value()==''
  click('[data-tab="repair.works"]');assert page.locator('[data-repair-list="works.0.name"]').count()==0
  click('[data-tab="repair.main"]');pick('repair.counterparty','СеверТранс');pick('repair.vehicle','МАЗ 5440')
  page.locator('[data-field="repair.type"]').select_option('Техническое обслуживание')
  order_work('Замена масла')
  click('[data-action="save:repair"]')
  assert 'ЗН-00002' in page.locator('#screen').inner_text()
  click('[data-tab="repairTop.list"]')
  assert page.locator('tr[data-row^="repairno:"]').count()==2
  page.screenshot(path=str(root/'qa/v8-zn-register.png'),full_page=True)
 check('Two separate ZNs are saved in a document register, each with its own number',t2)
 def t3():
  click('[data-row="repairno:ЗН-00001"]')
  assert page.locator('[data-field="repair.vehicle"]').input_value()=='КАМАЗ 65115'
  click('[data-tab="repair.works"]')
  assert page.locator('[data-repair-list="works.0.name"]').input_value()=='Диагностика пневмосистемы'
  click('[data-tab="repairTop.list"]')
  click('[data-row="repairno:ЗН-00002"]')
  assert page.locator('[data-field="repair.vehicle"]').input_value()=='МАЗ 5440'
  click('[data-tab="repair.works"]')
  assert page.locator('[data-repair-list="works.0.name"]').input_value()=='Замена масла'
 check('Switching two ZNs restores each document work rows and vehicle',t3)
 def t4():
  click('[data-tab="repairTop.list"]');click('[data-row="repairno:ЗН-00001"]')
  click('[data-tab="repair.result"]');fill('[data-field="repair.result"]','Проведена диагностика; устранена утечка воздуха в системе.')
  click('[data-action="finishRepair"]')
  assert page.locator('[data-field="repair.status"]').input_value()=='Закрыт' if page.locator('[data-field="repair.status"]').count() else 'ЗН-00001' in page.locator('#screen').inner_text()
  click('[data-tab="repairTop.list"]')
  assert 'Закрыт' in page.locator('tr[data-row="repairno:ЗН-00001"]').inner_text()
  assert 'Открыт' in page.locator('tr[data-row="repairno:ЗН-00002"]').inner_text()
 check('Closing one ZN does not change the status of the other ZN',t4)
 def t5():
  click('#topNav [data-nav="event"]')
  click('[data-action="create:appointment"]')
  click('[data-tab="appointment.history"]')
  click('[data-row="savedappointment:0"]')
  click('[data-tab="appointment.tree"]')
  assert page.locator('[data-row="repairno:ЗН-00001"]').count()==1
  click('[data-row="repairno:ЗН-00001"]')
  assert page.locator('[data-field="repair.vehicle"]').input_value()=='КАМАЗ 65115'
 check('Appointment document tree opens precisely its saved linked ZN',t5)
 browser.close()
report={'total':len(results),'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'pageErrors':errors,'tests':results}
(root/'qa/test_v8_repair_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY',report['passed'],'/',report['total'],'JS errors',len(errors))
raise SystemExit(1 if report['failed'] or errors else 0)
