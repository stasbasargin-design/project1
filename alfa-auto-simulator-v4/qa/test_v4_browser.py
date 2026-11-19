from pathlib import Path
import json, traceback
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v4.html').read_text(encoding='utf-8')
results=[];errors=[]
def chk(title,fn):
 try:
  fn();results.append({'name':title,'passed':True});print('PASS',title,flush=True)
 except Exception as e:
  results.append({'name':title,'passed':False,'error':str(e)[:600]});traceback.print_exc(limit=2);print('FAIL',title,flush=True)
with sync_playwright() as p:
 launch_opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if Path('/usr/bin/chromium').exists():launch_opts['executable_path']='/usr/bin/chromium'
 browser=p.chromium.launch(**launch_opts)
 page=browser.new_page(viewport={'width':1600,'height':900},locale='ru-RU')
 page.on('pageerror',lambda x: errors.append(str(x)))
 page.on('console',lambda x: errors.append(x.text) if x.type=='error' else None)
 page.on('dialog',lambda x: x.accept())
 page.set_default_timeout(6500)
 page.set_content(html,wait_until='load',timeout=20000)
 def click(sel):page.locator(sel).first.click(timeout=5000)
 def value(sel,x):page.locator(sel).first.fill(x,timeout=5000)
 def tab(section):click(f'[data-tab="estimate.{section}"]')
 def nav(doc):
  if doc not in ('desktop','event','estimate','repair','contacts'):
   if 'drawer-left' not in (page.locator('#app').get_attribute('class') or ''):click('#toggleTutor')
   click(f'#docNav [data-nav="{doc}"]')
  else:click(f'#topNav [data-nav="{doc}"]')
 def picker(target,name):
  click(f'[data-target="{target}"][data-choose]')
  page.locator('#pickerRows tr').filter(has_text=name).first.click()
  click('[data-action="pickSelected"]')
 def test_kp_layout():
  nav('estimate');assert page.locator('[data-tab="estimate.main"]').count()==1
  assert page.locator('.kp-master-grid .kp-green').count()>=7
  assert page.locator('[data-field="estimate.counterparty"]').input_value()==''
  assert page.locator('[data-field="estimate.agreement"]').input_value()==''
  page.screenshot(path=str(root/'qa/kp-main-v4.png'))
 chk('KP matches source grouping and empty document',test_kp_layout)
 def kp_fill():
  picker('estimate.counterparty','СеверТранс')
  picker('estimate.vehicle','МАЗ 5440')
  assert page.locator('[data-field="estimate.counterparty"]').input_value()
  tab('main')
  assert page.locator('[data-field="estimate.agreement"]').input_value()
  page.locator('[data-field="estimate.payment"]').select_option('с НДС')
  tab('works')
  click('[data-action="add:works"]')
  value('[data-item-field="works.0.name"]','Колодки тормозные - замена')
  value('[data-item-field="works.0.quantity"]','1')
  value('[data-item-field="works.0.price"]','2400')
  click('[data-action="related:0"]')
  assert page.locator('[data-related-code="3501090-01"]').count()==1
  page.locator('[data-related-code="3501090-01"]').check()
  value('[data-related-qty="3501090-01"]','2')
  click('[data-action="relatedConfirm"]')
  assert page.locator('[data-item-field="parts.0.name"]').count()==1
  assert page.locator('[data-item-field="parts.0.quantity"]').input_value()=='2'
  value('[data-item-field="parts.0.price"]','6000')
  assert '14 400' in page.locator('[data-kp-total]').inner_text().replace('\u00a0',' ')
  value('[data-item-field="parts.0.supplier"]','Учебный поставщик')
  value('[data-item-field="parts.0.deliveryDate"]',(datetime.now()+timedelta(days=4)).strftime('%Y-%m-%d'))
  page.screenshot(path=str(root/'qa/kp-parts-v4.png'))
 chk('KP selection, related parts, quantities, supplier and delivery',kp_fill)
 def kp_statuses():
  tab('works')
  page.locator('[data-item-extra="works.0.agreed"]').check()
  tab('parts')
  page.locator('[data-item-extra="parts.0.clientPart"]').check()
  assert page.locator('[data-item-extra="parts.0.clientPart"]').is_checked()
  assert not page.locator('[data-item-extra="parts.0.agreed"]').is_checked()
  tab('main')
  page.locator('[data-field="estimate.status"]').select_option('Согласование')
  click('[data-action="save:estimate"]')
  assert page.locator('[data-field="estimate.status"]').input_value()=='Согласование'
  click('[data-action="pricing"]')
  value('#pricingComment','Требуется уточнить цену запасных частей и время доставки')
  click('[data-action="submitPricing"]')
 chk('KP exclusive statuses, save and OЗЧ assignment',kp_statuses)
 def repair_import():
  nav('repair');click('[data-action="importEstimate"]')
  assert page.locator('[data-repair-list="works.0.name"]').input_value()=='Колодки тормозные - замена'
  click('[data-tab="repair.materials"]')
  assert page.locator('[data-repair-list="materials.0.name"]').input_value()=='Колодка тормозная'
  click('[data-tab="repair.parts"]');assert page.locator('[data-repair-list="parts.0.name"]').count()==0
  page.screenshot(path=str(root/'qa/repair-materials-v4.png'))
 chk('Repair gets only agreed works, customer parts in proper tab',repair_import)
 def appointment_flow():
  nav('event');click('[data-action="create:appointment"]')
  assert page.locator('[data-field="appointment.contact"]').input_value()==''
  picker('appointment.counterparty','Транслогистика')
  picker('appointment.contact','Кузнецов')
  picker('appointment.vehicle','КАМАЗ 65115')
  value('[data-field="appointment.date"]',(datetime.now()+timedelta(days=3)).strftime('%Y-%m-%d'))
  value('[data-field="appointment.time"]','10:30')
  value('[data-field="appointment.reason"]','Проверка тормозной системы после жалобы на вибрацию при торможении')
  page.screenshot(path=str(root/'qa/appointment-main-v4.png'))
  click('[data-action="validateAppointment"]')
  click('[data-action="save:appointment"]')
  assert 'ЗР-00001' in page.locator('#screen').inner_text()
  click('[data-tab="appointment.history"]')
  assert page.locator('[data-row="savedappointment:0"]').count()==1
  click('[data-row="savedappointment:0"]')
  assert page.locator('[data-field="appointment.time"]').input_value()=='10:30'
  click('[data-action="appointmentToRepair"]')
  assert page.locator('[data-field="repair.vehicle"]').input_value()=='КАМАЗ 65115'
 chk('Booking: manual data, date+time, save, reopen, send to repair',appointment_flow)
 def tooltip_and_exam():
  nav('estimate');tab('main');page.locator('[data-field="estimate.payment"]').hover(timeout=5000)
  assert page.locator('.hover-tip').is_visible()
  click('#modeSwitch');assert page.locator('#modeSwitch').inner_text().find('Экзамен')>=0
  page.locator('[data-field="estimate.payment"]').hover(timeout=5000)
  assert not page.locator('.hover-tip').is_visible()
 def recommendation_to_car():
  nav('estimate');tab('works');click('[data-action="add:works"]')
  value('[data-item-field="works.1.name"]','Диагностика тормозной системы')
  value('[data-item-field="works.1.quantity"]','1')
  page.locator('[data-item-extra="works.1.recommended"]').check()
  tab('main');click('[data-action="save:estimate"]')
  nav('vehicles')
  click('[data-row="row:vehicle:v2"]');click('[data-action="openSelectedRecord"]')
  click('[data-tab="vehicle.recommend"]')
  assert 'Диагностика тормозной системы' in page.locator('#screen').inner_text()
 chk('Recommendations from KP shown on linked vehicle',recommendation_to_car)
 def quote_print_to_email():
  nav('estimate');click('[data-action="printEstimate"]')
  assert page.locator('[data-action="printPicked"]').count()==4
  page.locator('[data-action="printPicked"]').filter(has_text='КП с печатью').first.click()
  assert page.locator('[data-field="email.attachment"]').input_value().endswith('.pdf')
 chk('All four КП print variants and email handoff',quote_print_to_email)
 chk('Hover help and exam mode',tooltip_and_exam)
 def all_screens():
  for doc in ['desktop','event','task','contacts','vehicles','estimate','repair','express','max','blocked','email','appointment','progress']:
   page.evaluate('(d)=>document.querySelector(`[data-nav="${d}"]`).click()',doc)
   assert page.locator('#screen').inner_text().strip(),doc
  page.evaluate('()=>document.querySelector(`[data-nav="contacts"]`).click()')
  page.evaluate('()=>document.querySelector(`[data-action="new:counterparty"]`).click()')
  assert page.locator('[data-field="counterparty.name"]').count()==1
  page.evaluate('()=>document.querySelector(`[data-nav="vehicles"]`).click()')
  page.evaluate('()=>document.querySelector(`[data-action="new:vehicle"]`).click()')
  assert page.locator('[data-field="vehicle.vin"]').count()==1
 chk('All 15 document screens render without exceptions',all_screens)

 browser.close()
report={'total':len(results),'passed':sum(z['passed'] for z in results),'tests':results,'pageErrors':errors}
(root/'qa/test_v4_browser_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2)[:4400])
raise SystemExit(0 if report['passed']==report['total'] and not errors else 1)
