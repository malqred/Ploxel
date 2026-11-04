import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Select, TextField } from './TextField';
import type { GameWindow } from '../../shared/types';

const PRESETS: { value: string; label: string; size?: [number, number] }[] = [
  { value: 'auto', label: 'Как решит игра' },
  { value: '1280x720', label: '1280 × 720', size: [1280, 720] },
  { value: '1600x900', label: '1600 × 900', size: [1600, 900] },
  { value: '1920x1080', label: '1920 × 1080', size: [1920, 1080] },
  { value: 'custom', label: 'Свой размер' },
  { value: 'fullscreen', label: 'Весь экран' }
];

const INHERIT = 'inherit';

function presetOf(win: GameWindow | undefined, custom: boolean): string {
  if (!win) return INHERIT;
  if (win.fullscreen) return 'fullscreen';
  if (!win.width || !win.height) return 'auto';
  if (custom) return 'custom';
  return PRESETS.find((p) => p.size && p.size[0] === win.width && p.size[1] === win.height)?.value ?? 'custom';
}

const clampSize = (v: string, min: number) => {
  const n = Math.round(Number(v.replace(/\D/g, '')));
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.min(n, 7680)) : 0;
};

/**
 * Размер окна игры: готовые размеры, свой размер или весь экран.
 * inheritLabel — для сборки: вариант «как в настройках лаунчера» (value = undefined).
 */
export function GameWindowField({
  value,
  onChange,
  inheritLabel,
  align = 'end'
}: {
  value: GameWindow | undefined;
  onChange: (next: GameWindow | undefined) => void;
  inheritLabel?: string;
  /** end — справа в строке настроек, start — под подписью поля */
  align?: 'start' | 'end';
}) {
  const [custom, setCustom] = useState(false);
  const preset = presetOf(value, custom);
  const [w, setW] = useState(String(value?.width || 1280));
  const [h, setH] = useState(String(value?.height || 720));

  useEffect(() => {
    if (value?.width) setW(String(value.width));
    if (value?.height) setH(String(value.height));
  }, [value?.width, value?.height]);

  const choose = (v: string) => {
    setCustom(v === 'custom');
    if (v === INHERIT) return onChange(undefined);
    if (v === 'auto') return onChange({ width: 0, height: 0, fullscreen: false });
    if (v === 'fullscreen') return onChange({ width: value?.width ?? 0, height: value?.height ?? 0, fullscreen: true });
    if (v === 'custom') return onChange({ width: clampSize(w, 320) || 1280, height: clampSize(h, 240) || 720, fullscreen: false });
    const size = PRESETS.find((p) => p.value === v)?.size;
    if (size) onChange({ width: size[0], height: size[1], fullscreen: false });
  };

  const commit = () => {
    const width = clampSize(w, 320);
    const height = clampSize(h, 240);
    if (width && height) onChange({ width, height, fullscreen: false });
  };

  return (
    <div className="col" style={{ gap: 8, alignItems: align === 'end' ? 'flex-end' : 'flex-start' }}>
      <Select
        value={preset}
        options={[...(inheritLabel ? [{ value: INHERIT, label: inheritLabel }] : []), ...PRESETS]}
        onChange={choose}
        width={220}
      />
      {preset === 'custom' && (
        <div className="row game-window-size">
          <TextField value={w} onChange={setW} onEnter={commit} placeholder="Ширина" suffix="px" />
          <span className="muted">×</span>
          <TextField value={h} onChange={setH} onEnter={commit} placeholder="Высота" suffix="px" />
          <Button variant="secondary" size="sm" onClick={commit}>
            Применить
          </Button>
        </div>
      )}
    </div>
  );
}
