import { useState } from 'react';
import { FolderCog, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Controls';
import { Slider } from '../../ui/Controls';
import { Select } from '../../ui/TextField';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { Row, Section } from './parts';

export function GeneralTab() {
  const { settings, info, update, reset } = useSettings();
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!settings || !info) return null;
  const g = settings.general;
  const totalGb = Math.floor(info.totalMemMb / 1024);
  const maxGb = Math.max(2, Math.min(32, totalGb - 2));
  const recommended = Math.min(8, Math.max(2, Math.floor(totalGb / 2)));

  const patch = (next: Partial<typeof g>) => update({ general: { ...g, ...next } });

  const changeRoot = () => {
    window.location.hash = '/settings?tab=downloads';
  };

  return (
    <>
      <Section title="Общие" hint="Язык, папка данных и поведение лаунчера.">
        <Row label="Язык интерфейса" hint="Строки вынесены в файлы локализации; английский пока переведён частично.">
          <Select
            value={g.language}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English (частично)' }
            ]}
            onChange={(v) => patch({ language: v })}
            width={200}
          />
        </Row>
        <Row
          label="Папка данных"
          hint="Сборки, версии, ассеты и Java хранятся здесь. На вкладке «Загрузки» папку можно перенести на другой диск — вместе со всеми сборками."
        >
          <Button variant="secondary" size="sm" icon={<FolderCog size={15} />} onClick={changeRoot}>
            Перенести
          </Button>
        </Row>
        <Row label="Текущий путь">
          <code className="mono small muted" style={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {info.dataRoot}
          </code>
        </Row>
        <Row label="Открыть папку данных">
          <Button variant="neutral" size="sm" onClick={() => api.shell.openPath(info.dataRoot)}>
            Открыть
          </Button>
        </Row>
      </Section>

      <Section title="Память по умолчанию" hint="Применяется к новым сборкам. Для каждой сборки значение можно изменить отдельно.">
        <Row label={`Выделение ОЗУ — ${g.memoryMb / 1024} ГБ`} hint={`На компьютере ${totalGb} ГБ ОЗУ. Рекомендуем ${recommended} ГБ.`} stack>
          <Slider
            value={g.memoryMb / 1024}
            min={1}
            max={maxGb}
            step={1}
            onChange={(v) => patch({ memoryMb: Math.round(v) * 1024 })}
            format={(v) => `${v} ГБ`}
            marks={[
              { value: 1, label: '1 ГБ' },
              { value: recommended, label: `рекомендуем ${recommended} ГБ` },
              { value: maxGb, label: `${maxGb} ГБ` }
            ]}
          />
        </Row>
      </Section>

      <Section title="При запуске игры">
        <Row label="Что делать с лаунчером" hint="Можно оставить открытым, свернуть в трей-панель или закрыть.">
          <Select
            value={g.closeLauncherOnGameStart}
            options={[
              { value: 'keep', label: 'Оставить открытым' },
              { value: 'minimize', label: 'Свернуть' },
              { value: 'close', label: 'Закрыть' }
            ]}
            onChange={(v) => patch({ closeLauncherOnGameStart: v as typeof g.closeLauncherOnGameStart })}
            width={220}
          />
        </Row>
        <Row label="Помощник при сборке" hint="Автоматически докачивать обязательные зависимости модов и предупреждать о дубликатах.">
          <Toggle checked={g.dependencyHelper} onChange={(v) => patch({ dependencyHelper: v })} />
        </Row>
        <Row label="Показывать снапшоты" hint="Добавит тестовые версии Minecraft в списки выбора версии.">
          <Toggle checked={g.showSnapshots} onChange={(v) => patch({ showSnapshots: v })} />
        </Row>
        <Row label="Проверять обновления лаунчера" hint="При запуске лаунчер проверяет наличие новой версии.">
          <Toggle checked={g.autoUpdateLauncher} onChange={(v) => patch({ autoUpdateLauncher: v })} />
        </Row>
      </Section>

      <Section title="Сброс">
        <Row label="Вернуть настройки по умолчанию" hint="Сборки, моды и миры не затрагиваются — сбрасываются только настройки.">
          <Button variant="secondary" size="sm" icon={<RotateCcw size={15} />} onClick={() => setConfirmReset(true)}>
            Сбросить
          </Button>
        </Row>
      </Section>

      <ConfirmDialog
        open={confirmReset}
        title="Сбросить все настройки?"
        confirmLabel="Сбросить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await reset();
          setConfirmReset(false);
          toast('success', 'Настройки сброшены');
        }}
      >
        <p>Внешний вид, память, ИИ и общие параметры вернутся к значениям по умолчанию. Аккаунты и сборки останутся.</p>
      </ConfirmDialog>
    </>
  );
}