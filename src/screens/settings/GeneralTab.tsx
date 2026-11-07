import { useState } from 'react';
import { MemoryBar } from '../../ui/MemoryBar';
import { FolderCog, RotateCcw } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Controls';
import { Slider } from '../../ui/Controls';
import { Select } from '../../ui/TextField';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { GameWindowField } from '../../ui/GameWindowField';
import { Row, Section } from './parts';

export function GeneralTab() {
  const { settings, info, update, reset } = useSettings();
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!settings || !info) return null;
  const g = settings.general;
  const totalGb = Math.floor(info.totalMemMb / 1024);
  const maxGb = Math.max(2, Math.min(32, totalGb - 2));
  // Новая сборка пустая: 4 ГБ хватает и ей, и лёгкому набору модов
  const recommended = Math.min(maxGb, 4);

  const patch = (next: Partial<typeof g>) => update({ general: { ...g, ...next } });

  const changeRoot = () => {
    window.location.hash = '/settings?tab=downloads';
  };

  return (
    <>
      <Section title="Общие" hint="Папка данных и поведение лаунчера.">
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
        <MemoryBar allocatedGb={g.memoryMb / 1024} />
        <Row label={`Выделение ОЗУ — ${g.memoryMb / 1024} ГБ`} hint={`На компьютере ${totalGb} ГБ ОЗУ. Для новых сборок рекомендуем ${recommended} ГБ — у каждой сборки в её настройках будет своя рекомендация по модам.`} stack>
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
        <Row label="Что делать с лаунчером" hint="«Закрыть» убирает окно, а лаунчер дожидается конца игры в фоне (для статуса в Discord и времени игры) и закрывается сам. Если игра упадёт, окно вернётся с разбором ошибки.">
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
        <Row label="Окно игры" hint="Размер окна Minecraft для сборок, где не задан свой. «Как решит игра» — обычное окно 854 × 480 или размер из настроек игры.">
          <GameWindowField value={g.gameWindow} onChange={(v) => v && patch({ gameWindow: v })} />
        </Row>
        <Row
          label="Статус в Discord"
          hint={
            info?.config.discordClientId
              ? 'Пока вы играете, в профиле Discord видно «Играет в Ploxel», версию игры и загрузчик. Discord должен быть запущен на этом компьютере.'
              : 'Недоступно: в config.json не задан discordClientId — ID приложения Discord.'
          }
        >
          <Toggle
            checked={g.discordPresence && !!info?.config.discordClientId}
            disabled={!info?.config.discordClientId}
            onChange={(v) => patch({ discordPresence: v })}
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