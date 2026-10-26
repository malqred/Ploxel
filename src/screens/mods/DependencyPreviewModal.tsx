import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Package } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Controls';
import { Modal } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { fmtBytes } from '../../i18n';
import type { DependencyItem, DependencyPlan, Instance } from '../../../shared/types';

export function DependencyPreviewModal({
  open,
  instance,
  source,
  projectId,
  projectName,
  iconUrl,
  versionId,
  onClose,
  onInstalled
}: {
  open: boolean;
  instance: Instance | null;
  source: 'modrinth' | 'curseforge';
  projectId: string;
  projectName: string;
  iconUrl?: string;
  versionId?: string;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [plan, setPlan] = useState<DependencyPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !instance) return;
    setLoading(true);
    setPlan(null);
    api
      .invoke<DependencyPlan>('deps:plan', instance.id, source, projectId, versionId)
      .then((p) => {
        setPlan(p);
        setSelected(new Set(p.items.filter((i) => i.selected).map((i) => i.key)));
      })
      .catch((e) => {
        toast('error', 'Не удалось построить план', e instanceof Error ? e.message : String(e));
        onClose();
      })
      .finally(() => setLoading(false));
  }, [open, instance?.id, source, projectId, versionId]);

  const items = plan?.items ?? [];
  const root = plan?.root;
  const toInstall = useMemo(
    () => items.filter((i) => selected.has(i.key) && !i.installed && !i.incompatible),
    [items, selected]
  );
  const totalSize = toInstall.reduce((n, i) => n + (i.sizeBytes ?? 0), 0);

  const toggle = (item: DependencyItem, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(item.key);
      else next.delete(item.key);
      return next;
    });
  };

  // Окно закрывается сразу: загрузка идёт в фоне, прогресс — в меню слева
  const install = async () => {
    if (!instance || !plan) return;
    setBusy(true);
    onClose();
    toast('info', `Устанавливается: ${projectName}`, 'Прогресс — в меню слева.');
    try {
      const res = await api.invoke<{ installedKeys: string[]; backupDir?: string }>(
        'deps:install',
        instance.id,
        plan,
        [...selected]
      );
      toast(
        'success',
        'Установка завершена',
        plan.warnings.length ? `Предупреждений: ${plan.warnings.length}` : `Файлов: ${res.installedKeys?.length ?? 0}`
      );
      onInstalled();
    } catch (e) {
      toast('error', 'Установка не удалась', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const conflictFor = (item: DependencyItem) =>
    plan?.conflicts.filter((c) => c.left === item.key || c.right === item.key) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Что будет установлено"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={install} loading={busy} disabled={!plan || toInstall.length === 0} icon={<Download size={15} />}>{`Установить${toInstall.length ? ` (${toInstall.length})` : ''}`}</Button>
        </>
      }
    >
      <div className="dep-root">
        {iconUrl ? <img src={iconUrl} alt="" /> : <span className="dep-root__icon"><Package size={18} /></span>}
        <div className="col" style={{ gap: 1 }}>
          <span style={{ fontWeight: 650 }}>{projectName}</span>
          <span className="tiny muted">
            {instance?.gameVersion} · {instance?.loader.kind === 'vanilla' ? 'без загрузчика' : instance?.loader.kind}
            {totalSize > 0 ? ` · ${fmtBytes(totalSize)}` : ''}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="col" style={{ gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 46 }} />
          ))}
        </div>
      ) : (
        <>
          {root?.incompatible && (
            <div className="notice">
              <AlertTriangle size={15} />
              <div>Этот мод не совместим с выбранной версией игры или загрузчиком. Установка может не сработать.</div>
            </div>
          )}

          <div className="dep-list">
            {items.map((item) => {
              const conflicts = conflictFor(item);
              return (
                <div className="dep-item" key={item.key} data-optional={item.optional ? 'true' : undefined}>
                  {item.installed || item.incompatible ? (
                    <span className="dep-item__state">
                      {item.installed ? <Check size={14} /> : <AlertTriangle size={14} />}
                    </span>
                  ) : (
                    <Checkbox
                      checked={selected.has(item.key)}
                      onChange={(v) => toggle(item, v)}
                      disabled={item.required}
                      label={item.projectName}
                    />
                  )}
                  <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 550 }} data-i18n-skip>{item.projectName}</span>
                    <span className="tiny muted">
                      {item.installed
                        ? 'уже установлен'
                        : item.depth === 0
                          ? 'выбранный мод'
                          : item.required
                            ? 'обязательная зависимость'
                            : item.optional
                              ? 'необязательная'
                              : 'зависимость'}
                      {item.versionNumber ? ` · ${item.versionNumber}` : ''}
                      {item.sizeBytes ? ` · ${fmtBytes(item.sizeBytes)}` : ''}
                    </span>
                    {conflicts.length > 0 && (
                      <span className="tiny" style={{ color: 'var(--danger)' }} data-i18n-skip>
                        {conflicts.map((c) => c.reason).join('; ')}
                      </span>
                    )}
                  </div>
                  <span className="chip" style={{ fontSize: 10 }}>
                    {item.embedded ? 'встроен' : item.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                  </span>
                </div>
              );
            })}
          </div>

          {plan?.warnings.length ? (
            <div className="col" style={{ gap: 4 }}>
              {plan.warnings.map((w, i) => (
                <span key={i} className="tiny" style={{ color: 'var(--warning)' }} data-i18n-skip>{w}</span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}