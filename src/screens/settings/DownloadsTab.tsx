import { useSettings } from '../../state/settings';
import { Slider } from '../../ui/Controls';
import { Row, Section } from './parts';
import { StorageSection } from './StorageSection';

export function DownloadsTab() {
  const { settings, info, update } = useSettings();
  if (!settings) return null;
  const d = settings.downloads;

  const set = (patch: Partial<typeof d>) => update({ downloads: { ...d, ...patch } });

  return (
    <>
      {info && <StorageSection root={info.dataRoot} />}
      <Section title="Загрузки" hint="Общие правила для версий игры, библиотек, ассетов и модов.">
        <Row label={`Одновременных загрузок — ${d.maxConcurrent}`} hint="Больше — быстрее, но выше нагрузка на сеть и чужие серверы. Обычно достаточно 4–8." stack>
          <Slider value={d.maxConcurrent} min={1} max={16} step={1} onChange={(v) => set({ maxConcurrent: v })} />
        </Row>
        <Row label={`Ограничение скорости — ${d.speedLimitKbps ? `${d.speedLimitKbps} КБ/с` : 'без ограничения'}`} hint="0 — без ограничения. Полезно, если играете или смотрите видео одновременно." stack>
          <Slider
            value={d.speedLimitKbps}
            min={0}
            max={8000}
            step={100}
            onChange={(v) => set({ speedLimitKbps: v })}
            format={(v) => (v ? `${v} КБ/с` : 'выкл')}
          />
        </Row>
        <Row label={`Потоков на крупный файл — ${d.rangeThreads || 'выкл'}`} hint="Range-запросы ускоряют скачивание больших файлов (клиент игры). Некоторые серверы этого не поддерживают — тогда загрузка идёт одним потоком." stack>
          <Slider value={d.rangeThreads} min={0} max={8} step={1} onChange={(v) => set({ rangeThreads: v })} format={(v) => (v ? `${v}` : 'выкл')} />
        </Row>
      </Section>
    </>
  );
}