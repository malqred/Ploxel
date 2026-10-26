import { useEffect, useState } from 'react';
import { FolderSearch, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Controls';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { Row, Section } from './parts';

interface JavaInfo {
  path: string;
  major: number;
  source: string;
  label: string;
}

export function JavaTab() {
  const { settings, update } = useSettings();
  const [installs, setInstalls] = useState<JavaInfo[]>([]);
  const [custom, setCustom] = useState(settings?.java.customJavaPath ?? '');
  const [args, setArgs] = useState(settings?.java.jvmArgs ?? '');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setBusy(true);
    try {
      setInstalls(await api.invoke<JavaInfo[]>('java:list'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!settings) return null;
  const j = settings.java;

  const save = async (patch: Partial<typeof j>) => {
    await update({ java: { ...j, ...patch } });
  };

  const browse = async () => {
    const file = await api.dialog.file('Выберите java.exe', [{ name: 'Java', extensions: ['exe'] }]);
    if (!file) return;
    setCustom(file);
    await save({ customJavaPath: file });
    await load();
  };

  return (
    <>
      <Section
        title="Java"
        hint="Лаунчер находит установленные Java сам и при необходимости скачивает официальный рантайм Mojang под версию игры."
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={load} loading={busy}>
            Найти заново
          </Button>
        }
      >
        <Row label="Автоматически скачивать Java" hint="Если подходящей версии нет, лаунчер скачает официальный рантайм Mojang (Microsoft OpenJDK).">
          <Toggle checked={j.autoDownloadJava} onChange={(v) => save({ autoDownloadJava: v })} />
        </Row>
        <Row label="Своя Java" hint="Оставьте пустым для автоопределения." stack>
          <div className="row" style={{ gap: 8, width: '100%' }}>
            <div style={{ flex: 1 }}>
              <TextField value={custom} onChange={setCustom} placeholder="C:\\Program Files\\Java\\bin\\java.exe" />
            </div>
            <Button variant="secondary" icon={<FolderSearch size={15} />} onClick={browse}>
              Обзор
            </Button>
            <Button
              variant="neutral"
              onClick={async () => {
                setCustom('');
                await save({ customJavaPath: '' });
                await load();
              }}
            >
              Сброс
            </Button>
          </div>
        </Row>
        <div className="col" style={{ gap: 6 }}>
          {installs.length === 0 ? (
            <p className="small muted">Java не найдена. Включите автозагрузку — лаунчер скачает её сам.</p>
          ) : (
            installs.map((i) => (
              <div className="java-row" key={i.path}>
                <span className="chip chip--accent">Java {i.major}</span>
                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                  <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.path}</code>
                  <span className="tiny muted">
                    {i.source === 'downloaded' ? 'скачана лаунчером' : i.source === 'custom' ? 'выбрана вручную' : i.label}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Аргументы JVM" hint="Применяются ко всем сборкам, если у сборки не заданы свои. Для слабых ПК ничего менять не нужно.">
        <Row label="Дополнительные аргументы" stack>
          <TextField value={args} onChange={setArgs} placeholder="-XX:+UseG1GC" />
        </Row>
        <div className="row" style={{ gap: 8 }}>
          <Button
            size="sm"
            onClick={async () => {
              await save({ jvmArgs: args });
              toast('success', 'Аргументы JVM сохранены');
            }}
          >
            Сохранить
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setArgs('-XX:+UseG1GC');
              toast('info', 'Восстановлено стандартное значение', 'Нажмите «Сохранить».');
            }}
          >
            Значение по умолчанию
          </Button>
        </div>
        <p className="tiny muted">
          Память задаётся отдельно: Настройки → Общие (по умолчанию) и в панели каждой сборки.
        </p>
      </Section>
    </>
  );
}