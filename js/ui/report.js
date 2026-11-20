// Блок «Итоги»: неделя или месяц, сравнение с прошлым периодом, копирование текста.
import * as core from '../core.js';
import { $ } from '../dom.js';
import { periodReport, reportText } from '../report.js';
import { app, today, ui } from './context.js';
import { toast } from './notify.js';

const currentText = () =>
  reportText(periodReport(app.state.entries, today(), ui.reportKind ?? 'week'), core.formatDate);

export function renderReport() {
  const kind = ui.reportKind ?? 'week';
  $('reportWeek').setAttribute('aria-pressed', String(kind === 'week'));
  $('reportMonth').setAttribute('aria-pressed', String(kind === 'month'));
  $('reportText').textContent = currentText();
}

async function copy() {
  try {
    await navigator.clipboard.writeText(currentText());
    toast('Итог скопирован');
  } catch {
    toast('Не удалось скопировать — выдели текст и скопируй вручную');
  }
}

export function bindReport() {
  const pick = (kind) => () => {
    ui.reportKind = kind;
    renderReport();
  };
  $('reportWeek').addEventListener('click', pick('week'));
  $('reportMonth').addEventListener('click', pick('month'));
  $('reportCopy').addEventListener('click', copy);
}
