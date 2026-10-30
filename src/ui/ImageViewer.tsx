import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface ViewerImage {
  src: string;
  /** подпись под картинкой */
  caption?: React.ReactNode;
}

/**
 * Просмотр картинок внутри лаунчера: картинка примерно на 3/4 окна,
 * стрелки и клавиши ←/→ листают, Esc и клик по фону закрывают.
 * actions — кнопки под картинкой (например, «Сохранить как…»).
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
  actions
}: {
  images: ViewerImage[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions?: (image: ViewerImage, i: number) => React.ReactNode;
}) {
  const open = index !== null && images.length > 0;
  const i = open ? Math.min(Math.max(0, index), images.length - 1) : 0;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded(false), [i, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowRight' && images.length > 1) onIndex((i + 1) % images.length);
      if (e.key === 'ArrowLeft' && images.length > 1) onIndex((i - 1 + images.length) % images.length);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, i, images.length, onClose, onIndex]);

  if (!open) return null;
  const image = images[i];
  const many = images.length > 1;

  return createPortal(
    <div className="viewer" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <button className="viewer__close icon-btn icon-btn--ghost" onClick={onClose} aria-label="Закрыть">
        <X size={18} />
      </button>
      {many && (
        <button
          className="viewer__nav viewer__nav--prev icon-btn"
          onClick={() => onIndex((i - 1 + images.length) % images.length)}
          aria-label="Предыдущее"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <figure className="viewer__figure" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <img
          key={image.src}
          className="viewer__img"
          data-loaded={loaded ? 'true' : undefined}
          src={image.src}
          alt=""
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
        {!loaded && <span className="btn__spinner viewer__spinner" />}
        {(image.caption || many || actions) && (
        <figcaption className="viewer__bar">
          <span className="viewer__caption">
            {image.caption}
            {many && <span className="tiny muted">{`${i + 1} из ${images.length}`}</span>}
          </span>
          {actions && <span className="row" style={{ gap: 8 }}>{actions(image, i)}</span>}
        </figcaption>
        )}
      </figure>
      {many && (
        <button
          className="viewer__nav viewer__nav--next icon-btn"
          onClick={() => onIndex((i + 1) % images.length)}
          aria-label="Следующее"
        >
          <ChevronRight size={20} />
        </button>
      )}
    </div>,
    document.body
  );
}
