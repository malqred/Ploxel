import { Download, Upload } from 'lucide-react';
import { useSettings } from '../../state/settings';
import { Slider } from '../../ui/Controls';
import { Select } from '../../ui/TextField';
import { Button } from '../../ui/Button';
import { useToast } from '../../state/toast';
import { FONTS } from '../../theme/presets';
import { Row, Section } from './parts';

export function TypographySection() {
  const { settings, updateAppearance } = useSettings();
  if (!settings) return null;
  const a = settings.appearance;
  const font = FONTS.find((f) => f.id === a.fontId) ?? FONTS[0];

  return (
    <Section title="Шрифт и размеры" hint="Все шрифты с поддержкой кириллицы и лицензией, разрешающей встраивание (OFL 1.1).">
      <Row label="Шрифт интерфейса" hint={`${font.name} · ${font.license}`}>
        <Select
          value={a.fontId}
          options={FONTS.map((f) => ({ value: f.id, label: f.name, hint: f.kind }))}
          onChange={(v) => updateAppearance({ fontId: v })}
          width={240}
        />
      </Row>
      <div className="font-preview" style={{ fontFamily: font.stack }}>
        <div className="font-preview__title">Ploxel — сборка мечты</div>
        <div className="font-preview__body">
          Съешь же ещё этих мягких французских булок, да выпей чаю. 0123456789 · Быстрый запуск · Моды и миры
        </div>
      </div>
      <Row label={`Масштаб текста — ${Math.round(a.textScale * 100)}%`} hint="Увеличивает весь интерфейс без поломки вёрстки." stack>
        <Slider
          value={Math.round(a.textScale * 100)}
          min={80}
          max={150}
          step={5}
          onChange={(v) => updateAppearance({ textScale: v / 100 })}
          format={(v) => `${v}%`}
          marks={[{ value: 80, label: '80%' }, { value: 100, label: '100%' }, { value: 150, label: '150%' }]}
        />
      </Row>
      <Row label={`Скругление панелей — ${Math.round(a.radiusScale * 100)}%`} stack>
        <Slider
          value={Math.round(a.radiusScale * 100)}
          min={0}
          max={160}
          step={5}
          onChange={(v) => updateAppearance({ radiusScale: v / 100 })}
          format={(v) => `${v}%`}
        />
      </Row>
      <Row label={`Прозрачность панелей — ${Math.round(a.panelOpacity * 100)}%`} hint="Ниже 70% панели становятся просвечивающими." stack>
        <Slider
          value={Math.round(a.panelOpacity * 100)}
          min={60}
          max={100}
          step={5}
          onChange={(v) => updateAppearance({ panelOpacity: v / 100 })}
          format={(v) => `${v}%`}
        />
      </Row>
    </Section>
  );
}

export function MotionSection() {
  const { settings, updateAppearance } = useSettings();
  if (!settings) return null;
  const a = settings.appearance;
  const levels: { id: typeof a.motion; label: string; hint: string }[] = [
    { id: 'off', label: 'Выкл', hint: 'Мгновенные состояния. Объём кнопок и вдавливание остаются.' },
    { id: 'reduced', label: 'Облегчённые', hint: 'Короткие переходы без пружин и переливов.' },
    { id: 'full', label: 'Полные', hint: 'Все анимации, включая пружины и фоны.' }
  ];
  return (
    <Section title="Анимации" hint="Если в Windows отключены эффекты анимации, при первом запуске выбирается «Выкл».">
      <div className="row wrap" style={{ gap: 8 }}>
        {levels.map((l) => (
          <button
            key={l.id}
            className="chip chip--button"
            data-active={a.motion === l.id ? 'true' : undefined}
            onClick={() => updateAppearance({ motion: l.id })}
            title={l.hint}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="tiny muted">{levels.find((l) => l.id === a.motion)?.hint}</p>
    </Section>
  );
}

export function LayoutSection() {
  const { settings } = useSettings();
  const { toast } = useToast();
  if (!settings) return null;

  return (
    <Section title="Файл настроек" hint="Перенос внешнего вида на другой компьютер.">
      <Row
        label="Экспорт и импорт"
        hint="JSON с версией схемы: тема, акцент, градиент, фон, шрифт, масштабы, прозрачность и уровень анимаций."
      >
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={15} />}
          onClick={async () => {
            const file = await window.ploxel.invoke('appearance:export');
            if (file) toast('success', 'Сохранено', String(file));
          }}
        >
          Экспорт
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={15} />}
          onClick={async () => {
            try {
              const res = (await window.ploxel.invoke('appearance:import')) as { warning?: string | null } | null;
              if (res) toast('success', 'Настройки импортированы', res.warning ?? undefined);
            } catch (e) {
              toast('error', 'Импорт отклонён', e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Импорт
        </Button>
      </Row>
    </Section>
  );
}