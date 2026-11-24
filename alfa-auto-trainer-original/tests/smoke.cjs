const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

new Function(app);

const required = [
  "stage('exam_meeting'", "stage('exam_incoming'", "stage('exam_outgoing'", "stage('exam_ko'",
  "'event-create-task'", "'task-accept'", "'task-complete'",
  "'Контроль отмены события'", "'Дожим клиента'", 'eventValidationMessage',
  "'zn-quick-pick'", "'supplier-order-post'", "'warehouse-post-rso'",
  "'planning-confirm'", "'kp-status'"
];

for (const marker of required) {
  if (!app.includes(marker)) throw new Error(`Нет обязательного маркера: ${marker}`);
}

if (!app.includes('learningLessons') || !app.includes('renderBitrixKo')) throw new Error('Нет видеообучения или экрана Bitrix24 КО');
if (!css.includes('.learning-modal')) throw new Error('Нет стилей видеообучения');
if (!css.includes('.crm-task-window')) throw new Error('Нет стилей формы задачи CRM');
if (!html.includes('8 учебных модулей')) throw new Error('Не обновлён заголовок тренажёра');

const schema = JSON.parse(fs.readFileSync(path.join(root, 'integration/state.schema.json'), 'utf8'));
if (!schema.properties.documents.required.includes('crmTask')) throw new Error('crmTask отсутствует в JSON Schema');

const scenarioCount = (app.match(/stage\('exam_/g) || []).length;
if (scenarioCount !== 4) throw new Error(`Ожидалось 4 сценария, найдено ${scenarioCount}`);

console.log('SMOKE OK: сценарии, CRM-задачи, прежние этапы и JSON Schema на месте');
