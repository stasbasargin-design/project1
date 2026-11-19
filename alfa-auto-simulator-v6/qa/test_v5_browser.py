from pathlib import Path
from datetime import date,timedelta
import json,traceback
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html=(root/'AlfaAuto_Trainer_v6.html').read_text(encoding='utf-8')
results=[];page_errors=[]

def check(name,fn):
    try:
        fn();results.append({'test':name,'passed':True});print('PASS',name,flush=True)
    except Exception as exc:
        results.append({'test':name,'passed':False,'error':str(exc)[:1000]});print('FAIL',name,str(exc)[:350],flush=True);traceback.print_exc(limit=2)

with sync_playwright() as p:
    kw={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    if Path('/usr/bin/chromium').exists():kw['executable_path']='/usr/bin/chromium'
    browser=p.chromium.launch(**kw)
    ctx=browser.new_context(viewport={'width':1600,'height':900},locale='ru-RU',accept_downloads=True)
    def new_page():
        page=ctx.new_page()
        page.on('pageerror',lambda e:page_errors.append(str(e)))
        page.on('console',lambda m:page_errors.append(m.text) if m.type=='error' else None)
        page.on('dialog',lambda d:d.accept())
        page.set_default_timeout(6500)
        page.set_content(html,wait_until='load',timeout=20000)
        return page
    def click(page,s): page.locator(s).first.click(timeout=5500)
    def fill(page,s,v): page.locator(s).first.fill(v,timeout=5500)
    def count_in_queue(page,txt):
        click(page,'[data-action="goto:tasks"]') if page.locator('[data-action="goto:tasks"]').count() else click(page,'#toggleTutor')
        if page.locator('#docNav [data-nav="tasks"]').count():click(page,'#docNav [data-nav="tasks"]')
        return page.locator('[data-row^="taskqueue:"]').filter(has_text=txt).count()
    page=new_page()
    def a1():
        assert page.locator('#screen .crm-task-card').count()==0
        click(page,'[data-action="simulateDefect"]')
        assert page.locator('#modalLayer').get_by_text('ЗН ТЕСТ-000001').count()>0
        click(page,'[data-action="createDefectEvent"]')
        assert page.locator('#screen .crm-task-card').count()==1
        assert 'Подготовить КП' in page.locator('#screen .crm-task-card').inner_text()
        page.screenshot(path=str(root/'qa/desktop-tasks-v5.png'),full_page=True)
    check('System defect event creates a real group task in the training desktop',a1)
    def a2():
        click(page,'.crm-task-card')
        assert page.locator('#modalLayer').get_by_text('Принять документ к исполнению?').count()>0
        click(page,'#modalLayer [data-action="closeModal"]')
        assert page.locator('#screen .crm-task-card').count()==1
        click(page,'.crm-task-card')
        click(page,'[data-action="acceptCRMTask"]')
        assert page.locator('#screen').get_by_text('Мастер-приёмщик учебный').count()>0
        assert page.locator('[data-action="openTaskSubject"]').count()==1
        page.screenshot(path=str(root/'qa/accepted-crm-task-v5.png'),full_page=True)
    check('Group task requires confirmation and changes responsible on acceptance',a2)
    def a3():
        click(page,'[data-action="openTaskSubject"]')
        assert page.locator('[data-field="estimate.counterparty"]').input_value()=='ООО «Транслогистика»'
        assert page.locator('[data-field="estimate.vehicle"]').input_value()=='КАМАЗ 65115'
        click(page,'[data-tab="estimate.works"]')
        assert page.locator('[data-item-field="works.0.name"]').input_value()=='Колодки тормозные - замена'
        click(page,'[data-tab="estimate.parts"]')
        assert page.locator('[data-item-field="parts.0.name"]').input_value()=='Колодка тормозная'
        click(page,'[data-tab="estimate.main"]')
        page.screenshot(path=str(root/'qa/auto-kp-v5.png'),full_page=True)
    check('Task subject opens the system-generated quote with training defect data',a3)
    def a4():
        page.locator('[data-field="estimate.payment"]').select_option('с НДС')
        page.locator('[data-field="estimate.status"]').select_option('Согласование')
        click(page,'[data-action="save:estimate"]')
        click(page,'[data-nav="desktop"]')
        assert page.locator('.crm-task-card').filter(has_text='Согласовать КП').count()==1
        click(page,'[data-action="goto:tasks"]')
        table=page.locator('#screen .table1c tbody')
        assert table.get_by_text('Автоматически закрыта').count()==1
        assert table.get_by_text('Согласовать КП клиенту').count()==1
    check('Quote status transition closes preparation and creates one agreement task',a4)
    def a5():
        click(page,'[data-action="simulateDefect"]')
        click(page,'[data-action="createDefectEvent"]')
        assert page.locator('#screen .table1c tbody tr').filter(has_text='Ознакомиться с повторной').count()==1
        click(page,'[data-action="simulateDefect"]')
        click(page,'[data-action="createDefectEvent"]')
        assert page.locator('#screen .table1c tbody tr').filter(has_text='Ознакомиться с повторной').count()==1
    check('Repeat defect does not generate duplicate quote or duplicate open review task',a5)
    # Parallel independent page for OZCH flow
    page2=new_page()
    def b1():
        click(page2,'[data-action="simulateDefect"]');click(page2,'[data-action="createDefectEvent"]')
        click(page2,'.crm-task-card');click(page2,'[data-action="acceptCRMTask"]');click(page2,'[data-action="openTaskSubject"]')
        click(page2,'[data-action="pricing"]')
        fill(page2,'#pricingComment','Уточнить стоимость тормозных колодок и срок поставки по учебной заявке')
        click(page2,'[data-action="submitPricing"]')
        click(page2,'[data-nav="desktop"]')
        assert page2.locator('.crm-task-card').filter(has_text='Проценить запасные части').count()==1
        click(page2,'.crm-task-card')
        assert page2.locator('#modalLayer').get_by_text('группа ОЗЧ').count()>0
        click(page2,'[data-action="acceptCRMTask"]')
        assert page2.locator('[data-field="task.result"]').count()==1
        fill(page2,'[data-field="task.result"]','Цена уточнена; срок поставки согласован с учебным поставщиком.')
        click(page2,'[data-action="completeTask"]')
        assert 'ОЗЧ завершает работу' in page2.locator('#statusText').inner_text()
        click(page2,'[data-action="openTaskSubject"]')
        page2.locator('[data-field="estimate.status"]').select_option('Согласование')
        click(page2,'[data-tab="estimate.parts"]')
        fill(page2,'[data-item-field="parts.0.price"]','2300')
        click(page2,'[data-tab="estimate.main"]')
        click(page2,'[data-action="save:estimate"]')
        click(page2,'[data-nav="desktop"]')
        click(page2,'[data-action="goto:tasks"]')
        assert page2.locator('#screen .table1c tbody').get_by_text('Согласовать КП клиенту по дефектовке').count()==1
        assert 'Выполнена' in page2.locator('tr[data-row^="taskqueue:"]').filter(has_text='Проценить запасные части').inner_text()
        page2.screenshot(path=str(root/'qa/ozch-return-v6.png'),full_page=True)
    check('Auto-KP: OZCH changes status; system returns negotiation to original master',b1)
    page3=new_page()
    def c1():
        click(page3,'[data-nav="event"]');click(page3,'[data-action="create:appointment"]')
        def picker(field,needle):
            click(page3,f'[data-target="appointment.{field}"][data-choose]')
            click(page3,'#pickerRows tr:has-text("'+needle+'")')
            click(page3,'[data-action="pickSelected"]')
        picker('counterparty','Транслогистика')
        picker('contact','Кузнецов')
        picker('vehicle','КАМАЗ 65115')
        fill(page3,'[data-field="appointment.date"]',(date.today()+timedelta(days=2)).isoformat())
        fill(page3,'[data-field="appointment.time"]','10:30')
        fill(page3,'[data-field="appointment.reason"]','Диагностика тормозной системы по жалобе клиента')
        click(page3,'[data-action="save:appointment"]')
        click(page3,'[data-action="appointmentAnswer"]')
        click(page3,'[data-action="appointmentReply:Перенос"]')
        assert 'Требует переноса' in page3.locator('#screen').inner_text()
        click(page3,'[data-nav="desktop"]')
        assert page3.locator('.crm-task-card').filter(has_text='Согласовать перенос записи').count()==1
        click(page3,'.crm-task-card')
        click(page3,'[data-action="acceptCRMTask"]')
        assert page3.locator('[data-field="task.result"]').count()==1
        page3.screenshot(path=str(root/'qa/appointment-change-task-v5.png'),full_page=True)
    check('Appointment reschedule generates a group task which can be accepted',c1)
    page4=new_page()
    def d1():
        click(page4,'[data-nav="event"]')
        click(page4,'[data-action="cancelEvent"]')
        click(page4,'[data-action="confirmCancelEvent"]')
        click(page4,'[data-nav="desktop"]')
        assert page4.locator('.crm-task-card').filter(has_text='Проверить отмену события').count()==1
    check('Cancelled event creates real training follow-up CRM task',d1)
    page5=new_page()
    def e1():
        click(page5,'#toggleTutor');click(page5,'#docNav [data-nav="task"]')
        click(page5,'[data-target="task.responsible"][data-choose]')
        click(page5,'#pickerRows tr:has-text("Приёмка")')
        click(page5,'[data-action="pickSelected"]')
        page5.locator('[data-field="task.type"]').select_option('Напоминание')
        fill(page5,'[data-field="task.content"]','Проверить обратный звонок клиенту после уточнения деталей ремонта')
        fill(page5,'[data-field="task.endDate"]',(date.today()+timedelta(days=3)).isoformat())
        click(page5,'[data-action="save:task"]')
        click(page5,'[data-nav="desktop"]')
        assert page5.locator('.crm-task-card').count()==1
    check('Manually saved CRM task appears on desktop and is not only a success toast',e1)
    page6=new_page()
    def f1():
        click(page6,'[data-action="simulateDefect"]');click(page6,'[data-action="createDefectEvent"]')
        click(page6,'.crm-task-card');click(page6,'[data-action="acceptCRMTask"]');click(page6,'[data-action="openTaskSubject"]')
        page6.locator('[data-field="estimate.payment"]').select_option('с НДС')
        page6.locator('[data-field="estimate.status"]').select_option('Согласование')
        click(page6,'[data-action="save:estimate"]')
        click(page6,'[data-nav="desktop"]')
        click(page6,'.crm-task-card')
        assert page6.locator('[data-field="task.result"]').count()==1
        fill(page6,'[data-field="task.result"]','Клиент согласен с предложенными работами и стоимостью.')
        click(page6,'[data-action="completeTask"]')
        assert 'Укажите фактический результат согласования в статусе КП' in page6.locator('#statusText').inner_text()
        click(page6,'[data-action="openTaskSubject"]')
        page6.locator('[data-field="estimate.status"]').select_option('Согласована')
        click(page6,'[data-action="save:estimate"]')
        click(page6,'#toggleTutor');click(page6,'#docNav [data-nav="tasks"]')
        # reopen original agreement task; no longer requires group acceptance
        page6.locator('tr[data-row^="taskqueue:"]').filter(has_text='Согласовать КП клиенту').first.click()
        fill(page6,'[data-field="task.result"]','Клиент подтвердил калькуляцию, согласованные позиции отмечены.')
        click(page6,'[data-action="completeTask"]')
        assert 'Выполнена' in page6.locator('#screen .table1c tbody tr').filter(has_text='Согласовать КП клиенту').inner_text()
    check('Agreement task cannot finish until quote has factual final status',f1)
    page7=new_page()
    def f2():
        click(page7,'[data-nav="event"]');click(page7,'[data-action="create:appointment"]')
        for field,text in [('counterparty','СеверТранс'),('contact','Миронова'),('vehicle','МАЗ 5440')]:
            click(page7,f'[data-target="appointment.{field}"][data-choose]')
            page7.locator('#pickerRows tr').filter(has_text=text).first.click()
            click(page7,'[data-action="pickSelected"]')
        fill(page7,'[data-field="appointment.date"]',(date.today()+timedelta(days=5)).isoformat())
        fill(page7,'[data-field="appointment.time"]','14:20')
        fill(page7,'[data-field="appointment.reason"]','Проверить неисправность пневмосистемы')
        click(page7,'[data-action="save:appointment"]')
        click(page7,'[data-action="appointmentAnswer"]');click(page7,'[data-action="appointmentReply:Подтверждено"]')
        assert 'Подтверждено' in page7.locator('#screen').inner_text()
        click(page7,'[data-nav="desktop"]')
        assert page7.locator('.crm-task-card').count()==0
        click(page7,'[data-nav="event"]');click(page7,'[data-action="create:appointment"]')
        # new blank appointment has no record number: answer is blocked
        click(page7,'[data-action="appointmentAnswer"]')
        assert 'Сначала сохраните запись' in page7.locator('#statusText').inner_text()
    check('Confirmed visit does not trigger follow-up task and blank visit cannot be replied to',f2)
    page8=new_page()
    def f3():
        click(page8,'[data-nav="estimate"]')
        for field,text in [('counterparty','СеверТранс'),('vehicle','МАЗ 5440')]:
            click(page8,f'[data-target="estimate.{field}"][data-choose]')
            page8.locator('#pickerRows tr').filter(has_text=text).first.click()
            click(page8,'[data-action="pickSelected"]')
        page8.locator('[data-field="estimate.payment"]').select_option('с НДС')
        click(page8,'[data-tab="estimate.works"]');click(page8,'[data-action="add:works"]')
        fill(page8,'[data-item-field="works.0.name"]','Диагностика тормозной системы')
        fill(page8,'[data-item-field="works.0.quantity"]','1')
        click(page8,'[data-tab="estimate.main"]')
        page8.locator('[data-field="estimate.status"]').select_option('Согласование')
        click(page8,'[data-action="save:estimate"]')
        click(page8,'[data-nav="desktop"]')
        assert page8.locator('.crm-task-card').count()==0
    check('Manual quote never triggers automatic-defect negotiation task',f3)
    browser.close()
report={'total':len(results),'passed':sum(x['passed'] for x in results),'failed':len(results)-sum(x['passed'] for x in results),'pageErrors':page_errors,'tests':results}
(root/'qa/test_v5_browser_results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2)[:5800])
raise SystemExit(0 if report['failed']==0 and not page_errors else 1)
