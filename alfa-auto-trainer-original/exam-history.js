/*
 * Дополнение v13.1: локальный журнал промежуточных экзаменов.
 * Не меняет логику проведения документов или форму 1С.
 * Данные остаются в браузере, автоматически во внешние системы не отправляются.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AlfaAutoExamHistory = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const MAX_ATTEMPTS = 500;
  const MAX_ERRORS = 30;
  const MAX_HINTS = 30;
  function integer(value, fallback = 0) {
    const v = Number(value);
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
  }
  function begin(stageId, totalSteps, date = new Date()) {
    return {
      id: `attempt-${date.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
      stageId: String(stageId),
      startedAt: date.toISOString(),
      totalSteps: integer(totalSteps),
      completedSteps: 0, errors: 0, hints: 0
    };
  }
  function markError(run) { if (run) run.errors = Math.min(MAX_ERRORS, integer(run.errors) + 1); return run; }
  function markHint(run) { if (run) run.hints = Math.min(MAX_HINTS, integer(run.hints) + 1); return run; }
  function completedStep(run, steps) { if (run) run.completedSteps = Math.min(run.totalSteps, integer(steps)); return run; }
  function finish(run, outcome, date = new Date()) {
    if (!run) throw new Error('Отсутствует запущенная экзаменационная попытка');
    const completed = outcome === 'Завершён';
    const score = completed ? Math.max(0, 100 - integer(run.errors) * 5 - integer(run.hints) * 2) : null;
    return {
      id: run.id, scenario: run.stageId, startedAt: run.startedAt,
      finishedAt: date.toISOString(), outcome,
      steps: integer(run.completedSteps), totalSteps: integer(run.totalSteps),
      errors: integer(run.errors), hints: integer(run.hints), score
    };
  }
  function normalizeAttempts(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && typeof item === 'object' && typeof item.scenario === 'string')
      .slice(-MAX_ATTEMPTS).map((item) => ({
        id: String(item.id || ''), scenario: String(item.scenario),
        startedAt: String(item.startedAt || ''), finishedAt: String(item.finishedAt || ''),
        outcome: String(item.outcome || 'Прерван'),
        steps: integer(item.steps), totalSteps: integer(item.totalSteps),
        errors: integer(item.errors), hints: integer(item.hints),
        score: item.score === null || item.score === undefined ? null : Math.min(100, integer(item.score))
      }));
  }
  function append(history, item) { return normalizeAttempts([...(Array.isArray(history) ? history : []), item]); }
  function quoteCell(value) {
    let cell = String(value === null || value === undefined ? '' : value);
    // Prevent formulas from running when a CSV is opened in Excel or LibreOffice.
    if (/^[\s]*[=+@-]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }
  function csv(attempts, nameForScenario = (v) => v) {
    const fields = [
      ['scenario', 'Сценарий'], ['startedAt', 'Начало'], ['finishedAt', 'Завершение'],
      ['outcome', 'Результат'], ['steps', 'Выполнено шагов'], ['totalSteps', 'Всего шагов'],
      ['errors', 'Ошибки'], ['hints', 'Подсказки'], ['score', 'Оценка из 100']
    ];
    const lines = [fields.map(([, label]) => quoteCell(label)).join(';')];
    for (const record of normalizeAttempts(attempts)) {
      lines.push(fields.map(([key]) => quoteCell(key === 'scenario' ? nameForScenario(record[key]) : record[key])).join(';'));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  return Object.freeze({ begin, markError, markHint, completedStep, finish, normalizeAttempts, append, csv, MAX_ATTEMPTS });
});
