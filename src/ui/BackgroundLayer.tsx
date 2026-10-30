import { useEffect, useRef } from 'react';
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
  const media = kind === 'media' && a?.background.mediaFile ? a.background : null;
  const custom = kind === 'solid' || kind === 'gradient' || !!media;

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
        {media && (
          <MediaBackground
            file={media.mediaFile!}
            type={media.mediaType ?? 'image'}
            paused={!!paused || a?.motion === 'off'}
          />
        )}
      </div>
      <div
        className={`bg-veil ${custom ? 'bg-veil--custom' : ''}`}
        style={media ? { ['--media-dim' as string]: String(media.mediaDim ?? 0.5) } : undefined}
        data-media={media ? 'true' : undefined}
      />
    </>
  );
}

/** Адрес своего фона для окна (файл лежит в папке backgrounds). */
export function backgroundUrl(file: string): string {
  return `ploxel-media://bg/${encodeURIComponent(file)}`;
}

/** Своя картинка, GIF или видео: видео без звука и по кругу. */
export function MediaBackground({ file, type, paused }: { file: string; type: 'image' | 'video'; paused?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => undefined);
  }, [paused, file]);
  if (type === 'video') {
    return <video ref={ref} className="bg-media" src={backgroundUrl(file)} autoPlay={!paused} muted loop playsInline disablePictureInPicture />;
  }
  return <img className="bg-media" src={backgroundUrl(file)} alt="" draggable={false} />;
}
