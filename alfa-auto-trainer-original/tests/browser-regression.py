"""Browser regression on a self-contained copy of v13.1; no network or live 1C needed."""
import base64
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'index.html').read_text()
HTML = re.sub(r'<script\s+src="[^"]+"\s*></script>', '', HTML)
HTML = re.sub(r'<link\s+rel="stylesheet"\s+href="[^"]+">', '', HTML)
CSS = (ROOT / 'styles.css').read_text()

# Inline images to preserve the exact original corporate 1C screenshots.
JS = (ROOT / 'app.js').read_text()
for p in (ROOT/'assets').glob('*.png'):
    rel = 'assets/' + p.name
    raw = base64.b64encode(p.read_bytes()).decode()
    JS = JS.replace("'" + rel + "'", "'data:image/png;base64,"+raw+"'")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page = b.new_page(viewport={'width': 1680, 'height': 1000}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(HTML)
    # about:blank has an opaque origin; replace browser storage with an in-memory
    # implementation for offline unit testing without changing production source.
    page.evaluate("""() => {
      const memory = new Map();
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem(key) { return memory.has(key) ? memory.get(key) : null; },
        setItem(key, value) { memory.set(key, String(value)); },
        removeItem(key) { memory.delete(key); },
        clear() { memory.clear(); }
      }});
    }""")
    page.add_style_tag(content=CSS)
    for name in ['config.js', 'integration.js', 'exam-history.js']:
        page.add_script_tag(content=(ROOT/name).read_text())
    page.add_script_tag(content=JS)
    page.add_script_tag(content=(ROOT/'portal.js').read_text())
    assert page.locator('#portalCards .portal-card').count() == 4
    page.locator('[data-open-trainer]').first.click()
    assert page.locator('#trainerApp').is_visible()
    assert page.locator('.nav-button').count() == 12, errors
    assert 'Событие' in page.locator('#viewTitle').inner_text()
    assert page.locator('.lesson-nav').count() == 8
    assert page.locator('.exam-nav').count() == 4
    page.screenshot(path=str(ROOT/'tests'/'v13-original-preserved-preview.png'), full_page=False)
    # Previously hidden eight modules are interactive, not decorative tabs.
    page.locator('[data-nav="desktop"]').click()
    assert 'Рабочий стол первой линии CRM' in page.locator('#viewTitle').inner_text()
    page.locator('[data-nav="exam_meeting"]').click()
    assert page.locator('#stepCounter').inner_text().startswith('Шаг 1')
    # The progress panel is non-destructive and the CSV export is real.
    page.locator('#progressButton').click()
    assert page.locator('[data-modal-command="exam-history-csv"]').is_visible()
    page.locator('[data-modal-close]').last.click()
    # Wrong action on first exam step should register a mistake, not advance.
    previous = page.locator('#stepCounter').inner_text()
    page.locator('#objectScreen [data-action]').last.click(force=True)
    assert page.locator('#stepCounter').inner_text() == previous
    # Hint affects the grade; a new attempt creates an interrupted record.
    page.locator('#hintButton').click()
    page.locator('#restartButton').click()
    page.locator('#progressButton').click()
    assert 'Прерван' in page.locator('#modal').inner_text()
    with page.expect_download(timeout=3000) as info:
        page.locator('[data-modal-command="exam-history-csv"]').click()
    assert info.value.suggested_filename.endswith('.csv')
    page.locator('[data-modal-close]').last.click()
    # End-to-end KO exam: event -> CRM task -> general question -> save.
    page.locator('#trainingMode').click()
    page.locator('[data-nav="exam_ko"]').click()
    page.locator('.inline-field[data-action="event-contact"]').fill('Иванов Иван')
    page.locator('.inline-field[data-action="event-contact"]').press('Tab')
    page.locator('.inline-field[data-action="event-agreement"]').fill('Клиент просит уточнить банковские реквизиты')
    page.locator('.inline-field[data-action="event-agreement"]').press('Tab')
    page.locator('.inline-field[data-action="event-reason"]').select_option('Консультация')
    page.locator('#objectScreen button[data-action="event-create-task"]').click(force=True)
    page.locator('[data-object-field="responsible"]').select_option('Группа КО')
    page.locator('#objectScreen textarea[data-action="task-content"]').fill('КО: уточнить банковские реквизиты для договора')
    page.locator('#objectScreen textarea[data-action="task-content"]').press('Tab')
    page.locator('[data-object-field="generalQuestion"]').check()
    page.locator('[data-action="task-save"]').click()
    assert 'Сценарий завершён' in page.locator('#coachTitle').inner_text()
    page.locator('#progressButton').click()
    assert '/100' in page.locator('#modal').inner_text()
    page.locator('[data-modal-close]').last.click()
    # Conditional KO fields appear ONLY when the task is an outgoing phone call
    # assigned to the commercial department group/employee.
    page.locator('#liveMode').click()
    page.locator('[data-nav="crmTask"]').click()
    responsible = page.locator('[data-object-doc="crmTask"][data-object-field="responsible"]')
    responsible.select_option('Группа КО')
    assert page.locator('[data-object-field="dateProposed"]').is_visible()
    assert page.locator('[data-object-field="dateDesired"]').is_visible()
    page.locator('[data-object-field="generalQuestion"]').uncheck()
    page.locator('[data-object-field="dateProposed"]').fill('')
    page.locator('[data-object-field="dateDesired"]').fill('')
    page.screenshot(path=str(ROOT/'tests'/'ko-date-fields-preview.png'), full_page=False)
    page.locator('[data-action="task-save"]').click()
    assert 'предлагаемую дату' in page.locator('#toast').inner_text()
    from datetime import datetime, timedelta
    date1 = (datetime.now() + timedelta(days=2)).strftime('%d.%m.%Y 10:00')
    date2 = (datetime.now() + timedelta(days=3)).strftime('%d.%m.%Y 12:00')
    page.locator('[data-object-field="dateProposed"]').fill(date1)
    page.locator('[data-object-field="dateDesired"]').fill(date2)
    page.locator('[data-action="task-save"]').click()
    assert 'передана ответственному' in page.locator('#toast').inner_text()
    # General question relaxes dates, but still requires a meaningful content field.
    page.locator('[data-object-field="generalQuestion"]').check()
    page.locator('[data-object-field="dateProposed"]').fill('')
    page.locator('[data-object-field="dateDesired"]').fill('')
    page.locator('[data-object-field="content"]').fill('')
    page.locator('[data-action="task-save"]').click()
    assert 'поле «Содержание»' in page.locator('#toast').inner_text()
    page.locator('[data-object-field="content"]').fill('Уточнить банковские реквизиты для договора')
    page.locator('[data-action="task-save"]').click()
    assert 'передана ответственному' in page.locator('#toast').inner_text()
    assert not errors, f'JavaScript errors: {errors}'
    print('BROWSER OK: original screens, 8 modules + 4 exams, CSV, KO dates and general question, no page errors')
    b.close()
