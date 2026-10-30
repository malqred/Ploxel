import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox, Tabs } from '../../ui/Controls';
import { Modal } from '../../ui/Overlay';
import { EmptyState } from '../../ui/Common';
import { useToast } from '../../state/toast';
import { buildIssueGroup, type BuildIssueGroup } from '../../../shared/build-issues';
import type { BuildIssue, Instance } from '../../../shared/types';

const GROUPS: { id: BuildIssueGroup; label: string; hint: string }[] = [
  {
    id: 'error',
    label: 'Ошибки',
    hint: 'С этим игра не запустится: нет обязательной зависимости, мод не для этой версии игры или загрузчика, конфликт или дубликат.'
  },
  {
    id: 'update',
    label: 'Новые версии',
    hint: 'Для этих модов вышли обновления. Игра запустится и без них — обновляйте, если нужны исправления и новые функции.'
  },
  {
    id: 'optional',
    label: 'Необязательные зависимости',
    hint: 'Игра скорее всего запустится, но часть функций этих модов может не работать или работать некорректно.'
  }
];

const CONFIDENCE_LABEL: Record<BuildIssue['confidence'], string> = {
  high: 'точно',
  medium: 'вероятно',
  low: 'возможно'
};

const KIND_LABEL: Record<BuildIssue['kind'], string> = {
  missing: 'Не хватает зависимости',
  outdated: 'Устаревшая версия',
  conflict: 'Конфликт',
  duplicate: 'Дубликат',
  incompatible: 'Несовместимость'
};

export function BuildCheckModal({
  open,
  instance,
  onClose,
  onChanged
}: {
  open: boolean;
  instance: Instance;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [issues, setIssues] = useState<BuildIssue[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<BuildIssueGroup>('error');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const check = async () => {
    setIssues(null);
    try {
      const list = await api.invoke<BuildIssue[]>('deps:check', instance.id);
      setIssues(list);
      // Сразу отмечены только исправимые ошибки: обновления и необязательное — по желанию
      setSelected(new Set(list.filter((i) => i.fixable && buildIssueGroup(i) === 'error').map((i) => i.id)));
      setGroup((cur) => (list.some((i) => buildIssueGroup(i) === cur) ? cur : (GROUPS.find((g) => list.some((i) => buildIssueGroup(i) === g.id))?.id ?? 'error')));
    } catch (e) {
      toast('error', 'Не удалось проверить сборку', e instanceof Error ? e.message : String(e));
      setIssues([]);
    }
  };

  useEffect(() => {
    if (open) void check();
  }, [open, instance.id]);

  const shown = issues?.filter((i) => buildIssueGroup(i) === group) ?? [];
  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, issues?.filter((i) => buildIssueGroup(i) === g.id).length ?? 0])) as Record<BuildIssueGroup, number>;
  const fixable = shown.filter((i) => i.fixable);
  const allSelected = fixable.length > 0 && fixable.every((i) => selected.has(i.id));
  const someSelected = fixable.some((i) => selected.has(i.id));
  // «Выбрать все» действует только на открытую вкладку
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of fixable) {
        if (allSelected) next.delete(i.id);
        else next.add(i.id);
      }
      return next;
    });
  const groupInfo = GROUPS.find((g) => g.id === group)!;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const fix = async () => {
    setBusy(true);
    try {
      const results = await api.invoke<{ status: string; detail?: string }[]>(
        'deps:fix',
        instance.id,
        [...selected]
      );
      const applied = results.filter((r) => r.status === 'applied').length;
      const failed = results.filter((r) => r.status === 'error');
      const manual = results.filter((r) => r.status === 'manual').length;
      toast(
        applied ? 'success' : 'warning',
        applied ? `Исправлено: ${applied}` : 'Ничего не изменено',
        failed.length
          ? `Не получилось: ${failed.length}. ${failed[0].detail ?? ''}`
          : manual
            ? `Требуют ручного решения: ${manual}`
            : undefined
      );
      onChanged();
      await check();
    } catch (e) {
      toast('error', 'Не удалось исправить', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Поиск неисправностей: «${instance.name}»`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            icon={<Wrench size={15} />}
            onClick={fix}
            loading={busy}
            disabled={!issues || selected.size === 0}
          >{`Исправить выбранное (${selected.size})`}</Button>
        </>
      }
    >
      {issues === null ? (
        <div className="col" style={{ gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64 }} />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={26} />}
          title="Проблем не найдено"
          hint="Зависимости на месте, конфликтов и дубликатов нет."
        />
      ) : (
        <div className="crash-causes">
          <Tabs
            value={group}
            onChange={(g: BuildIssueGroup) => setGroup(g)}
            items={GROUPS.map((g) => ({ id: g.id, label: g.label, count: counts[g.id] }))}
          />
          <p className="small soft build-check__hint">{groupInfo.hint}</p>
          {shown.length === 0 && (
            <p className="small muted" style={{ margin: '8px 0' }}>
              {group === 'error' ? 'Ошибок нет — игра должна запуститься.' : 'Здесь пусто.'}
            </p>
          )}
          {fixable.length > 0 && (
            <div className="build-check__bar">
              <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} label="Выбрать все" />
              <button className="build-check__all" onClick={toggleAll}>
                {allSelected ? 'Снять все' : 'Выбрать все исправимые'}
              </button>
              <span className="tiny muted">{`Исправимых: ${fixable.length} из ${shown.length}. Остальное решается вручную — подсказка в каждом пункте.`}</span>
            </div>
          )}
          {shown.map((issue) => (
            <div className="crash-cause" key={issue.id} data-fixable={issue.fixable ? 'true' : undefined}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                {issue.fixable ? (
                  <Checkbox checked={selected.has(issue.id)} onChange={(v) => toggle(issue.id, v)} label={issue.title} />
                ) : (
                  <span className="build-check__manual" title="Лаунчер не может исправить это сам">
                    <AlertTriangle size={14} />
                  </span>
                )}
                <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
                  {issue.fixable ? (
                    <button className="crash-cause__title build-check__title" onClick={() => toggle(issue.id, !selected.has(issue.id))}>
                      {issue.title}
                    </button>
                  ) : (
                    <span className="crash-cause__title">{issue.title}</span>
                  )}
                  <span className="small soft">{issue.explanation}</span>
                  <span className="tiny muted">{`Что изменится: ${issue.changes}`}</span>
                  <span className="tiny muted">{`Риски: ${issue.risks}`}</span>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="chip" style={{ fontSize: 10 }}>{KIND_LABEL[issue.kind]}</span>
                    <span className="chip" style={{ fontSize: 10 }}>{CONFIDENCE_LABEL[issue.confidence]}</span>
                    {!issue.fixable && (
                      <span className="chip" style={{ fontSize: 10 }}>
                        вручную
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}