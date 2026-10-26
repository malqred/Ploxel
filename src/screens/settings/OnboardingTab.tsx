import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Row, Section } from './parts';

export function OnboardingTab() {
  const { settings, update } = useSettings();
  if (!settings) return null;

  return (
    <Section
      title="Обучение"
      hint="Тур по лаунчеру: при первом запуске можно выбрать базовый обзор, подробный (базовый, затем дополнительные разделы) или отказаться от обучения."
    >
      <Row
        label="Обучение при первом запуске"
        hint={
          settings.general.onboardingDone
            ? 'Тур уже пройден или пропущен. Можно запустить снова в любой момент.'
            : 'Тур будет показан при следующем запуске.'
        }
      >
        <span className={`chip ${settings.general.onboardingDone ? '' : 'chip--accent'}`}>
          {settings.general.onboardingDone ? 'пройдено' : 'ожидает'}
        </span>
        <Button
          size="sm"
          onClick={() => {
            void update({ general: { ...settings.general, onboardingDone: false } });
            window.location.hash = '/home';
          }}
        >
          Запустить обучение
        </Button>
      </Row>
      <p className="tiny muted">
        Тур можно закрыть в любой момент кнопкой «Пропустить» или Esc. Элементы, которых нет на экране,
        пропускаются автоматически. Отказаться от обучения можно прямо в окне выбора режима.
      </p>
    </Section>
  );
}