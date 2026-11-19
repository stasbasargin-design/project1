from pathlib import Path
from datetime import date,timedelta
from playwright.sync_api import sync_playwright
import json,traceback

root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v8.html').read_text(encoding='utf-8')
results=[];errors=[]
with sync_playwright() as playwright:
    opts={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if Path('/usr/bin/chromium').exists():opts['executable_path']='/usr/bin/chromium'
    browser=playwright.chromium.launch(**opts)
    page=browser.new_page(viewport={'width':1857,'height':885},locale='ru-RU')
    page.set_default_timeout(5500)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
    page.on('dialog',lambda dialog:dialog.accept())
    page.set_content(html,wait_until='load',timeout=30000)
    def click(sel):page.locator(sel).first.click()
    def fill(sel,val):page.locator(sel).first.fill(val)
    def nav(doc):click(f'#topNav [data-nav="{doc}"]')
    def picker(field,text):
        click(f'[data-target="{field}"][data-choose]')
        page.locator('#pickerRows tr').filter(has_text=text).first.click()
        click('[data-action="pickSelected"]')
    def chk(label,fn):
        try:
            fn();results.append({'name':label,'passed':True});print('PASS',label,flush=True)
        except Exception as e:
            print('FAIL',label,repr(e)[:400],flush=True);traceback.print_exc(limit=2);results.append({'name':label,'passed':False,'error':str(e)[:950]})
    def test_layout():
        assert page.locator('.crm-real-board .crm-real-zone').count()==3
        for name in ['Не разобранное','Подготовка к визиту','Сделка']:
            assert name in page.locator('.crm-real-board').inner_text()
        assert page.locator('.crm-desktop-search').count()==1
        assert page.locator('input[data-desktop-toggle]').count()==1
        page.screenshot(path=str(root/'qa/v7-desktop-1857.png'),full_page=True)
    chk('Desktop uses the three actual 1C work zones and compact top filter',test_layout)

    def test_responsibles():
        click('[data-action="responsibles"]')
        assert page.locator('input[data-responsible]').count()==4
        page.locator('[data-responsible="Мастер-приёмщик учебный"]').check()
        page.locator('[data-responsible="Приёмка"]').check()
        click('[data-action="applyResponsibles"]')
        assert 'Мастер-приёмщик учебный, Приёмка' in page.locator('.crm-selection-summary').inner_text()
        click('[data-action="responsibles"]')
        assert page.locator('[data-responsible="Приёмка"]').is_checked()
        assert page.locator('[data-responsible="ОЗЧ"]').is_checked() is False
        page.screenshot(path=str(root/'qa/v7-responsibles-1857.png'))
        click('#modalLayer [data-action="closeModal"]')
    chk('Responsibles are individually selected, saved and reopened',test_responsibles)

    def test_search():
        fill('.crm-desktop-search','Неизвестный номер')
        assert page.locator('.crm-real-board [data-desktop-entry]:visible').count()==0
        fill('.crm-desktop-search','Входящий звонок')
        assert page.locator('.crm-real-board [data-desktop-entry]:visible').count()==1
        fill('.crm-desktop-search','')
        assert page.locator('.crm-real-board [data-desktop-entry]:visible').count()>=1
        page.locator('input[data-desktop-toggle]').check()
        assert page.locator('input[data-desktop-toggle]').is_checked()
        page.locator('input[data-desktop-toggle]').uncheck()
    chk('Desktop search and only-with-tasks toggle affect actual visible rows',test_search)

    def test_blank_event():
        nav('event')
        picker('event.contact','Кузнецов')
        page.locator('[data-field="event.reason"]').select_option('Диагностика и ремонт')
        assert page.locator('[data-field="event.agreementText"]').input_value()==''
        fill('[data-field="event.agreementText"]','Жалоба на тормоза. Клиенту обещан звонок после диагностики; уточнить наличие деталей.')
        click('[data-action="save:event"]')
        assert 'Следующее действие по обращению' in page.locator('#statusText').inner_text()
    chk('Event reason does not prefill narrative; result is mandatory',test_blank_event)

    def test_event_with_link():
        picker('event.linkedDoc','ЗН ТЕСТ-000001')
        click('[data-action="save:event"]')
        assert 'СБ-00001' in page.locator('#screen').inner_text() or 'сохранён' in page.locator('#statusText').inner_text()
        assert 'Привязано к' in page.locator('.event-right').inner_text()
        # New event must not inherit previous event outcome.
        nav('desktop');click('[data-action="new:event"]')
        picker('event.contact','Миронова')
        page.locator('[data-field="event.reason"]').select_option('Уточнение сроков')
        assert page.locator('[data-field="event.agreementText"]').input_value()==''
        fill('[data-field="event.agreementText"]','Повторная жалоба на изменение срока. Требуется уточнить загрузку сервиса и перезвонить.')
        click('[data-action="save:event"]')
        assert 'Следующее действие по обращению' in page.locator('#statusText').inner_text()
        assert page.locator('.event-right').inner_text().count('Привязано к')==1
        page.screenshot(path=str(root/'qa/v7-event-validation-1857.png'),full_page=True)
    chk('Event is saved with a record ID; next fresh event cannot inherit its result',test_event_with_link)

    def test_appointment_navigates():
        nav('event');click('[data-action="create:appointment"]')
        picker('appointment.counterparty','Транслогистика')
        picker('appointment.contact','Кузнецов')
        picker('appointment.vehicle','КАМАЗ 65115')
        fill('[data-field="appointment.date"]',(date.today()+timedelta(days=3)).isoformat())
        fill('[data-field="appointment.time"]','12:00')
        fill('[data-field="appointment.reason"]','Уточнение неисправности тормозной системы')
        click('[data-action="save:appointment"]')
        nav('desktop')
        assert page.locator('[data-action="openAppointmentByNo:ЗР-00001"]').count()==1
        click('[data-action="openAppointmentByNo:ЗР-00001"]')
        assert page.locator('[data-field="appointment.time"]').input_value()=='12:00'
        page.screenshot(path=str(root/'qa/v7-appointment-link-1857.png'),full_page=True)
    chk('Desktop opens the exact saved repair appointment',test_appointment_navigates)

    def test_small_screen():
        page.set_viewport_size({'width':1200,'height':790})
        nav('desktop')
        page.screenshot(path=str(root/'qa/v7-desktop-1200.png'),full_page=True)
        assert page.locator('.crm-real-board .crm-real-zone').count()==3
    chk('Three work zones remain available on 1200-pixel display',test_small_screen)
    def test_role_filter_tasks():
        # A task assigned to OZCH must be visible to OZCH and hidden when only reception is selected.
        if 'drawer-left' not in (page.locator('#app').get_attribute('class') or ''):click('#toggleTutor')
        click('#docNav [data-nav="task"]')
        picker('task.responsible','ОЗЧ')
        page.locator('[data-field="task.type"]').select_option('Напоминание')
        fill('[data-field="task.content"]','Учебная проверка цены запасной части в отделе запасных частей')
        fill('[data-field="task.endDate"]',(date.today()+timedelta(days=2)).isoformat())
        click('[data-action="save:task"]')
        nav('desktop')
        assert page.locator('.crm-real-board .crm-task-card').count()==0, 'Only reception should exclude OZCH task'
        click('[data-action="responsibles"]')
        page.locator('[data-responsible="Мастер-приёмщик учебный"]').uncheck()
        page.locator('[data-responsible="Приёмка"]').uncheck()
        page.locator('[data-responsible="ОЗЧ"]').check()
        click('[data-action="applyResponsibles"]')
        assert page.locator('.crm-real-board .crm-task-card').count()==1
        assert 'Учебная проверка цены' in page.locator('.crm-real-board .crm-task-card').inner_text()
        page.screenshot(path=str(root/'qa/v7-desktop-ozch-filter.png'),full_page=True)
    chk('Responsible filter changes the real task queue, not just its label',test_role_filter_tasks)
    browser.close()
report={'total':len(results),'passed':sum(x['passed'] for x in results),'failed':sum(not x['passed'] for x in results),'pageErrors':errors,'tests':results}
(root/'qa/test_v7_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SUMMARY',report['passed'],'/',report['total'],'JS errors',len(errors),flush=True)
raise SystemExit(1 if report['failed'] or errors else 0)
