import { useEffect, useMemo, useRef, useState } from 'react';
import type { SkinLayers } from '../../shared/types';
import { convertArms, detectArmModel } from '../../shared/skin-model';

type FaceKey = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
interface Uv {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Faces = Record<FaceKey, Uv>;

const HEAD: Faces = {
  top: { x: 8, y: 0, w: 8, h: 8 },
  bottom: { x: 16, y: 0, w: 8, h: 8 },
  right: { x: 0, y: 8, w: 8, h: 8 },
  front: { x: 8, y: 8, w: 8, h: 8 },
  left: { x: 16, y: 8, w: 8, h: 8 },
  back: { x: 24, y: 8, w: 8, h: 8 }
};
const BODY: Faces = {
  top: { x: 20, y: 16, w: 8, h: 4 },
  bottom: { x: 28, y: 16, w: 8, h: 4 },
  right: { x: 16, y: 20, w: 4, h: 12 },
  front: { x: 20, y: 20, w: 8, h: 12 },
  left: { x: 28, y: 20, w: 4, h: 12 },
  back: { x: 32, y: 20, w: 8, h: 12 }
};
const ARM_R: Faces = {
  top: { x: 44, y: 16, w: 4, h: 4 },
  bottom: { x: 48, y: 16, w: 4, h: 4 },
  right: { x: 40, y: 20, w: 4, h: 12 },
  front: { x: 44, y: 20, w: 4, h: 12 },
  left: { x: 48, y: 20, w: 4, h: 12 },
  back: { x: 52, y: 20, w: 4, h: 12 }
};
const ARM_L: Faces = {
  top: { x: 36, y: 48, w: 4, h: 4 },
  bottom: { x: 40, y: 48, w: 4, h: 4 },
  right: { x: 32, y: 52, w: 4, h: 12 },
  front: { x: 36, y: 52, w: 4, h: 12 },
  left: { x: 40, y: 52, w: 4, h: 12 },
  back: { x: 44, y: 52, w: 4, h: 12 }
};
const LEG_R: Faces = {
  top: { x: 4, y: 16, w: 4, h: 4 },
  bottom: { x: 8, y: 16, w: 4, h: 4 },
  right: { x: 0, y: 20, w: 4, h: 12 },
  front: { x: 4, y: 20, w: 4, h: 12 },
  left: { x: 8, y: 20, w: 4, h: 12 },
  back: { x: 12, y: 20, w: 4, h: 12 }
};
const LEG_L: Faces = {
  top: { x: 20, y: 48, w: 4, h: 4 },
  bottom: { x: 24, y: 48, w: 4, h: 4 },
  right: { x: 16, y: 52, w: 4, h: 12 },
  front: { x: 20, y: 52, w: 4, h: 12 },
  left: { x: 24, y: 52, w: 4, h: 12 },
  back: { x: 28, y: 52, w: 4, h: 12 }
};

/** Тонкие руки (Alex): ширина 3 пикселя, развёртка сдвинута */
function slimArm(x: number, y: number): Faces {
  return {
    top: { x: x + 4, y, w: 3, h: 4 },
    bottom: { x: x + 7, y, w: 3, h: 4 },
    right: { x, y: y + 4, w: 4, h: 12 },
    front: { x: x + 4, y: y + 4, w: 3, h: 12 },
    left: { x: x + 7, y: y + 4, w: 4, h: 12 },
    back: { x: x + 11, y: y + 4, w: 3, h: 12 }
  };
}
const SLIM_ARM_R = slimArm(40, 16);
const SLIM_ARM_L = slimArm(32, 48);
const SLIM_SLEEVE_R = slimArm(40, 32);
const SLIM_SLEEVE_L = slimArm(48, 48);

const HAT: Faces = {
  top: { x: 40, y: 0, w: 8, h: 8 },
  bottom: { x: 48, y: 0, w: 8, h: 8 },
  right: { x: 32, y: 8, w: 8, h: 8 },
  front: { x: 40, y: 8, w: 8, h: 8 },
  left: { x: 48, y: 8, w: 8, h: 8 },
  back: { x: 56, y: 8, w: 8, h: 8 }
};
const JACKET: Faces = {
  top: { x: 20, y: 32, w: 8, h: 4 },
  bottom: { x: 28, y: 32, w: 8, h: 4 },
  right: { x: 16, y: 36, w: 4, h: 12 },
  front: { x: 20, y: 36, w: 8, h: 12 },
  left: { x: 28, y: 36, w: 4, h: 12 },
  back: { x: 32, y: 36, w: 8, h: 12 }
};
const SLEEVE_R: Faces = {
  top: { x: 44, y: 32, w: 4, h: 4 },
  bottom: { x: 48, y: 32, w: 4, h: 4 },
  right: { x: 40, y: 36, w: 4, h: 12 },
  front: { x: 44, y: 36, w: 4, h: 12 },
  left: { x: 48, y: 36, w: 4, h: 12 },
  back: { x: 52, y: 36, w: 4, h: 12 }
};
const SLEEVE_L: Faces = {
  top: { x: 52, y: 48, w: 4, h: 4 },
  bottom: { x: 56, y: 48, w: 4, h: 4 },
  right: { x: 48, y: 52, w: 4, h: 12 },
  front: { x: 52, y: 52, w: 4, h: 12 },
  left: { x: 56, y: 52, w: 4, h: 12 },
  back: { x: 60, y: 52, w: 4, h: 12 }
};
const PANTS_R: Faces = {
  top: { x: 4, y: 32, w: 4, h: 4 },
  bottom: { x: 8, y: 32, w: 4, h: 4 },
  right: { x: 0, y: 36, w: 4, h: 12 },
  front: { x: 4, y: 36, w: 4, h: 12 },
  left: { x: 8, y: 36, w: 4, h: 12 },
  back: { x: 12, y: 36, w: 4, h: 12 }
};
const PANTS_L: Faces = {
  top: { x: 4, y: 48, w: 4, h: 4 },
  bottom: { x: 8, y: 48, w: 4, h: 4 },
  right: { x: 0, y: 52, w: 4, h: 12 },
  front: { x: 4, y: 52, w: 4, h: 12 },
  left: { x: 8, y: 52, w: 4, h: 12 },
  back: { x: 12, y: 52, w: 4, h: 12 }
};

function faceStyle(skin: string, uv: Uv, texH: number) {
  // Позиция фона в процентах: p% выравнивает p% картинки с p% контейнера,
  // поэтому координату считаем от (размер текстуры - размер грани).
  return {
    backgroundImage: `url(${skin})`,
    backgroundSize: `${(64 / uv.w) * 100}% ${(texH / uv.h) * 100}%`,
    backgroundPosition: `${(uv.x / (64 - uv.w)) * 100}% ${(uv.y / (texH - uv.h)) * 100}%`,
    imageRendering: 'pixelated' as const
  };
}

const KEYS: FaceKey[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/**
 * Грани коробки W×H×D с центром в середине части. Оси CSS: X — вправо, Y — вниз,
 * Z — к зрителю; персонаж смотрит на зрителя, значит его правая сторона
 * (грань «right» в развёртке) — слева от зрителя, на -X.
 */
function boxFaces(w: number, h: number, d: number, unit: number) {
  const size = (k: FaceKey) =>
    k === 'front' || k === 'back' ? [w, h] : k === 'top' || k === 'bottom' ? [w, d] : [d, h];
  const transform = (k: FaceKey) => {
    if (k === 'front') return `translate(-50%, -50%) translateZ(${(d * unit) / 2}px)`;
    if (k === 'back') return `translate(-50%, -50%) rotateY(180deg) translateZ(${(d * unit) / 2}px)`;
    if (k === 'right') return `translate(-50%, -50%) rotateY(-90deg) translateZ(${(w * unit) / 2}px)`;
    if (k === 'left') return `translate(-50%, -50%) rotateY(90deg) translateZ(${(w * unit) / 2}px)`;
    if (k === 'top') return `translate(-50%, -50%) rotateX(90deg) translateZ(${(h * unit) / 2}px)`;
    return `translate(-50%, -50%) rotateX(-90deg) translateZ(${(h * unit) / 2}px)`;
  };
  return (k: FaceKey) => {
    const [fw, fh] = size(k);
    return { width: fw * unit, height: fh * unit, transform: transform(k) };
  };
}

/** Пиксели скина для объёмного второго слоя. */
export interface SkinPixels {
  data: Uint8ClampedArray;
  height: number;
}

interface Wall {
  left: number;
  top: number;
  width: number;
  height: number;
  vertical: boolean;
  color: string;
}

/**
 * Стенки «вокселей» второго слоя, как в моде 3D Skin Layers: у каждого
 * непрозрачного пикселя, рядом с которым пусто (или край грани), встаёт
 * стенка его цвета глубиной в толщину слоя. Соседние стенки одного цвета
 * сливаются в одну — элементов получается в разы меньше, чем пикселей.
 */
export function voxelWalls(px: SkinPixels, uv: Uv, faceW: number, faceH: number, depth: number): Wall[] {
  const pw = faceW / uv.w;
  const ph = faceH / uv.h;
  const pixel = (i: number, j: number): number[] | null => {
    if (i < 0 || j < 0 || i >= uv.w || j >= uv.h) return null;
    const o = ((uv.y + j) * 64 + uv.x + i) * 4;
    return px.data[o + 3] > 0 ? [px.data[o], px.data[o + 1], px.data[o + 2]] : null;
  };
  const shade = (c: number[], k: number) => `rgb(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)})`;
  const walls: Wall[] = [];

  // Вертикальные стенки — между столбцами e-1 и e
  for (let e = 0; e <= uv.w; e++) {
    let run: { start: number; color: string } | null = null;
    const flush = (end: number) => {
      if (run) walls.push({ left: e * pw, top: run.start * ph, width: depth, height: (end - run.start) * ph, vertical: true, color: run.color });
      run = null;
    };
    for (let j = 0; j < uv.h; j++) {
      const a = pixel(e - 1, j);
      const b = pixel(e, j);
      const solid = a && !b ? a : b && !a ? b : null;
      const color = solid ? shade(solid, 0.82) : null;
      if (!color) flush(j);
      else if (!run || run.color !== color) {
        flush(j);
        run = { start: j, color };
      }
    }
    flush(uv.h);
  }

  // Горизонтальные стенки — между строками e-1 и e
  for (let e = 0; e <= uv.h; e++) {
    let run: { start: number; color: string } | null = null;
    const flush = (end: number) => {
      if (run) walls.push({ left: run.start * pw, top: e * ph, width: (end - run.start) * pw, height: depth, vertical: false, color: run.color });
      run = null;
    };
    for (let i = 0; i < uv.w; i++) {
      const a = pixel(i, e - 1);
      const b = pixel(i, e);
      const solid = a && !b ? a : b && !a ? b : null;
      const color = solid ? shade(solid, 0.7) : null;
      if (!color) flush(i);
      else if (!run || run.color !== color) {
        flush(i);
        run = { start: i, color };
      }
    }
    flush(uv.w);
  }
  return walls;
}

/** Грань объёмного слоя: картинка снаружи и стенки вокселей внутрь, к телу. */
function VoxelFace({
  box,
  uv,
  skin,
  texH,
  pixels,
  depth
}: {
  box: { width: number; height: number; transform: string };
  uv: Uv;
  skin: string;
  texH: number;
  pixels: SkinPixels;
  depth: number;
}) {
  const walls = useMemo(() => voxelWalls(pixels, uv, box.width, box.height, depth), [pixels, uv, box.width, box.height, depth]);
  return (
    <div className="skin-shell" style={box}>
      <div className="skin-face skin-face--overlay skin-shell__skin" style={faceStyle(skin, uv, texH)} />
      {walls.map((w, i) => (
        <div
          key={i}
          className="skin-voxel"
          style={{
            left: w.left,
            top: w.top,
            width: w.width,
            height: w.height,
            background: w.color,
            transformOrigin: w.vertical ? 'left center' : 'center top',
            transform: w.vertical ? 'rotateY(90deg)' : 'rotateX(-90deg)'
          }}
        />
      ))}
    </div>
  );
}

function Part({
  w,
  h,
  d,
  faces,
  skin,
  texH,
  overlay,
  pixels,
  x,
  y,
  unit,
  className
}: {
  w: number;
  h: number;
  d: number;
  faces: Faces;
  skin: string;
  texH: number;
  /** второй слой: отдельная оболочка, раздутая на inflate пикселей с каждой стороны */
  overlay?: { faces: Faces; enabled: boolean; inflate: number };
  /** пиксели скина: если переданы, второй слой рисуется объёмными вокселями */
  pixels?: SkinPixels | null;
  x: number;
  y: number;
  unit: number;
  className?: string;
}) {
  const inner = boxFaces(w, h, d, unit);
  const inf = overlay?.inflate ?? 0;
  const outer = boxFaces(w + inf * 2, h + inf * 2, d + inf * 2, unit);

  return (
    <div
      className={`skin-part ${className ?? ''}`}
      style={{
        left: (x - 8) * unit,
        top: (y - 16) * unit,
        width: w * unit,
        height: h * unit,
        transformStyle: 'preserve-3d'
      }}
    >
      {KEYS.map((k) => (
        <div key={k} className="skin-face" style={{ ...inner(k), ...faceStyle(skin, faces[k], texH) }} />
      ))}
      {overlay?.enabled &&
        pixels &&
        KEYS.map((k) => (
          <VoxelFace key={`v-${k}`} box={outer(k)} uv={overlay.faces[k]} skin={skin} texH={texH} pixels={pixels} depth={inf * unit} />
        ))}
      {overlay?.enabled &&
        !pixels &&
        KEYS.map((k) => (
          <div
            key={`o-${k}`}
            className="skin-face skin-face--overlay"
            style={{ ...outer(k), ...faceStyle(skin, overlay.faces[k], texH) }}
          />
        ))}
    </div>
  );
}

export function SkinViewer({
  skin,
  variant,
  layers,
  walking,
  layers3d = false
}: {
  skin: string | null;
  variant: 'classic' | 'slim';
  layers: SkinLayers;
  walking?: boolean;
  /** объёмный второй слой, как в моде 3D Skin Layers */
  layers3d?: boolean;
}) {
  const [yaw, setYaw] = useState(-24);
  const [pitch, setPitch] = useState(-6);
  // Левая кнопка — вращение, зажатое колёсико — сдвиг камеры
  const [drag, setDrag] = useState<null | 'rotate' | 'pan'>(null);
  const dragging = drag !== null;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tex, setTex] = useState<string | null>(skin);
  const [legacy, setLegacy] = useState(false);
  const texH = legacy ? 32 : 64;
  const last = useRef<{ x: number; y: number } | null>(null);
  const [pixels, setPixels] = useState<SkinPixels | null>(null);
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  // Текстура подстраивается под выбранные руки: скин под тонкие руки на
  // широкой модели (и наоборот) перекладывается, а не растягивается
  useEffect(() => {
    setPixels(null);
    setTex(skin);
    if (!skin) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setLegacy(img.naturalHeight === 32);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        let data: Uint8ClampedArray = ctx.getImageData(0, 0, 64, img.naturalHeight).data;
        if (img.naturalHeight === 64) {
          const model = detectArmModel(data);
          if (model !== variant) {
            data = convertArms(data, model, variant);
            ctx.putImageData(new ImageData(new Uint8ClampedArray(data), 64, 64), 0, 0);
            setTex(canvas.toDataURL('image/png'));
          }
        }
        setPixels({ data, height: img.naturalHeight });
      } catch {
        /* картинка без доступа к пикселям — останется обычный второй слой */
      }
    };
    img.src = skin;
    return () => {
      alive = false;
    };
  }, [skin, variant]);

  // Колёсико над моделью — приближение. Слушатель не пассивный, чтобы
  // страница при этом не прокручивалась.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(2.6, Math.max(0.5, z * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Объёмный слой толще обычного: у головы 0,75 пикселя, у остального — 0,5
  const voxel = layers3d && pixels && !legacy ? pixels : null;
  const headInflate = voxel ? 0.75 : 0.5;
  const limbInflate = voxel ? 0.5 : 0.25;

  const unit = 6.4;
  const isSlim = variant === 'slim';
  const armW = isSlim ? 3 : 4;
  const leftArmX = 12;
  const rightArmFaces = isSlim ? SLIM_ARM_R : ARM_R;
  const leftArmFaces = legacy ? rightArmFaces : isSlim ? SLIM_ARM_L : ARM_L;
  const leftLegFaces = legacy ? LEG_R : LEG_L;

  return (
    <div
      ref={stageRef}
      className="skin-stage"
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (e.button === 1) e.preventDefault(); // без автопрокрутки Windows
        setDrag(e.button === 1 ? 'pan' : 'rotate');
        last.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!drag || !last.current) return;
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        if (drag === 'pan') {
          setPan((p) => ({ x: Math.max(-400, Math.min(400, p.x + dx)), y: Math.max(-300, Math.min(300, p.y + dy)) }));
          return;
        }
        setYaw((v) => v + dx * 0.6);
        // Тянем вниз — модель наклоняется к зрителю верхом (видна макушка);
        // до 89° — можно посмотреть строго сверху и снизу
        setPitch((v) => Math.max(-89, Math.min(89, v - dy * 0.4)));
      }}
      onPointerUp={() => {
        setDrag(null);
        last.current = null;
      }}
      onPointerLeave={() => {
        setDrag(null);
        last.current = null;
      }}
      onDoubleClick={() => {
        setYaw(-24);
        setPitch(-6);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }}
      data-panning={drag === 'pan' ? 'true' : undefined}
      title="Потяните, чтобы повернуть. Колёсико — приближение, зажатое колёсико — сдвиг камеры. Двойной клик — сброс."
    >
      <div className="skin-floor" />
      {!skin ? (
        <div className="skin-placeholder">
          <div className="skin-placeholder__head" />
          <div className="skin-placeholder__body" />
          <span className="small muted">Скин не выбран</span>
        </div>
      ) : (
        <div
          className={`skin-model ${walking ? 'is-walking' : ''}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotateX(${pitch}deg) rotateY(${yaw}deg)`,
            transition: dragging ? 'none' : 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* В Minecraft второй слой отстоит от головы на 0,5 пикселя, от тела и конечностей — на 0,25 */}
          <Part w={8} h={8} d={8} faces={HEAD} skin={tex ?? skin} texH={texH} x={4} y={0} unit={unit}
            className="skin-part--head"
            pixels={voxel} overlay={{ faces: HAT, enabled: layers.hat, inflate: headInflate }} />
          <Part w={8} h={12} d={4} faces={BODY} skin={tex ?? skin} texH={texH} x={4} y={8} unit={unit} pixels={voxel}
            className="skin-part--body"
            overlay={{ faces: JACKET, enabled: layers.jacket && !legacy, inflate: limbInflate }} />
          <Part w={armW} h={12} d={4} faces={rightArmFaces} skin={tex ?? skin} texH={texH} x={isSlim ? 1 : 0} y={8} unit={unit} pixels={voxel}
            className="skin-part--arm-r"
            overlay={{ faces: isSlim ? SLIM_SLEEVE_R : SLEEVE_R, enabled: layers.sleeves && !legacy, inflate: limbInflate }} />
          <Part w={armW} h={12} d={4} faces={leftArmFaces} skin={tex ?? skin} texH={texH} x={leftArmX} y={8} unit={unit} pixels={voxel}
            className="skin-part--arm-l"
            overlay={{ faces: isSlim ? SLIM_SLEEVE_L : SLEEVE_L, enabled: layers.sleeves && !legacy, inflate: limbInflate }} />
          <Part w={4} h={12} d={4} faces={LEG_R} skin={tex ?? skin} texH={texH} x={4} y={20} unit={unit} pixels={voxel}
            className="skin-part--leg-r"
            overlay={{ faces: PANTS_R, enabled: layers.pants && !legacy, inflate: limbInflate }} />
          <Part w={4} h={12} d={4} faces={leftLegFaces} skin={tex ?? skin} texH={texH} x={8} y={20} unit={unit} pixels={voxel}
            className="skin-part--leg-l"
            overlay={{ faces: PANTS_L, enabled: layers.pants && !legacy, inflate: limbInflate }} />
        </div>
      )}
    </div>
  );
}

export type { SkinLayers };