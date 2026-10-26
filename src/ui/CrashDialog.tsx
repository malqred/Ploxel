import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Download, FolderOpen, RotateCcw, Terminal, Wrench } from 'lucide-react';
import { api } from '../api';
import { Button } from './Button';
import { Checkbox } from './Controls';
import { ConfirmDialog, Modal } from './Overlay';
import { useToast } from '../state/toast';
import type { CrashAnalysis, CrashCause } from '../../shared/types';

const CONFIDENCE: Record<CrashCause['confidence'], string> = {
  high: 'высокая уверенность',
  medium: 'средняя уверенность',
  low: 'низкая уверенность'
};

type AiPhase = 'hidden' | 'preview' | 'sending' | 'answer';

/** Окно после краша: причины по правилам, выбор исправлений и ИИ по кнопке. */
export function CrashDialog({
  instanceId,
  exitCode,
  onClose
}: {
  instanceId: string | null;
  exitCode?: number | null;
  onClose: () => void;
}) {
  const [analysis, setAnalysis] = useState<CrashAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [applying, setApplying] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [aiPhase, setAiPhase] = useState<AiPhase>('hidden');
  const [aiPreview, setAiPreview] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!instanceId) return;
    setAnalysis(null);
    setSelected(new Set());
    setBackups([]);
    setLoading(true);
    void api.invoke<boolean>('ai:available').then(setAiEnabled);
    api
      .invoke<CrashAnalysis>('crash:analyze', instanceId, exitCode ?? null)
      .then(setAnalysis)
      .catch((e) => toast('error', 'Не удалось разобрать лог', e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [instanceId, exitCode]);

  const causes = analysis?.causes ?? [];
  const fixable = useMemo(() => causes.filter((c) => c.fix), [causes]);

  const toggle = (cause: CrashCause, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(cause.id);
      else next.delete(cause.id);
      return next;
    });
  };

  const buildLog = async () => {
    if (!instanceId) return '';
    const lines = await api.invoke<{ ts: number; line: string }[]>('logs:get', instanceId);
    return lines.map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`).join('\n');
  };

  const askAi = async () => {
    const log = await buildLog();
    const clean = await api.invoke<string>('ai:preview', log.slice(-20000));
    setAiPreview(clean);
    setAiAnswer('');
    setAiPhase('preview');
  };

  const sendAi = async () => {
    setAiPhase('sending');
    try {
      const log = await buildLog();
      const res = await api.invoke<{ answer: string }>('ai:explain', log.slice(-20000));
      setAiAnswer(res.answer);
      setAiPhase('answer');
    } catch (e) {
      setAiAnswer(`Не удалось получить ответ: ${e instanceof Error ? e.message : String(e)}`);
      setAiPhase('answer');
    }
  };

  const exportLog = async () => {
    if (!instanceId) return;
    const file = await api.dialog.save('Сохранить лог', `${instanceId}-crash.log`, [
      { name: 'Лог', extensions: ['log', 'txt'] }
    ]);
    if (!file) return;
    await api.invoke('logs:export', instanceId, file);
    toast('success', 'Лог сохранён', String(file));
  };

  const apply = async () => {
    if (!instanceId) return;
    setApplying(true);
    try {
      const chosen = causes.filter((c) => selected.has(c.id));
      const results = await api.invoke<
        { causeId: string; status: string; detail?: string; backupPath?: string }[]
      >('crash:apply', instanceId, chosen);
      const applied = results.filter((r) => r.status === 'applied').length;
      const manual = results.filter((r) => r.status !== 'applied').length;
      const dirs = [
        ...new Set(
          results
            .map((r) => r.backupPath)
            .filter((p): p is string => !!p)
            .map((p) => p.replace(/[\\/][^\\/]+$/, ''))
        )
      ];
      setBackups(dirs);
      toast(
        applied ? 'success' : 'warning',
        applied ? `Исправлено: ${applied}` : 'Изменений не внесено',
        manual ? `Требуют меню/ручных действий: ${manual}` : undefined
      );
      if (applied) {
        const again = await api.invoke<CrashAnalysis>('crash:analyze', instanceId, exitCode ?? null);
        setAnalysis(again);
        setSelected(new Set());
      }
    } catch (e) {
      toast('error', 'Не удалось применить исправления', e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
      setConfirm(false);
    }
  };

  const rollback = async (dir: string) => {
    if (!instanceId) return;
    try {
      const res = await api.invoke<{ restored: string[]; warnings: string[] }>('crash:rollback', instanceId, dir);
      toast('success', 'Изменения отменены', `Восстановлено файлов: ${res.restored.length}`);
      setBackups((prev) => prev.filter((b) => b !== dir));
    } catch (e) {
      toast('error', 'Откат не удался', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      open={!!instanceId}
      onClose={onClose}
      wide
      title={causes.length ? `Игра упала: найдено причин — ${causes.length}` : 'Игра завершилась с ошибкой'}
      actions={
        <>
          <Button variant="secondary" icon={<Terminal size={15} />} onClick={() => {
            window.location.hash = `/console?instance=${instanceId}`;
            onClose();
          }}>
            Консоль
          </Button>
          <Button variant="secondary" icon={<Download size={15} />} onClick={exportLog}>
            Выгрузить лог
          </Button>
          <Button variant="purple" icon={<Bot size={15} />} onClick={askAi}>
            Объяснить с ИИ
          </Button>
          {fixable.length > 0 && (
            <Button
              icon={<Wrench size={15} />}
              disabled={selected.size === 0}
              onClick={() => setConfirm(true)}
            >{`Исправить выбранное (${selected.size})`}</Button>
          )}
        </>
      }
    >
      {loading && (
        <div className="col" style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 76 }} />
          ))}
        </div>
      )}

      {!loading && causes.length === 0 && (
        <>
          <div className="crash-empty">
            <AlertTriangle size={20} />
            <div>
              <strong>Причина не распознана</strong>
              <p className="small muted">
                Можно отправить лог ИИ-помощнику (после предпросмотра) или сохранить файл и разобраться вручную.
              </p>
            </div>
          </div>
          {!aiEnabled && (
            <div className="notice">
              <div>
                ИИ не настроен. Настройки → ИИ-помощник: подойдёт локальная модель или бесплатный ключ.
              </div>
            </div>
          )}
        </>
      )}

      {!loading && causes.length > 0 && (
        <div className="crash-causes">
          {causes.map((cause) => (
            <div className="crash-cause" key={cause.id} data-fixable={cause.fix ? 'true' : undefined}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                {cause.fix ? (
                  <Checkbox
                    checked={selected.has(cause.id)}
                    onChange={(v) => toggle(cause, v)}
                    label={cause.title}
                  />
                ) : (
                  <span className="crash-cause__dot" />
                )}
                <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
                  <span className="crash-cause__title">{cause.title}</span>
                  <span className="small soft">{cause.explanation}</span>
                  <span className="tiny muted">{`Что изменится: ${cause.change}`}</span>
                  <span className="tiny muted">{`Риски: ${cause.risks}`}</span>
                  {cause.evidence.length > 0 && (
                    <div className="crash-evidence">
                      {cause.evidence.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`chip ${cause.confidence === 'high' ? 'chip--accent' : cause.confidence === 'low' ? '' : 'chip--purple'}`}>
                  {CONFIDENCE[cause.confidence]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {backups.length > 0 && (
        <div className="crash-backups">
          {backups.map((dir) => (
            <div className="row" key={dir} style={{ gap: 8 }}>
              <span className="tiny muted truncate grow">{dir}</span>
              <Button size="sm" variant="neutral" icon={<FolderOpen size={13} />} onClick={() => api.shell.openPath(dir)}>
                Открыть
              </Button>
              <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} onClick={() => rollback(dir)}>
                Откатить
              </Button>
            </div>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <p className="tiny muted">
          Будет применено только отмеченное. Перед изменениями лаунчер сделает резервную копию.
        </p>
      )}

      <ConfirmDialog
        open={confirm}
        title="Применить исправления?"
        confirmLabel="Применить"
        onCancel={() => setConfirm(false)}
        onConfirm={apply}
      >
        <p>{`Будет применено пунктов: ${selected.size}. Лаунчер сделает резервную копию изменяемых файлов — откатить можно будет здесь же.`}</p>
        <ul className="crash-fix-list">
          {causes
            .filter((c) => selected.has(c.id))
            .map((c) => (
              <li key={c.id}>{c.change}</li>
            ))}
        </ul>
      </ConfirmDialog>

      <Modal
        open={aiPhase !== 'hidden'}
        onClose={() => setAiPhase('hidden')}
        wide
        title="ИИ-помощник"
        actions={
          aiPhase === 'preview' ? (
            <>
              <Button variant="secondary" onClick={() => setAiPhase('hidden')}>
                Отмена
              </Button>
              <Button onClick={sendAi} icon={<Bot size={15} />} loading={applying}>
                Отправить ИИ
              </Button>
            </>
          ) : aiPhase === 'answer' ? (
            <Button variant="secondary" onClick={() => setAiPhase('hidden')}>
              Закрыть
            </Button>
          ) : undefined
        }
      >
        {aiPhase === 'preview' && (
          <>
            <p className="small muted">
              Проверьте, что уходит. Ник, пути, токены, IP и UUID уже заменены на метки.
            </p>
            <div className="ai-preview">{aiPreview}</div>
          </>
        )}
        {aiPhase === 'sending' && (
          <div className="row" style={{ gap: 10 }}>
            <span className="btn__spinner" style={{ color: 'var(--accent)' }} /> Анализирую…
          </div>
        )}
        {aiPhase === 'answer' && <div className="ai-answer">{aiAnswer}</div>}
      </Modal>
    </Modal>
  );
}