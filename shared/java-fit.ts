/**
 * Подходит ли Java для версии игры. Слишком новая ломает старые версии и Forge
 * (Java 25 не запускает Forge 1.20.1, Java 17 — Forge 1.12.2), поэтому
 * допускаем только требуемую мажорную версию или чуть новее, до 21.
 */
export function javaFits(major: number, required: number): boolean {
  if (major < required) return false;
  if (required <= 8) return major === 8;
  return major <= Math.max(required, 21);
}
