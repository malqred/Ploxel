import { useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api';
import { MediaBackground } from '../../ui/BackgroundLayer';
import { useSettings } from '../../state/settings';
import { Tabs } from '../../ui/Controls';
import { useSystemDark, useWindowFocused } from '../../theme/apply';
import { resolveDark } from '../../../shared/theme';
import { Slider } from '../../ui/Controls';
import { Button, IconButton } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../state/toast';
import { ACCENTS, GRADIENTS, THEMES, THEME_ACCENT, accentById, contrastRatio, contrastText, hexToRgb } from '../../theme/presets';
import { ANIMATIONS, AnimatedScene, isAnimationId } from '../../ui/AnimatedBackground';
import { Row, Section } from './parts';
import type { AccentColor, ColorMode, GradientDef, ThemeId } from '../../../shared/types';

/* ------------------------------ Тема ------------------------------ */

export function ThemeSection() {
  const { settings, updateAppearance } = useSettings();
  const systemDark = useSystemDark();
  if (!settings) return null;
  const a = settings.appearance;
  const dark = resolveDark(a.colorMode, systemDark);
  const snap = a.customTheme ?? null;
  const customBase = THEMES.find((t) => t.id === (a.custom ? a.theme : snap?.base ?? a.theme)) ?? THEMES[0];
  const customAccent = accentById({ accentId: a.custom ? a.accentId : snap?.accentId ?? a.accentId, customAccents: a.customAccents });
  const customSw = dark ? customBase.dark : customBase.light;

  const chooseCustom = () => {
    if (a.custom) return;
    if (snap) void updateAppearance({ custom: true, theme: snap.base, accentId: snap.accentId, background: snap.background });
    else void updateAppearance({ custom: true, customTheme: { base: a.theme, accentId: a.accentId, background: a.background } });
  };

  // Готовая тема включается со своим акцентом и фоном; кастомная остаётся в снимке
  const choosePreset = (id: ThemeId) =>
    updateAppearance({ theme: id, custom: false, accentId: THEME_ACCENT[id], background: { ...a.background, kind: 'theme' } });

  return (
    <Section
      title="Тема"
      hint="Кастомная — ваши акцент и фон. Если поменять акцент или фон у готовой темы, она сразу станет кастомной."
    >
      <Row label="Режим" hint="«Как в Windows» следует светлой или тёмной теме системы.">
        <Tabs
          value={a.colorMode}
          onChange={(v: ColorMode) => updateAppearance({ colorMode: v, followSystemTheme: v === 'system' })}
          items={[
            { id: 'light', label: 'Светлая' },
            { id: 'dark', label: 'Тёмная' },
            { id: 'system', label: 'Как в Windows' }
          ]}
        />
      </Row>
      <div className="theme-grid">
        <button className="theme-card theme-card--custom" aria-pressed={!!a.custom} onClick={chooseCustom}>
          <span className="theme-card__swatch">
            <span style={{ background: customSw[0] }} />
            <span style={{ background: customSw[1] }} />
            <span style={{ background: customAccent.value }} />
          </span>
          <div className="theme-card__name">Кастомная</div>
          <div className="theme-card__mode">{a.custom || snap ? `на основе «${customBase.name}»` : 'из текущих настроек'}</div>
        </button>
        {THEMES.map((t) => {
          const sw = dark ? t.dark : t.light;
          return (
            <button key={t.id} className="theme-card" aria-pressed={!a.custom && a.theme === t.id} onClick={() => choosePreset(t.id)}>
              <span className="theme-card__swatch">
                <span style={{ background: sw[0] }} />
                <span style={{ background: sw[1] }} />
                <span style={{ background: sw[2] }} />
              </span>
              <div className="theme-card__name">{t.name}</div>
              <div className="theme-card__mode">{dark ? 'тёмный вариант' : 'светлый вариант'}</div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------ Акцент ------------------------------ */

export function AccentSection() {
  const { settings, updateAppearance } = useSettings();
  const { toast } = useToast();
  const [newColor, setNewColor] = useState('#7E9C89');
  if (!settings) return null;
  const a = settings.appearance;
  const all = [...ACCENTS, ...a.customAccents];
  const text = contrastText(all.find((x) => x.id === a.accentId)?.value ?? ACCENTS[0].value);
  const ratio = contrastRatio(all.find((x) => x.id === a.accentId)?.value ?? ACCENTS[0].value, text);

  const addAccent = () => {
    const accent: AccentColor = {
      id: `custom-${Date.now().toString(36)}`,
      name: 'Свой цвет',
      value: newColor,
      custom: true
    };
    void updateAppearance({ customAccents: [...a.customAccents, accent], accentId: accent.id });
    toast('success', 'Цвет добавлен', newColor);
  };

  return (
    <Section title="Акцент" hint="Основное действие всегда окрашено акцентом; фиолетовый остаётся вторым цветом для обновлений.">
      <div className="swatch-row">
        {all.map((accent) => (
          <button
            key={accent.id}
            className="accent-swatch"
            style={{ background: accent.value }}
            aria-pressed={a.accentId === accent.id}
            title={accent.name}
            onClick={() => updateAppearance({ accentId: accent.id })}
          />
        ))}
        {a.customAccents.length > 0 && (
          <IconButton
            label="Удалить свой цвет"
            size="sm"
            ghost
            onClick={() => {
              const rest = a.customAccents.filter((c) => c.id !== a.accentId);
              void updateAppearance({
                customAccents: rest,
                accentId: a.accentId.startsWith('custom-') ? rest[0]?.id ?? 'sage' : a.accentId
              });
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input className="custom-color" type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addAccent}>
          Добавить свой цвет
        </Button>
      </div>
      {ratio < 4.5 && (
        <div className="notice">
          <div>
            <strong>{`Низкий контраст текста на кнопке (${ratio.toFixed(1)}:1).`}</strong> Рекомендуем выбрать более
            тёмный или более светлый оттенок — иначе надписи будут читаться хуже.
          </div>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------ Фон ------------------------------ */

const gradientCss = (g: { angle: number; colors: string[] }) => `linear-gradient(${g.angle}deg, ${g.colors.join(', ')})`;

export function BackgroundSection() {
  const { settings, updateAppearance } = useSettings();
  const focused = useWindowFocused();
  const [c1, setC1] = useState('#9DBFA6');
  const [c2, setC2] = useState('#D9D3B4');
  const [c3, setC3] = useState('');
  const [angle, setAngle] = useState(135);
  const [name, setName] = useState('');
  const { toast } = useToast();
  if (!settings) return null;
  const a = settings.appearance;
  const bg = a.background;
  const gradients = [...GRADIENTS, ...a.customGradients];
  const gradient = gradients.find((g) => g.id === bg.gradientId) ?? GRADIENTS[0];

  const set = (patch: Partial<typeof bg>) => updateAppearance({ background: { ...bg, ...patch } });
  const pickMedia = async () => {
    try {
      const picked = await api.invoke<{ mediaFile: string; mediaType: 'image' | 'video' } | null>('appearance:pickBackground');
      if (picked) set({ kind: 'media', mediaFile: picked.mediaFile, mediaType: picked.mediaType });
    } catch (e) {
      toast('error', 'Фон не установлен', e instanceof Error ? e.message : String(e));
    }
  };
  const pickGradient = (id: string) => updateAppearance({ background: { ...bg, kind: 'gradient', gradientId: id }, gradientId: id });

  const addGradient = () => {
    const g: GradientDef = {
      id: `custom-${Date.now().toString(36)}`,
      name: name.trim() || 'Свой градиент',
      colors: c3 ? [c1, c2, c3] : [c1, c2],
      angle,
      custom: true
    };
    void updateAppearance({
      customGradients: [...a.customGradients, g],
      background: { ...bg, kind: 'gradient', gradientId: g.id },
      gradientId: g.id
    });
    setName('');
  };

  const removeGradient = (id: string) => {
    const rest = a.customGradients.filter((g) => g.id !== id);
    if (bg.gradientId === id) {
      void updateAppearance({ customGradients: rest, background: { ...bg, gradientId: GRADIENTS[0].id }, gradientId: GRADIENTS[0].id });
    } else void updateAppearance({ customGradients: rest });
  };

  return (
    <Section title="Фон приложения" hint="Цвет темы, свой цвет, градиент, анимация или своя картинка, GIF или видео.">
      <div className="row wrap" style={{ gap: 8 }}>
        {[
          { id: 'theme', label: 'Как в теме' },
          { id: 'solid', label: 'Цвет' },
          { id: 'gradient', label: 'Градиент' },
          { id: 'animated', label: 'Анимация' },
          { id: 'media', label: 'Своя картинка или видео' }
        ].map((k) => (
          <button
            key={k.id}
            className="chip chip--button"
            data-active={bg.kind === k.id ? 'true' : undefined}
            onClick={() =>
              k.id === 'media' && !bg.mediaFile
                ? void pickMedia()
                : set({ kind: k.id as typeof bg.kind, animatedId: isAnimationId(bg.animatedId) ? bg.animatedId : 'aurora' })
            }
          >
            {k.label}
          </button>
        ))}
      </div>

      {bg.kind === 'solid' && (
        <Row label="Цвет фона">
          <input className="custom-color" type="color" value={bg.color} onChange={(e) => set({ color: e.target.value })} />
        </Row>
      )}

      {bg.kind === 'gradient' && (
        <div className="bg-subpanel">
          <div className="swatch-row">
            {gradients.map((g) => (
              <span key={g.id} className="gradient-swatch-wrap">
                <button
                  className="gradient-swatch"
                  aria-pressed={bg.gradientId === g.id}
                  title={g.name}
                  style={{ background: gradientCss(g) }}
                  onClick={() => pickGradient(g.id)}
                />
                {g.custom && (
                  <button className="gradient-swatch__remove" title="Удалить градиент" aria-label="Удалить градиент" onClick={() => removeGradient(g.id)}>
                    <X size={11} />
                  </button>
                )}
              </span>
            ))}
          </div>
          <span className="small muted">{`Выбран: ${gradient.name}. Панели остаются читаемыми за счёт подложки.`}</span>
          <Row label="Свой градиент" hint="Два или три цвета и угол — новый градиент сразу станет фоном." stack>
            <div className="col" style={{ gap: 12 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="custom-color" type="color" value={c1} onChange={(e) => setC1(e.target.value)} />
                <input className="custom-color" type="color" value={c2} onChange={(e) => setC2(e.target.value)} />
                <input
                  className="custom-color"
                  type="color"
                  value={c3 || '#FFFFFF'}
                  onChange={(e) => setC3(e.target.value)}
                  title="Третий цвет (необязательно)"
                />
                {c3 && (
                  <IconButton label="Убрать третий цвет" size="sm" ghost onClick={() => setC3('')}>
                    <X size={14} />
                  </IconButton>
                )}
                <span className="custom-gradient-preview" style={{ background: gradientCss({ angle, colors: [c1, c2, c3].filter(Boolean) }) }} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <TextField value={name} onChange={setName} placeholder="Название (необязательно)" />
                </div>
                <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addGradient}>
                  Добавить
                </Button>
              </div>
              <div className="col" style={{ gap: 4, maxWidth: 360 }}>
                <span className="field__label">{`Угол — ${angle}°`}</span>
                <Slider value={angle} min={0} max={360} step={5} onChange={setAngle} format={(v) => `${v}°`} />
              </div>
            </div>
          </Row>
        </div>
      )}

      {bg.kind === 'media' && bg.mediaFile && (
        <div className="bg-subpanel">
          <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
            <span className="media-preview">
              <MediaBackground file={bg.mediaFile} type={bg.mediaType ?? 'image'} paused={!focused} />
            </span>
            <div className="col" style={{ gap: 10, flex: 1, minWidth: 220 }}>
              <span className="small muted">
                {bg.mediaType === 'video'
                  ? 'Видео играет без звука и по кругу. Когда окно лаунчера не активно, оно ставится на паузу.'
                  : 'Картинка растягивается на всё окно. GIF проигрывается по кругу.'}
              </span>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="secondary" size="sm" icon={<ImagePlus size={14} />} onClick={() => void pickMedia()}>
                  Выбрать другой файл
                </Button>
              </div>
              <Row label={`Затемнение — ${Math.round((bg.mediaDim ?? 0.5) * 100)}%`} hint="Подложка цвета темы, чтобы текст читался поверх фона." stack>
                <div style={{ maxWidth: 360 }}>
                  <Slider
                    value={Math.round((bg.mediaDim ?? 0.5) * 100)}
                    min={0}
                    max={85}
                    step={5}
                    onChange={(v) => set({ mediaDim: v / 100 })}
                    format={(v) => `${v}%`}
                  />
                </div>
              </Row>
            </div>
          </div>
        </div>
      )}

      {bg.kind === 'animated' && (
        <div className="bg-subpanel">
          <div className="anim-grid">
            {ANIMATIONS.map((anim) => (
              <button key={anim.id} className="anim-card" aria-pressed={bg.animatedId === anim.id} onClick={() => set({ animatedId: anim.id })}>
                <span className="anim-preview" data-paused={!focused ? 'true' : undefined}>
                  <AnimatedScene id={anim.id} preview />
                </span>
                <span className="anim-card__name">{anim.name}</span>
              </button>
            ))}
          </div>
          <Row label={`Яркость — ${Math.round((bg.intensity ?? 0.7) * 100)}%`} hint="Цвет анимации берётся из акцента." stack>
            <div style={{ maxWidth: 360 }}>
              <Slider
                value={Math.round((bg.intensity ?? 0.7) * 100)}
                min={10}
                max={100}
                step={5}
                onChange={(v) => set({ intensity: v / 100 })}
                format={(v) => `${v}%`}
              />
            </div>
          </Row>
          {a.motion === 'off' && (
            <div className="notice">
              <div>Анимации выключены в разделе «Анимации» ниже — фон будет неподвижным.</div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

export function shadeColor(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c : 255 - c) * amount)));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}