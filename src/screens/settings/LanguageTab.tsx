import { useSettings } from '../../state/settings';
import { setLanguage } from '../../i18n';
import { LANGUAGES } from '../../i18n/languages';
import { Section } from './parts';

export function LanguageTab() {
  const { settings, update } = useSettings();
  if (!settings) return null;
  const current = settings.general.language;

  const choose = async (id: string) => {
    await update({ general: { ...settings.general, language: id } });
    setLanguage(id);
  };

  return (
    <Section
      title="Язык интерфейса"
      hint="Название на текущем языке — крупно, на самом языке — в скобках. Перевод интерфейса машинный и применяется сразу."
    >
      <div className="lang-grid">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.id}
            className="lang-card"
            aria-pressed={current === lang.id}
            onClick={() => choose(lang.id)}
          >
            <span className="lang-card__name">{lang.ru}</span>
            <span className="lang-card__native" data-i18n-skip>({lang.native})</span>
          </button>
        ))}
      </div>
      <p className="tiny muted">
        Тексты модов и описания страниц переводятся отдельно — кнопкой перевода на странице материала.
      </p>
    </Section>
  );
}