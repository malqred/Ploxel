/**
 * Тип рук скина (Classic — 4 пикселя, Slim — 3) и перекладка текстуры между
 * ними. Работает с RGBA-пикселями скина 64×64 (Uint8ClampedArray из canvas).
 *
 * Развёртка руки занимает блок 16×16: сверху 4 строки — верх и низ, ниже
 * 12 строк — правая сторона, перед, левая сторона, спина. У Slim перед, спина,
 * верх и низ на пиксель уже, поэтому всё после переда сдвинуто влево.
 */

export type ArmModel = 'classic' | 'slim';

const W = 64;
const at = (x: number, y: number) => (y * W + x) * 4;

/** Блоки рук: правая, левая, рукав правой, рукав левой (левый верхний угол). */
const ARM_BLOCKS: [number, number][] = [
  [40, 16],
  [32, 48],
  [40, 32],
  [48, 48]
];

/**
 * Slim, если там, где у Classic лежат последние столбцы спины рук (и край
 * верха/низа), в основном пусто. Решает большинство пикселей, а не один:
 * в настоящих slim-скинах там встречаются случайные точки.
 */
export function detectArmModel(data: Uint8ClampedArray, height = 64): ArmModel {
  if (height !== 64 || data.length < W * 64 * 4) return 'classic';
  let opaque = 0;
  let total = 0;
  const check = (x: number, y: number) => {
    total++;
    if (data[at(x, y) + 3] > 0) opaque++;
  };
  for (let y = 20; y < 32; y++) for (const x of [54, 55]) check(x, y);
  for (let y = 52; y < 64; y++) for (const x of [46, 47]) check(x, y);
  for (let y = 16; y < 20; y++) for (const x of [50, 51]) check(x, y);
  for (let y = 48; y < 52; y++) for (const x of [42, 43]) check(x, y);
  return opaque / total < 0.3 ? 'slim' : 'classic';
}

/** Прямоугольники развёртки руки внутри блока 16×16. */
function layout(model: ArmModel) {
  const n = model === 'slim' ? 3 : 4;
  return {
    top: { x: 4, y: 0, w: n, h: 4 },
    bottom: { x: 4 + n, y: 0, w: n, h: 4 },
    right: { x: 0, y: 4, w: 4, h: 12 },
    front: { x: 4, y: 4, w: n, h: 12 },
    left: { x: 4 + n, y: 4, w: 4, h: 12 },
    back: { x: 8 + n, y: 4, w: n, h: 12 }
  };
}

/** Какой исходный столбец взять для каждого столбца результата. */
function columnMap(from: number, to: number): number[] {
  if (from === to) return Array.from({ length: to }, (_, i) => i);
  // 3 → 4: средний столбец дублируется; 4 → 3: убирается третий столбец
  return from === 3 ? [0, 1, 1, 2] : [0, 1, 3];
}

/** Перекладывает руки скина под другой тип. Возвращает новый массив пикселей. */
export function convertArms(data: Uint8ClampedArray, from: ArmModel, to: ArmModel): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  if (from === to) return out;
  const src = layout(from);
  const dst = layout(to);
  for (const [bx, by] of ARM_BLOCKS) {
    // Очищаем блок и раскладываем каждую грань заново
    for (let y = by; y < by + 16; y++) {
      for (let x = bx; x < bx + 16; x++) {
        const i = at(x, y);
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      }
    }
    for (const face of Object.keys(src) as (keyof typeof src)[]) {
      const s = src[face];
      const d = dst[face];
      const map = columnMap(s.w, d.w);
      for (let row = 0; row < d.h; row++) {
        for (let col = 0; col < d.w; col++) {
          const si = at(bx + s.x + map[col], by + s.y + row);
          const di = at(bx + d.x + col, by + d.y + row);
          out[di] = data[si];
          out[di + 1] = data[si + 1];
          out[di + 2] = data[si + 2];
          out[di + 3] = data[si + 3];
        }
      }
    }
  }
  return out;
}
