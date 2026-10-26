import type { OnboardingStep } from './steps';

/** Чистое состояние обучения — без DOM и Electron, чтобы его покрывали тесты. */
export interface OnboardingProgress {
  index: number;
  done: boolean;
  skipped: boolean;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export function createProgress(): OnboardingProgress {
  return { index: 0, done: false, skipped: false };
}

/** Продолжить обучение можно только если оно не завершено. */
export function resumeProgress(done: boolean): OnboardingProgress | null {
  return done ? null : createProgress();
}

export function clampIndex(index: number, steps: OnboardingStep[]): number {
  if (!steps.length) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(steps.length - 1, Math.trunc(index)));
}

/** Шаг по индексу; если шагов стало меньше (пропал необязательный шаг) — последний. */
export function currentStep(progress: OnboardingProgress, steps: OnboardingStep[]): OnboardingStep {
  return steps[clampIndex(progress.index, steps)];
}

export function nextProgress(progress: OnboardingProgress, steps: OnboardingStep[]): OnboardingProgress {
  const index = clampIndex(progress.index, steps);
  if (index >= steps.length - 1) return { ...progress, index, done: true };
  return { ...progress, index: index + 1 };
}

export function backProgress(progress: OnboardingProgress): OnboardingProgress {
  return { ...progress, index: Math.max(0, progress.index - 1) };
}

export function skipProgress(progress: OnboardingProgress): OnboardingProgress {
  return { ...progress, done: true, skipped: true };
}

/** Прямоугольник цели подсветки; null — цели нет, карточка показывается по центру. */
export function measureTarget(doc: Pick<Document, 'querySelector'>, selector?: string): RectLike | null {
  if (!selector) return null;
  let el: Element | null = null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r || r.width < 4 || r.height < 4) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
}