import { useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Send, Settings2, UserRound } from 'lucide-react';
import { api } from '../api';
import { Button, IconButton } from '../ui/Button';
import { ScreenHeader } from '../ui/Common';
import { useToast } from '../state/toast';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK = [
  'Сколько памяти выделить для модпака?',
  'Почему игра вылетает с модом?',
  'Чем Fabric отличается от NeoForge?',
  'Как поставить шейдеры?',
  'Как перенести мир в другую сборку?'
];

export function AssistantScreen() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ploxel.chat') ?? '[]') as Msg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    void api.invoke<boolean>('ai:available').then(setAiOn);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ploxel.chat', JSON.stringify(messages.slice(-60)));
    } catch {
      /* приватный режим — не критично */
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const answer = await api.invoke<string>('ai:chat', next.slice(-12));
      setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMessages([...next, { role: 'assistant', content: `Не удалось получить ответ: ${message}` }]);
      toast('error', 'ИИ недоступен', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen assistant">
      <ScreenHeader
        title="Помощник"
        sub="Спросите про сборки, моды, память, Java или ошибки — ответит настроенный ИИ."
        actions={
          <>
            {messages.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Eraser size={14} />}
                onClick={() => setMessages([])}
              >
                Очистить
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 size={14} />}
              onClick={() => (window.location.hash = '/settings?tab=ai')}
            >
              Настройки ИИ
            </Button>
          </>
        }
      />

      <div className="chat">
        <div className="chat__scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat__empty">
              <span className="chat__empty-icon"><Bot size={26} /></span>
              <span className="chat__empty-title">Чем помочь?</span>
              <span className="small muted">
                {aiOn
                  ? 'Задайте вопрос или выберите подсказку ниже.'
                  : 'ИИ ещё не настроен. Откройте настройки и укажите ключ или локальную модель.'}
              </span>
              {!aiOn && (
                <Button size="sm" onClick={() => (window.location.hash = '/settings?tab=ai')}>
                  Настроить ИИ
                </Button>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div className={`msg msg--${m.role}`} key={i}>
              <span className="msg__avatar">
                {m.role === 'user' ? <UserRound size={15} /> : <Bot size={15} />}
              </span>
              <div className="msg__bubble">{m.content}</div>
            </div>
          ))}
          {busy && (
            <div className="msg msg--assistant">
              <span className="msg__avatar"><Bot size={15} /></span>
              <div className="msg__bubble msg__bubble--typing">Печатает…</div>
            </div>
          )}
        </div>

        <div className="chat__quick">
          {QUICK.map((q) => (
            <button key={q} className="chip chip--button" onClick={() => send(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>

        <div className="chat__input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={aiOn ? 'Напишите вопрос…' : 'Сначала настройте ИИ'}
            disabled={!aiOn || busy}
          />
          <IconButton label="Отправить" onClick={() => send()} disabled={!aiOn || busy || !input.trim()}>
            <Send size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}