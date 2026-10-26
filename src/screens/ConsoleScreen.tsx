import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../i18n';
import { AlertTriangle, ArrowDown, Bot, Download, Eraser, Play, Search, Square, Terminal } from 'lucide-react';
import { api } from '../api';
import { Button, IconButton } from '../ui/Button';
import { Select, TextField } from '../ui/TextField';
import { Tabs } from '../ui/Controls';
import { Modal } from '../ui/Overlay';
import { ScreenHeader } from '../ui/Common';
import { CrashDialog } from '../ui/CrashDialog';
import { useToast } from '../state/toast';
import type { Account, Instance, LogLine } from '../../shared/types';

type LevelFilter = 'all' | 'error' | 'warn';

function level(line: LogLine): 'error' | 'warn' | 'debug' | 'info' {
  if (/\b(ERROR|FATAL|SEVERE)\b/.test(line.line) || /Exception|Error:/i.test(line.line)) return 'error';
  if (/\bWARN(ING)?\b/i.test(line.line)) return 'warn';
  if (/\b(DEBUG|TRACE)\b/.test(line.line)) return 'debug';
  return 'info';
}

function formatTime(ts: number): string {
  return fmtTime(ts, true);
}

export function ConsoleScreen() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [running, setRunning] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [crashCode, setCrashCode] = useState<number | null>(null);
  const [crashOpen, setCrashOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [preview, setPreview] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [nick, setNick] = useState<string | undefined>();
  const logRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    void api.invoke<Instance[]>('instances:list').then((list) => {
      setInstances(list);
      const hash = window.location.hash.match(/instance=([^&]+)/);
      const fromHash = hash ? decodeURIComponent(hash[1]) : null;
      const chosen = list.find((i) => i.id === fromHash) ?? list[0];
      if (chosen) setInstanceId(chosen.id);
    });
    void api.invoke<boolean>('ai:available').then(setAiOn);
    void api.invoke<Account | null>('accounts:active').then((a) => setNick(a?.name));
  }, []);

  useEffect(() => {
    if (!instanceId) return;
    setLines([]);
    setCrashed(false);
    void api.invoke<LogLine[]>('logs:get', instanceId).then(setLines);
    void api.invoke<string[]>('launch:running').then((list) => setRunning(list.includes(instanceId)));
    const offLog = api.on('game:logs', (payload) => {
      const p = payload as { instanceId: string; lines: LogLine[] };
      if (p.instanceId === instanceId) setLines((prev) => prev.concat(p.lines).slice(-4000));
    });
    const offStart = api.on('game:started', (p) => {
      if ((p as { instanceId: string }).instanceId === instanceId) setRunning(true);
    });
    const offExit = api.on('game:exited', (p) => {
      const payload = p as { instanceId: string; crashed: boolean; code?: number | null };
      if (payload.instanceId === instanceId) {
        setRunning(false);
        setCrashed(payload.crashed);
        setCrashCode(payload.code ?? null);
      }
    });
    return () => {
      offLog();
      offStart();
      offExit();
    };
  }, [instanceId]);

  const shown = useMemo(() => {
    let list = lines;
    if (filter !== 'all') list = list.filter((l) => level(l) === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((l) => l.line.toLowerCase().includes(q));
    }
    return list.slice(-3000);
  }, [lines, filter, query]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  useEffect(() => {
    if (autoScroll) scrollToBottom();
  }, [shown, autoScroll, scrollToBottom]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
  };

  const rawText = useCallback(
    () => lines.map((l) => `[${new Date(l.ts).toISOString()}] ${l.line}`).join('\n'),
    [lines]
  );

  const explain = async () => {
    if (!aiOn) {
      toast('warning', 'ИИ не настроен', 'Добавьте API-ключ в Настройки → ИИ-помощник.');
      return;
    }
    const clean = await api.invoke<string>('ai:preview', rawText().slice(-20000), nick);
    setPreview(clean);
    setAnswer('');
    setThinking(false);
    setExplainOpen(true);
  };

  const sendToAi = async () => {
    setThinking(true);
    setAnswer('');
    try {
      const res = await api.invoke<{ preview: string; answer: string }>('ai:explain', rawText().slice(-20000), nick);
      setAnswer(res.answer);
    } catch (e) {
      setAnswer(`Не удалось получить ответ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setThinking(false);
    }
  };

  const exportLog = async () => {
    const target = await api.dialog.save('Сохранить лог', `${instanceId}-log.txt`, [
      { name: 'Текст', extensions: ['txt', 'log'] }
    ]);
    if (!target) return;
    await api.invoke('logs:export', instanceId, target);
    toast('success', 'Лог сохранён', target);
  };

  const highlight = (text: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
    );
  };

  return (
    <div className="screen" style={{ height: '100%' }}>
      <ScreenHeader
        title="Консоль"
        sub="Живой лог игры. Ошибки подсвечиваются, поиск работает по всему буферу."
        actions={
          <>
            <Select
              value={instanceId}
              options={instances.map((i) => ({ value: i.id, label: i.name, hint: i.gameVersion }))}
              onChange={setInstanceId}
              placeholder="Сборка"
              width={220}
            />
            <Button variant="secondary" icon={<Download size={15} />} onClick={exportLog} disabled={!lines.length}>
              Выгрузить
            </Button>
            <Button icon={<Bot size={16} />} onClick={explain} disabled={!lines.length}>
              Объяснить ошибку
            </Button>
          </>
        }
      />

      {crashed && (
        <div className="console__crash">
          <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
          <span className="grow">Игра завершилась с ошибкой. Лаунчер разберёт лог и предложит исправления.</span>
          <Button size="sm" onClick={() => setCrashOpen(true)}>
            Разобрать причины
          </Button>
          <Button size="sm" variant="secondary" onClick={explain}>
            Спросить ИИ
          </Button>
        </div>
      )}

      <div className="console">
        <div className="console__toolbar">
          <Tabs
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'Все' },
              { id: 'warn', label: 'Предупреждения' },
              { id: 'error', label: 'Ошибки' }
            ]}
          />
          <div style={{ flex: 1, minWidth: 180 }}>
            <span className="input-shell" style={{ height: 38 }}>
              <Search size={15} />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по логу…" />
            </span>
          </div>
          <span className="console__status">
            <span className="status-dot" data-online={running} />
            {running ? 'Игра запущена' : 'Игра не запущена'}
          </span>
          <IconButton label="Очистить" size="sm" onClick={() => api.invoke('logs:clear', instanceId).then(() => setLines([]))}>
            <Eraser size={15} />
          </IconButton>
          {running ? (
            <Button size="sm" variant="secondary" icon={<Square size={13} fill="currentColor" />} onClick={() => api.invoke('launch:stop', instanceId)}>
              Остановить
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<Play size={13} fill="currentColor" />}
              onClick={async () => {
                try {
                  await api.invoke('launch:start', instanceId);
                } catch (e) {
                  toast('error', 'Не удалось запустить', e instanceof Error ? e.message : String(e));
                }
              }}
              disabled={!instanceId}
            >
              Запустить
            </Button>
          )}
        </div>

        <div className="console__wrap">
          {shown.length === 0 ? (
            <div className="console__empty">
              <div>
                <Terminal size={28} style={{ marginBottom: 10, opacity: 0.5 }} />
                <div>{lines.length ? 'Ничего не найдено по фильтру' : 'Логов пока нет — запустите игру.'}</div>
              </div>
            </div>
          ) : (
            <div className="console__log" ref={logRef} onScroll={onScroll}>
              {shown.map((l, i) => (
                <div className="log-line" data-level={level(l)} key={`${l.ts}-${i}`}>
                  <span className="log-line__time">{formatTime(l.ts)}</span>
                  <span className="log-line__text">{highlight(l.line)}</span>
                </div>
              ))}
            </div>
          )}
          {!autoScroll && shown.length > 0 && (
            <button
              className="console__jump"
              onClick={() => {
                setAutoScroll(true);
                scrollToBottom(true);
              }}
            >
              <ArrowDown size={12} style={{ marginRight: 4 }} /> Вниз
            </button>
          )}
        </div>

        <div className="console__input">
          <div style={{ flex: 1 }}>
            <TextField
              value=""
              onChange={() => {}}
              placeholder="Команда в игру недоступна"
              disabled
              hint="Клиент Minecraft не принимает команды извне — используйте чат в игре. Это ограничение игры, а не лаунчера."
            />
          </div>
        </div>
      </div>

      <CrashDialog
        instanceId={crashOpen ? instanceId : null}
        exitCode={crashCode}
        onClose={() => setCrashOpen(false)}
      />

      <Modal
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        title="Объяснение от ИИ"
        wide
        actions={
          answer ? (
            <Button variant="secondary" onClick={() => setExplainOpen(false)}>
              Закрыть
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setExplainOpen(false)} disabled={thinking}>
                Отмена
              </Button>
              <Button onClick={sendToAi} loading={thinking}>
                Отправить ИИ
              </Button>
            </>
          )
        }
      >
        {thinking ? (
          <div className="row" style={{ gap: 10 }}>
            <span className="btn__spinner" style={{ color: 'var(--accent)' }} /> Анализирую лог…
          </div>
        ) : answer ? (
          <>
            <div className="ai-answer">{answer}</div>
            {preview && (
              <details>
                <summary className="small muted" style={{ cursor: 'pointer', marginTop: 8 }}>
                  Что было отправлено (личные данные вырезаны)
                </summary>
                <div className="ai-preview" style={{ marginTop: 8 }}>
                  {preview}
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            <p>
              Перед отправкой проверьте, что уходит на сервер ИИ. Ник, пути к папкам, токены, IP и UUID заменены
              на метки.
            </p>
            <div className="ai-preview">{preview}</div>
          </>
        )}
      </Modal>
    </div>
  );
}