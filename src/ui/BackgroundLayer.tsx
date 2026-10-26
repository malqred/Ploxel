import type { Settings } from '../../shared/types';
import { AnimatedScene } from './AnimatedBackground';

interface Props {
  settings: Settings | null;
  systemDark?: boolean;
  /** окно не в фокусе — анимированный фон на паузе */
  paused?: boolean;
}

/** Фон приложения: тема, свой цвет, градиент или анимация в цвет акцента. */
export function BackgroundLayer({ settings, paused }: Props) {
  const a = settings?.appearance;
  const kind = a?.background.kind ?? 'theme';
  const custom = kind === 'solid' || kind === 'gradient';

  let style: React.CSSProperties = {};
  if (kind === 'solid' && a) style = { background: a.background.color };
  if (kind === 'gradient') {
    style = {
      backgroundImage: 'linear-gradient(var(--bg-angle), var(--bg-1), var(--bg-2) 65%, var(--bg-3))'
    };
  }
  if (kind === 'animated' && a) {
    style = { ['--anim-strength' as string]: String(0.35 + 0.65 * (a.background.intensity ?? 0.7)) };
  }

  return (
    <>
      <div
        className="bg-layer"
        data-kind={kind}
        data-custom={custom ? 'true' : undefined}
        data-paused={paused ? 'true' : undefined}
        style={style}
      >
        {kind === 'animated' && a && <AnimatedScene id={a.background.animatedId} />}
      </div>
      <div className={`bg-veil ${custom ? 'bg-veil--custom' : ''}`} />
    </>
  );
}
