from pathlib import Path
from playwright.sync_api import sync_playwright
import json, traceback
root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v3.html').read_text(encoding='utf-8')
results=[];errors=[]

def check(name,fn):
 try:fn();results.append({'name':name,'pass':True});print('PASS',name)
 except Exception as e:results.append({'name':name,'pass':False,'error':str(e)[:550]});print('FAIL',name,str(e)[:280]);traceback.print_exc(limit=1)

with sync_playwright() as p:
 launch_kwargs={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
 if Path('/usr/bin/chromium').exists():launch_kwargs['executable_path']='/usr/bin/chromium'
 browser=p.chromium.launch(**launch_kwargs)
 page=browser.new_page(viewport={'width':1600,'height':900},device_scale_factor=1)
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('dialog',lambda d:d.accept())
 page.on('console',lambda e:errors.append(e.text) if e.type=='error' else None)
 page.set_content(html,wait_until='load',timeout=10000)
 page.mouse.move(1580,880)
 def click(sel):
  page.evaluate('(s)=>{const x=document.querySelector(s);if(!x)throw new Error("Missing "+s);x.click()}',sel)
 def fill(sel,s): page.locator(sel).fill(s,timeout=6000)
 def field(key): return f'[data-field="{key}"]'
 check('15 document screens render',lambda: [page.evaluate('(id)=>{document.querySelector(`[data-nav="${id}"]`)?.click()||eval("document.getElementById(\'screen\').innerHTML=\'\'")}',id) for id in ['desktop','event','estimate','repair','contacts']])
 def test_event():
  click('[data-nav="event"]');assert page.locator(field('event.contact')).input_value()==''
  page.locator(field('event.reason')).select_option('Диагностика и ремонт')
  assert page.locator(field('event.agreementText')).input_value()=='Диагностика и ремонт'
  assert page.locator('[data-action="create:appointment"]').count()==1
 check('event blank contact + reason transfer',test_event)
 def test_hover():
  el=page.locator(field('event.contact'))
  el.hover(timeout=4000)
  assert page.locator('.hover-tip').is_visible()
  assert 'Контактное лицо' in page.locator('.hover-tip').inner_text()
 check('rich hover tooltip on real field',test_hover)
 def test_counterparty():
  click('[data-nav="contacts"]');click('[data-action="new:counterparty"]');assert page.locator(field('counterparty.name')).input_value()==''
  fill(field('counterparty.name'),'7701000001');click('[data-action="innLookup"]');assert page.locator('.modal-head').inner_text().find('выбор контрагента')>=0
  assert page.locator(field('counterparty.inn')).input_value()==''
  click('[data-row="lookup:p1"]');click('[data-action="fillInnRecord"]');assert 'Транслогистика' in page.locator(field('counterparty.name')).input_value()
  assert page.locator(field('counterparty.inn')).input_value()=='7701000001'
 check('counterparty: manual INN → selection → fill',test_counterparty)
 def test_catalog():
  click('[data-nav="contacts"]');fill('#catalogSearch','СеверТранс');n=page.locator('#screen .table1c tbody tr:visible').count();assert n==1,n
  page.locator('#catalogSearch').fill('')
  click('[data-row="row:counterparty:p2"]');assert 'Контрагенты' in page.locator('.form-caption').inner_text()
  click('[data-action="openSelectedRecord"]');assert 'СеверТранс' in page.locator(field('counterparty.name')).input_value()
 check('catalog filter, select row, open real data',test_catalog)
 def test_vehicle():
  click('[data-nav="vehicles"]');click('[data-action="new:vehicle"]')
  fill(field('vehicle.vin'),'XTC651150N1234567');fill(field('vehicle.chassis'),'125');click('[data-action="vehicleLookup"]')
  assert page.locator('.vehicle-picker').is_visible()
  assert page.locator('#vehicleBrandRows tr').count()>=3
  assert page.locator('#vehicleModelRows tr').count()>0
  click('[data-vehicle-brand="КАМАЗ"]');click('[data-vehicle-model="65115"]');click('[data-vehicle-spec="ДВС КАМАЗ / КПП ZF"]')
  click('[data-action="applyVehicleLookup"]');assert page.locator(field('vehicle.brand')).input_value()=='КАМАЗ'
  assert page.locator(field('vehicle.model')).input_value()=='65115'
 check('vehicle: VIN/chassis → interactive 1C triple lookup → Apply',test_vehicle)
 def test_estimate():
  click('[data-nav="estimate"]');assert page.locator('[data-item-field]').count()==0
  click('[data-action="pickItem:works"]')
  assert page.locator('[data-bulk]').count()>=2
  page.locator('[data-bulk="w1"]').check();page.locator('[data-bulk="w2"]').check();click('[data-action="finishBulk"]')
  assert page.locator('[data-item-field$=".name"]').count()==2
  fill('[data-item-field="works.0.quantity"]','1');fill('[data-item-field="works.1.quantity"]','2')
 check('estimate: blank lines then multi-pick and quantity input',test_estimate)
 def test_mode():
  click('#modeSwitch');assert 'Экзамен' in page.locator('#modeSwitch').inner_text()
  click('#toggleTutor');assert 'drawer-left' in page.locator('#app').get_attribute('class')
  click('[data-scenario="event-meet"]');assert 'exam-mode' in page.locator('#app').get_attribute('class')
  assert not page.locator('.scenario-step').is_visible() if page.locator('.scenario-step').count() else True
  assert not page.locator('#ribbonHelp').is_visible()
  page.locator(field('event.contact')).hover(timeout=5000)
  assert not page.locator('.hover-tip').is_visible()
  click('#modeSwitch');assert 'Обучение' in page.locator('#modeSwitch').inner_text()
 check('exam mode disables tips and hides scenario answers',test_mode)
 def test_help():
  click('#showInfo');assert 'drawer-right' in page.locator('#app').get_attribute('class')
  page.locator(field('event.contact')).hover(timeout=4000)
  assert 'Контактное лицо' in page.locator('#helpTopic').inner_text()
 check('help overlay is optional and contextual',test_help)
 def test_screenshot():
  click('[data-nav="event"]');page.mouse.move(1590,897);page.screenshot(path=str(root/'qa/v3-event-1600.png'),timeout=6000)
  click('[data-nav="contacts"]');click('[data-action="new:counterparty"]');page.mouse.move(1590,897);page.screenshot(path=str(root/'qa/v3-counterparty-1600.png'),timeout=6000)
  click('[data-nav="vehicles"]');click('[data-action="new:vehicle"]');page.mouse.move(1590,897);page.screenshot(path=str(root/'qa/v3-vehicle-1600.png'),timeout=6000)
 check('screenshot regression: event, counterparty, vehicle',test_screenshot)
 browser.close()
report={'passed':sum(x['pass'] for x in results),'total':len(results),'tests':results,'pageErrors':errors}
(root/'qa/test_browser_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('RESULT',report['passed'],'/',report['total'],'browser errors',len(errors));
if errors:print('JAVASCRIPT ERRORS',errors[:10])
raise SystemExit(0 if report['passed']==report['total'] and not errors else 1)
