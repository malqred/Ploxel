import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, ListChecks, Rocket, SkipForward, X } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Overlay';
import { useSettings } from '../state/settings';
import { api } from '../api';
import { buildOnboardingSteps, type OnboardingMode } from '../onboarding/steps';
import {
  backProgress,
  clampIndex,
  createProgress,
  currentStep,
  measureTarget,
  nextProgress,
  skipProgress,
  type OnboardingProgress,
  type RectLike
} from '../onboarding/progress';

export function Onboarding() {
  const { settings, update } = useSettings();
  const [progress, setProgress] = useState<OnboardingProgress>(createProgress);
  const [mode, setMode] = useState<OnboardingMode | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [rect, setRect] = useState<RectLike | null>(null);
  const [importAvailable, setImportAvailable] = useState(false);

  useEffect(() => {
    // Обучение запустили заново из настроек — снова предлагаем режим.
    if (settings && !settings.general.onboardingDone) {
      setProgress(createProgress());
      setMode(null);
    }
  }, [settings?.general.onboardingDone]);

  useEffect(() => {
    void api
      .invoke<{ instances?: unknown[] }[]>('import:detect')
      .then((list) => setImportAvailable((list ?? []).some((l) => (l.instances?.length ?? 0) > 0)))
      .catch(() => setImportAvailable(false));
  }, []);

  const steps = useMemo(() => buildOnboardingSteps(importAvailable, mode ?? 'basic'), [importAvailable, mode]);

  const step = clampIndex(progress.index, steps);
  const current = currentStep(progress, steps);

  useEffect(() => {
    if (!mode || !current.route) return;
    if (window.location.hash !== `#${current.route}`) window.location.hash = current.route;
  }, [current.route, mode]);

  const measure = () => setRect(measureTarget(document, current.target));

  useLayoutEffect(() => {
    if (!mode) return;
    const timer = setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, current.target, current.route, mode]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmSkip(true);
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, steps.length, mode]);

  useEffect(() => {
    if (mode !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmSkip(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode]);

  if (!settings || settings.general.onboardingDone) return null;

  const finish = (skipped: boolean) => {
    void update({ general: { ...settings.general, onboardingDone: true } });
    setConfirmSkip(false);
    setProgress((p) => (skipped ? skipProgress(p) : { ...p, done: true }));
  };

  const next = () => {
    const result = nextProgress(progress, steps);
    if (result.done) finish(false);
    else setProgress(result);
  };
  const back = () => setProgress((p) => backProgress(p));

  const counts = {
    basic: buildOnboardingSteps(importAvailable, 'basic').length,
    detailed: buildOnboardingSteps(importAvailable, 'detailed').length
  };

  if (mode === null) {
    const width = 520;
    return (
      <div className="tour" role="dialog" aria-modal="true" aria-label="Знакомство с Ploxel">
        <div className="tour__shade tour__shade--dark" onClick={() => setConfirmSkip(true)} />
        <div
          className="tour__card"
          style={{
            left: Math.max(16, window.innerWidth / 2 - width / 2),
            top: Math.max(16, window.innerHeight / 2 - 220),
            width
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            <span className="tour__count">Начало</span>
            <div className="grow" />
            <button className="icon-btn icon-btn--sm icon-btn--ghost" onClick={() => setConfirmSkip(true)} aria-label="Пропустить">
              <X size={14} />
            </button>
          </div>
          <h2 className="tour__title">Как познакомить с лаунчером?</h2>
          <p className="tour__text">
            Базовый обзор — если вы уже играли в Minecraft. Подробный сначала проводит тот же базовый обзор, а
            затем добавляет диск для загрузок, управление и остальные разделы. Совсем не нужно — пропустите.
          </p>
          <div className="tour-mode">
            <button className="tour-mode__card" onClick={() => setMode('basic')}>
              <span className="tour-mode__icon">
                <Rocket size={20} />
              </span>
              <span className="tour-mode__title">Базовый</span>
              <span className="tour-mode__text">
                {`${counts.basic} шагов за минуту: аккаунт, сборки, запуск и моды.`}
              </span>
            </button>
            <button className="tour-mode__card tour-mode__card--detail" onClick={() => setMode('detailed')}>
              <span className="tour-mode__icon">
                <ListChecks size={20} />
              </span>
              <span className="tour-mode__title">Подробный</span>
              <span className="tour-mode__text">
                {`${counts.detailed} шагов: сначала базовый обзор, затем диск, управление, скины, помощник и обновления.`}
              </span>
            </button>
            <button className="tour-mode__card tour-mode__card--skip" onClick={() => finish(true)}>
              <span className="tour-mode__icon">
                <SkipForward size={20} />
              </span>
              <span className="tour-mode__title">Обучение не нужно</span>
              <span className="tour-mode__text">
                Сразу к лаунчеру. Запустить обучение можно позже в Настройки → Обучение.
              </span>
            </button>
          </div>
          <div className="tour__actions">
            <Button variant="ghost" size="sm" onClick={() => setConfirmSkip(true)}>
              Пропустить
            </Button>
            <div className="grow" />
            <span className="tiny muted">Выбор можно поменять позже</span>
          </div>
        </div>
        <SkipDialog open={confirmSkip} onClose={() => setConfirmSkip(false)} onSkip={() => finish(true)} />
      </div>
    );
  }

  const cardWidth = 380;
  const cardStyle: CSSProperties = rect
    ? {
        left: Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2)),
        top:
          rect.bottom + 250 < window.innerHeight
            ? rect.bottom + 16
            : Math.max(16, rect.top - 250)
      }
    : {
        left: window.innerWidth / 2 - cardWidth / 2,
        top: window.innerHeight / 2 - 140
      };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={current.title}>
      <div className={`tour__shade ${rect ? '' : 'tour__shade--dark'}`} onClick={() => setConfirmSkip(true)} />
      {rect && (
        <div
          className="tour__spot"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12
          }}
        />
      )}
      <div className="tour__card" style={{ ...cardStyle, width: cardWidth }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="tour__count">
            {step + 1} / {steps.length}
          </span>
          <div className="grow" />
          <button className="icon-btn icon-btn--sm icon-btn--ghost" onClick={() => setConfirmSkip(true)} aria-label="Пропустить">
            <X size={14} />
          </button>
        </div>
        <h2 className="tour__title">{current.title}</h2>
        <p className="tour__text">{current.text}</p>
        <div className="tour__dots">
          {steps.map((s, i) => (
            <span key={s.id} className="tour__dot" data-active={i === step ? 'true' : undefined} />
          ))}
        </div>
        <div className="tour__actions">
          <Button variant="ghost" size="sm" onClick={() => setConfirmSkip(true)}>
            Пропустить
          </Button>
          <div className="grow" />
          {step > 0 && (
            <Button variant="secondary" size="sm" icon={<ChevronLeft size={14} />} onClick={back}>
              Назад
            </Button>
          )}
          <Button size="sm" icon={<ChevronRight size={14} />} onClick={next}>
            {step >= steps.length - 1 ? 'Готово' : 'Далее'}
          </Button>
        </div>
      </div>

      <SkipDialog open={confirmSkip} onClose={() => setConfirmSkip(false)} onSkip={() => finish(true)} />
    </div>
  );
}

function SkipDialog({ open, onClose, onSkip }: { open: boolean; onClose: () => void; onSkip: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Пропустить обучение?"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Продолжить обучение
          </Button>
          <Button onClick={onSkip}>Пропустить</Button>
        </>
      }
    >
      <p>Обучение можно запустить снова в Настройки → Обучение.</p>
    </Modal>
  );
}