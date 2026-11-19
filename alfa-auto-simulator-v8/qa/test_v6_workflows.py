from pathlib import Path
import json,traceback
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v8.html').read_text(encoding='utf-8')
results=[];errors=[]
with sync_playwright() as pw:
 launch_opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if Path('/usr/bin/chromium').exists():launch_opts['executable_path']='/usr/bin/chromium'
 browser=pw.chromium.launch(**launch_opts)
 def page_new():
  context=browser.new_context(viewport={'width':1680,'height':980},locale='ru-RU',accept_downloads=True)
  p=context.new_page();p.set_default_timeout(5500)
  p.on('pageerror',lambda e:errors.append(str(e)))
  p.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
  p.on('dialog',lambda d:d.accept())
  p.set_content(html,wait_until='load',timeout=25000)
  return p,context
 def ck(label,fn):
  try:
   fn();results.append({'name':label,'passed':True});print('PASS',label,flush=True)
  except Exception as e:
   results.append({'name':label,'passed':False,'error':str(e)[:950]});print('FAIL',label,str(e)[:190],flush=True);traceback.print_exc(limit=2)
 def c(p,sel):p.locator(sel).first.click()
 def t(p,sel,val):p.locator(sel).first.fill(val)
 def new_auto(p):
  c(p,'[data-action="simulateDefect"]');c(p,'[data-action="createDefectEvent"]')
 def accept_auto(p):
  c(p,'.crm-task-card');c(p,'[data-action="acceptCRMTask"]');c(p,'[data-action="openTaskSubject"]')
 def top(p,s):c(p,f'#topNav [data-nav="{s}"]')
 def tasknav(p):c(p,'[data-action="goto:tasks"]') if p.locator('[data-action="goto:tasks"]').count() else (c(p,'#toggleTutor'),c(p,'#docNav [data-nav="tasks"]'))
 def browse_task(p,needle):
  if p.locator('[data-row^="taskqueue:"]').filter(has_text=needle).count()==0: tasknav(p)
  p.locator('[data-row^="taskqueue:"]').filter(has_text=needle).first.click()
 def status(p,s):p.locator('[data-field="estimate.status"]').select_option(s)
 def fill_quote(p):
  p.locator('[data-field="estimate.payment"]').select_option('с НДС')
  c(p,'[data-tab="estimate.parts"]');t(p,'[data-item-field="parts.0.price"]','1200')
  c(p,'[data-tab="estimate.main"]')
 def saveq(p):c(p,'[data-action="save:estimate"]')
 def switch_quote(p):
  top(p,'event');c(p,'[data-action="create:estimate"]')
 def chooser(p,target,needle):
  c(p,f'[data-choose][data-target="{target}"]')
  p.locator('#pickerRows tr').filter(has_text=needle).first.click()
  c(p,'[data-action="pickSelected"]')
 def t_auto_to_ozch():
  p,ctx=page_new();new_auto(p);accept_auto(p)
  def b1():
   c(p,'[data-action="pricing"]');t(p,'#pricingComment','Уточнить стоимость тормозных колодок и срок доставки')
   c(p,'[data-action="submitPricing"]')
   top(p,'desktop');tasknav(p)
   assert p.locator('tr').filter(has_text='Подготовить КП клиенту по дефектовке').get_by_text('Выполнена').count()==1
   assert p.locator('tr').filter(has_text='Проценить запасные части').count()==1
   p.screenshot(path=str(root/'qa/v6-tasks-after-pricing.png'))
  ck('Automatic handoff closes preparation and creates OZCH',b1)
  def b2():
   browse_task(p,'Проценить запасные части')
   assert 'группа ОЗЧ' in p.locator('#modalLayer').inner_text()
   c(p,'[data-action="acceptCRMTask"]')
   assert 'Сотрудник ОЗЧ (учебный)' in p.locator('[data-field="task.responsible"]').input_value()
   t(p,'[data-field="task.result"]','Проверил цены, но документ ещё не записан')
   c(p,'[data-action="completeTask"]')
   assert 'ОЗЧ завершает работу' in p.locator('#statusText').inner_text()
   c(p,'[data-action="openTaskSubject"]')
   status(p,'Согласование');saveq(p)
   assert 'Перед согласованием ОЗЧ' in p.locator('#statusText').inner_text()
   c(p,'[data-tab="estimate.parts"]');t(p,'[data-item-field="parts.0.price"]','1650')
   c(p,'[data-tab="estimate.main"]');saveq(p)
   top(p,'desktop');tasknav(p)
   assert p.locator('tr').filter(has_text='Проценить запасные части').get_by_text('Выполнена').count()==1
   t_ag=p.locator('tr').filter(has_text='Согласовать КП клиенту').first
   assert 'Мастер-приёмщик учебный' in t_ag.inner_text()
   assert p.locator('tr').filter(has_text='Доработать КП после проценки ОЗЧ').count()==0
   p.screenshot(path=str(root/'qa/v6-tasks-after-ozch.png'))
  ck('OZCH task ends only after status change with filled prices, negotiation returns to original master',b2)
  ctx.close()
 def t_instant_agreement():
  p,ctx=page_new();new_auto(p);accept_auto(p)
  def c1():
   fill_quote(p);status(p,'Согласована');saveq(p)
   top(p,'desktop');tasknav(p)
   assert p.locator('tr').filter(has_text='Подготовить КП клиенту').get_by_text('Выполнена').count()==1
   assert p.locator('tr').filter(has_text='Согласовать КП клиенту').count()==0
  ck('Instant final quote closes preparation without generating client-call task',c1)
  ctx.close()
 def t_multi_quote():
  p,ctx=page_new();new_auto(p);accept_auto(p)
  def d1():
   fill_quote(p);saveq(p)
   original=p.locator('[data-field="estimate.vehicle"]').input_value()
   assert original=='КАМАЗ 65115'
   switch_quote(p)
   assert p.locator('[data-field="estimate.counterparty"]').input_value()==''
   chooser(p,'estimate.counterparty','СеверТранс');chooser(p,'estimate.vehicle','МАЗ 5440')
   p.locator('[data-field="estimate.payment"]').select_option('с НДС')
   c(p,'[data-tab="estimate.works"]');c(p,'[data-action="add:works"]');t(p,'[data-item-field="works.0.name"]','Диагностика тормозной системы');t(p,'[data-item-field="works.0.quantity"]','1')
   c(p,'[data-tab="estimate.main"]');saveq(p)
   assert p.locator('[data-field="estimate.vehicle"]').input_value()=='МАЗ 5440'
   c(p,'[data-tab="estimate.linked"]')
   assert p.locator('tr[data-row^="quote:"]').count()>=2
   p.locator('tr[data-row="quote:КП-АВТО-00001"]').click()
   assert p.locator('[data-field="estimate.vehicle"]').input_value()==original
   c(p,'[data-tab="estimate.parts"]')
   assert p.locator('[data-item-field="parts.0.name"]').input_value()=='Колодка тормозная'
   p.screenshot(path=str(root/'qa/v6-auto-quote-restored.png'))
  ck('Two quotes have independent records and lines, original quote restored by link',d1)
  ctx.close()
 def t_print():
  p,ctx=page_new();new_auto(p);accept_auto(p)
  def e1():
   c(p,'[data-action="printEstimate"]')
   assert p.locator('#modalLayer [data-action="printPicked"]').count()==4
   p.locator('#modalLayer [data-action="printPicked"]').filter(has_text='КП с печатью').first.click()
   assert 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ' in p.locator('.kp-print-sheet').inner_text()
   assert 'Колодки тормозные - замена' in p.locator('.kp-print-table').inner_text()
   assert 'Колодка тормозная' in p.locator('.kp-print-table').inner_text()
   assert 'Место печати (учебный образец)' in p.locator('.kp-print-sheet').inner_text()
   p.screenshot(path=str(root/'qa/v6-quote-print-preview.png'))
   c(p,'[data-action="sendPrintedQuote"]')
   assert p.locator('[data-field="email.attachment"]').input_value().endswith('.pdf')
   assert 'КП-АВТО-00001' in p.locator('[data-field="email.subject"]').input_value()
  ck('Four quote forms, real data in preview, educational email handoff',e1)
  ctx.close()
 def t_appointment():
  p,ctx=page_new()
  def f1():
   top(p,'event');c(p,'[data-action="create:appointment"]')
   chooser(p,'appointment.contact','Кузнецов');chooser(p,'appointment.vehicle','КАМАЗ 65115')
   import datetime
   t(p,'[data-field="appointment.date"]',(datetime.date.today()+datetime.timedelta(days=3)).isoformat())
   t(p,'[data-field="appointment.time"]','11:30');t(p,'[data-field="appointment.reason"]','Диагностика тормозной системы')
   t(p,'[data-field="appointment.counterparty"]','')
   c(p,'[data-action="save:appointment"]')
   assert 'Контрагент' in p.locator('#statusText').inner_text()
   chooser(p,'appointment.counterparty','Транслогистика')
   c(p,'[data-action="save:appointment"]')
   assert 'ЗР-00001' in p.locator('#screen').inner_text()
   c(p,'[data-action="appointmentAnswer"]');c(p,'[data-action="appointmentReply:Перенос"]')
   top(p,'desktop');tasknav(p)
   browse_task(p,'Согласовать перенос записи')
   c(p,'[data-action="acceptCRMTask"]');c(p,'[data-action="openTaskSubject"]')
   assert p.locator('[data-field="appointment.vehicle"]').input_value()=='КАМАЗ 65115'
  ck('Appointment validation requires counterparty, revisit opens matching record',f1)
  ctx.close()
 t_auto_to_ozch()
 t_instant_agreement()
 t_multi_quote()
 t_print()
 t_appointment()
 browser.close()
report={'total':len(results),'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'pageErrors':errors,'tests':results}
(root/'qa/test_v6_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY',report['passed'],'/',report['total'],'JS errors',len(errors),flush=True)
raise SystemExit(1 if report['failed'] or errors else 0)
