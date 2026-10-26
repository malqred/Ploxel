import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Controls';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { Row, Section } from './parts';

const PRESETS = [
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'lmstudio', label: 'LM Studio (локально)', url: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { id: 'ollama', label: 'Ollama (локально)', url: 'http://127.0.0.1:11434/v1', model: 'llama3.1' }
];

export function AiTab() {
  const { settings, update, info } = useSettings();
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    void api.invoke<boolean>('ai:hasKey').then(setHasKey);
  }, []);

  if (!settings) return null;
  const ai = settings.ai;

  const saveAi = async (patch: Partial<typeof ai>) => update({ ai: { ...ai, ...patch } });

  const saveKey = async () => {
    const ok = await api.invoke<boolean>('ai:setKey', key.trim());
    if (!ok) {
      toast('error', 'Не удалось сохранить ключ', 'Системное хранилище недоступно.');
      return;
    }
    setHasKey(!!key.trim());
    setKey('');
    toast('success', key.trim() ? 'Ключ сохранён в зашифрованном виде' : 'Ключ удалён');
  };

  const test = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const res = await api.invoke<string>('ai:test');
      setTestResult(res);
    } catch (e) {
      setTestResult(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Section title="ИИ-помощник" hint="Объясняет ошибки сборки и подсказывает моды. Работает через API-ключ, который вы вводите сами.">
        <Row
          label="Включить помощника"
          hint="Кнопка «Объяснить ошибку» появится в консоли. Без ключа она подскажет, как настроить."
        >
          <Toggle checked={settings.general.assistantEnabled} onChange={(v) => update({ general: { ...settings.general, assistantEnabled: v } })} />
        </Row>

        <div className="notice">
          <ShieldCheck size={18} />
          <div>
            <strong>Как это работает.</strong> Ключ хранится только у вас — в зашифрованном виде через Windows DPAPI.
            Запросы идут напрямую в выбранный вами сервис. Перед отправкой лог очищается от ника, путей, токенов, IP
            и UUID, а вы видите предпросмотр и подтверждаете отправку. Ключей внутри приложения нет.
          </div>
        </div>

        <Row label="Быстрые настройки" hint="Выберите сервис — адрес и модель подставятся автоматически.">
          <div className="row wrap" style={{ gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className="chip chip--button"
                onClick={() => saveAi({ provider: p.id, baseUrl: p.url, model: p.model })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Адрес API" hint="Любой OpenAI-совместимый endpoint, например локальный сервер." stack>
          <TextField value={ai.baseUrl} onChange={(v) => saveAi({ baseUrl: v })} placeholder="https://api.openai.com/v1" />
        </Row>
        <Row label="Модель" stack>
          <TextField value={ai.model} onChange={(v) => saveAi({ model: v })} placeholder="gpt-4o-mini" />
        </Row>
        <Row label="API-ключ" hint={hasKey ? 'Ключ уже сохранён. Введите новый, чтобы заменить.' : 'Для локальных моделей ключ обычно не нужен.'} stack>
          <div className="row" style={{ gap: 8, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <TextField value={key} onChange={setKey} type="password" placeholder={hasKey ? '••••••••••••' : 'sk-…'} />
            </div>
            <Button icon={<KeyRound size={15} />} onClick={saveKey} disabled={!key.trim()}>
              Сохранить
            </Button>
            {hasKey && (
              <Button
                variant="neutral"
                icon={<Trash2 size={15} />}
                onClick={async () => {
                  await api.invoke('ai:clearKey');
                  setHasKey(false);
                  toast('info', 'Ключ удалён');
                }}
              >
                Удалить
              </Button>
            )}
          </div>
        </Row>
        <div className="row" style={{ gap: 10 }}>
          <Button variant="secondary" size="sm" onClick={test} loading={testing}>
            Проверить подключение
          </Button>
          {!hasKey && !info?.config.aiKey && (
            <span className="tiny muted">Ключ не задан — функция отключена до настройки.</span>
          )}
        </div>
        {testResult && <p className="small soft" style={{ whiteSpace: 'pre-wrap' }}>{testResult}</p>}
      </Section>
    </>
  );
}