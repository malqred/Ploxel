import { useEffect, useRef, useState } from 'react';
import { Download, Eraser, Pencil, RotateCcw, Save } from 'lucide-react';
import { Button, IconButton } from '../ui/Button';

const SIZE = 64;
const PALETTE = [
  '#000000', '#3f3f3f', '#7f7f7f', '#bfbfbf', '#ffffff',
  '#7e9c89', '#5f7d6b', '#9b86c4', '#6e9db5', '#c4826a',
  '#d9a441', '#c77b8c', '#5fa37a', '#8b5a2b', '#5a3a22',
  '#e8c39e', '#d8a47f', '#b07f5a', '#4a6fa5', '#2e4c7a',
  '#8f2f2f', '#c0392b', '#f1c40f', '#145a32'
];

/**
 * Пиксельный редактор скина: рисует прямо по PNG 64×64.
 * Данные хранятся в ImageData, масштаб — только для показа.
 */
export function SkinEditor({
  skin,
  onChange,
  onSave,
  onDownload
}: {
  skin: string | null;
  onChange: (dataUrl: string) => void;
  onSave: (dataUrl: string) => void;
  /** скачать скин из предпросмотра в выбранный файл */
  onDownload?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<ImageData | null>(null);
  const undoRef = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const [color, setColor] = useState('#7e9c89');
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [canUndo, setCanUndo] = useState(false);

  const render = () => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const off = document.createElement('canvas');
    off.width = SIZE;
    off.height = SIZE;
    const offCtx = off.getContext('2d')!;
    offCtx.putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    const step = canvas.width / SIZE;
    for (let i = 1; i < SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(canvas.width, i * step);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const reset = () => {
      dataRef.current = ctx.createImageData(SIZE, SIZE);
      undoRef.current = [];
      setCanUndo(false);
      render();
    };
    if (!skin) {
      reset();
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0);
      dataRef.current = ctx.getImageData(0, 0, SIZE, SIZE);
      undoRef.current = [];
      setCanUndo(false);
      render();
    };
    img.onerror = reset;
    img.src = skin;
  }, [skin]);

  const pixelAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * SIZE);
    return { x: Math.max(0, Math.min(SIZE - 1, x)), y: Math.max(0, Math.min(SIZE - 1, y)) };
  };

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const data = dataRef.current;
    if (!data) return;
    const { x, y } = pixelAt(e);
    const i = (y * SIZE + x) * 4;
    if (tool === 'eraser') {
      data.data[i] = 0;
      data.data[i + 1] = 0;
      data.data[i + 2] = 0;
      data.data[i + 3] = 0;
    } else {
      const [r, g, b] = hexToRgb(color);
      data.data[i] = r;
      data.data[i + 1] = g;
      data.data[i + 2] = b;
      data.data[i + 3] = 255;
    }
    render();
  };

  const snapshot = () => {
    const data = dataRef.current;
    if (!data) return;
    undoRef.current.push(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height));
    if (undoRef.current.length > 40) undoRef.current.shift();
    setCanUndo(true);
  };

  const dataUrl = () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const data = dataRef.current;
    if (data) canvas.getContext('2d')!.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    dataRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    render();
    onChange(dataUrl());
  };

  return (
    <div className="skin-editor">
      <div className="skin-editor__tools">
        {onDownload && (
          <IconButton label="Скачать скин" size="sm" onClick={onDownload} disabled={!skin}>
            <Download size={14} />
          </IconButton>
        )}
        <IconButton label={tool === 'brush' ? 'Кисть включена' : 'Кисть'} size="sm" onClick={() => setTool('brush')}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label="Ластик" size="sm" onClick={() => setTool('eraser')}>
          <Eraser size={14} />
        </IconButton>
        <IconButton label="Отменить" size="sm" onClick={undo} disabled={!canUndo}>
          <RotateCcw size={14} />
        </IconButton>
        <input className="custom-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Свой цвет" />
        <span className="tiny muted">или из палитры</span>
      </div>

      <canvas
        ref={canvasRef}
        className="skin-editor__canvas"
        width={256}
        height={256}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drawing.current = true;
          snapshot();
          paint(e);
        }}
        onPointerMove={(e) => {
          if (drawing.current) paint(e);
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          onChange(dataUrl());
        }}
        onPointerLeave={() => {
          if (drawing.current) {
            drawing.current = false;
            onChange(dataUrl());
          }
        }}
      />

      <div className="skin-editor__palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            className="palette-dot"
            style={{ background: c }}
            aria-label={c}
            aria-pressed={color.toLowerCase() === c}
            onClick={() => {
              setColor(c);
              setTool('brush');
            }}
          />
        ))}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" icon={<Save size={14} />} onClick={() => onSave(dataUrl())}>
          Сохранить скин
        </Button>
        <span className="tiny muted">Кисть 1×1, сетка — пиксели 64×64.</span>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}