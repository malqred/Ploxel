import { useId } from 'react';

/**
 * Знак Ploxel — та же форма, что у иконки приложения (build/icon.svg): тёмный
 * скруглённый квадрат, перламутровый шестиугольник и «плей». Перелив строится
 * из акцента (--accent), поэтому знак перекрашивается вместе с акцентом.
 */
export function PloxelMark({ size = 42, className }: { size?: number; className?: string }) {
  // Несколько знаков на странице (меню, заставка) — у каждого свои id градиентов
  const id = useId().replace(/:/g, '');
  const tone = (accent: number) => ({ stopColor: `color-mix(in srgb, var(--accent) ${accent}%, #ffffff)` });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 512 512" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1c1f" />
          <stop offset="1" stopColor="#050506" />
        </linearGradient>
        <linearGradient id={`${id}base`} x1="0" y1="0.2" x2="1" y2="0.8">
          <stop offset="0" style={tone(18)} />
          <stop offset="0.5" style={tone(42)} />
          <stop offset="1" style={tone(26)} />
        </linearGradient>
        <radialGradient id={`${id}hi`} cx="0.68" cy="0.22" r="0.55">
          <stop offset="0" style={{ ...tone(70), stopOpacity: 0.95 }} />
          <stop offset="1" style={{ ...tone(70), stopOpacity: 0 }} />
        </radialGradient>
        <radialGradient id={`${id}lo`} cx="0.25" cy="0.85" r="0.55">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 35%, #ffd6f2)', stopOpacity: 0.9 }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--accent) 35%, #ffd6f2)', stopOpacity: 0 }} />
        </radialGradient>
        <path
          id={`${id}hex`}
          d="M219.6 101.0 Q256.0 80.0 292.4 101.0 L372.0 147.0 Q408.4 168.0 408.4 210.0 L408.4 302.0 Q408.4 344.0 372.0 365.0 L292.4 411.0 Q256.0 432.0 219.6 411.0 L140.0 365.0 Q103.6 344.0 103.6 302.0 L103.6 210.0 Q103.6 168.0 140.0 147.0 Z"
        />
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}bg)`} />
      <rect x="17.5" y="17.5" width="477" height="477" rx="114.5" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
      <g transform="translate(256 256) scale(1.1) translate(-256 -256)">
        <use href={`#${id}hex`} fill={`url(#${id}base)`} />
        <use href={`#${id}hex`} fill={`url(#${id}hi)`} />
        <use href={`#${id}hex`} fill={`url(#${id}lo)`} />
        <path fill="#060607" stroke="#060607" strokeWidth="20" strokeLinejoin="round" d="M164 222 L164 334 L240 326 Z" />
      </g>
    </svg>
  );
}
