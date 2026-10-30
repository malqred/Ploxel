import type { BuildIssue } from './types';

/**
 * Группа пункта «Поиска неисправностей»:
 *  error    — с этим игра не запустится (нет обязательной зависимости, мод не
 *             для этой версии или загрузчика, конфликт, дубликат);
 *  update   — вышла новая версия, игра запустится и без обновления;
 *  optional — необязательная или только рекомендуемая зависимость: игра
 *             скорее всего запустится, но часть функций мода может не работать.
 */
export type BuildIssueGroup = 'error' | 'update' | 'optional';

export function buildIssueGroup(issue: Pick<BuildIssue, 'kind' | 'confidence' | 'payload'>): BuildIssueGroup {
  if (issue.kind === 'outdated') return 'update';
  if (issue.kind === 'missing' && (issue.payload.optional || issue.payload.soft || issue.confidence === 'low')) return 'optional';
  return 'error';
}
