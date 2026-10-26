import { useMemo } from 'react';

/**
 * Анимированные фоны. Цвета — из акцента (var(--accent)), поэтому фон сам
 * перекрашивается при смене акцента. Двигаются только transform и opacity.
 * Размеры — в единицах контейнера: одна и та же сцена работает и на весь
 * экран, и в маленьком превью в настройках.
 */

export const ANIMATIONS = [
  { id: 'aurora', name: 'Северное сияние' },
  { id: 'waves', name: 'Волны' },
  { id: 'fireflies', name: 'Светлячки' },
  { id: 'grid', name: 'Неоновая сетка' },
  { id: 'rain', name: 'Пиксельный дождь' },
  { id: 'orbits', name: 'Орбиты' }
] as const;

export type AnimationId = (typeof ANIMATIONS)[number]['id'];

export function isAnimationId(id: string): id is AnimationId {
  return ANIMATIONS.some((a) => a.id === id);
}

/** Детерминированный «случай»: точки не прыгают при каждой перерисовке. */
function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const WAVE = 'M0,60 C150,100 350,20 600,60 C850,100 1050,20 1200,60 L1200,120 L0,120 Z';

function Waves() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="anim-wave" data-layer={i}>
          {[0, 1].map((j) => (
            <svg key={j} viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
              <path d={WAVE} />
            </svg>
          ))}
        </div>
      ))}
    </>
  );
}

function Fireflies({ count }: { count: number }) {
  const dots = useMemo(() => {
    const rnd = seeded(7);
    return Array.from({ length: count }, () => ({
      left: `${(rnd() * 100).toFixed(1)}%`,
      top: `${(rnd() * 100).toFixed(1)}%`,
      ['--d' as string]: `${(6 + rnd() * 8).toFixed(1)}s`,
      ['--delay' as string]: `${(-rnd() * 10).toFixed(1)}s`,
      ['--dx' as string]: `${((rnd() - 0.5) * 16).toFixed(1)}cqmin`,
      ['--dy' as string]: `${((rnd() - 0.5) * 16).toFixed(1)}cqmin`,
      ['--s' as string]: `${(0.6 + rnd() * 0.8).toFixed(2)}`
    }));
  }, [count]);
  return (
    <>
      {dots.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </>
  );
}

function Rain({ count }: { count: number }) {
  const drops = useMemo(() => {
    const rnd = seeded(13);
    return Array.from({ length: count }, (_, i) => ({
      left: `${((i + rnd() * 0.8) * (100 / count)).toFixed(1)}%`,
      ['--d' as string]: `${(3 + rnd() * 4).toFixed(1)}s`,
      ['--delay' as string]: `${(-rnd() * 7).toFixed(1)}s`,
      ['--o' as string]: `${(0.35 + rnd() * 0.65).toFixed(2)}`
    }));
  }, [count]);
  return (
    <>
      {drops.map((style, i) => (
        <span key={i} className="anim-drop" style={style}>
          <b />
        </span>
      ))}
    </>
  );
}

function Orbits() {
  return (
    <>
      <div className="anim-core" />
      {[28, 46, 66, 88].map((r, i) => (
        <div key={r} className="anim-ring" style={{ ['--r' as string]: r, ['--d' as string]: `${18 + i * 9}s` }} data-reverse={i % 2 ? 'true' : undefined}>
          <i />
          {i % 2 === 0 && <i className="anim-ring__far" />}
        </div>
      ))}
    </>
  );
}

export function AnimatedScene({ id, preview = false }: { id: string; preview?: boolean }) {
  const scene = isAnimationId(id) ? id : 'aurora';
  return (
    <div className="anim" data-scene={scene} data-preview={preview ? 'true' : undefined} aria-hidden>
      {scene === 'aurora' && (
        <>
          <i />
          <i />
          <i />
          <i />
        </>
      )}
      {scene === 'waves' && <Waves />}
      {scene === 'fireflies' && <Fireflies count={preview ? 14 : 34} />}
      {scene === 'grid' && (
        <>
          <div className="anim-sun" />
          <div className="anim-plane">
            <div className="anim-plane__lines" />
          </div>
        </>
      )}
      {scene === 'rain' && <Rain count={preview ? 12 : 30} />}
      {scene === 'orbits' && <Orbits />}
    </div>
  );
}
