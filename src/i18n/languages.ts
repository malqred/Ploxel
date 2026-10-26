export interface LanguageDef {
  id: string;
  /** Название на русском — его переводит слой локализации на текущий язык. */
  ru: string;
  native: string;
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'ru', ru: 'Русский', native: 'Русский' },
  { id: 'en', ru: 'Английский', native: 'English' },
  { id: 'fr', ru: 'Французский', native: 'Français' },
  { id: 'es', ru: 'Испанский', native: 'Español' },
  { id: 'de', ru: 'Немецкий', native: 'Deutsch' },
  { id: 'it', ru: 'Итальянский', native: 'Italiano' },
  { id: 'pl', ru: 'Польский', native: 'Polski' },
  { id: 'sv', ru: 'Шведский', native: 'Svenska' },
  { id: 'fi', ru: 'Финский', native: 'Suomi' },
  { id: 'uk', ru: 'Украинский', native: 'Українська' },
  { id: 'ko', ru: 'Корейский', native: '한국어' },
  { id: 'ja', ru: 'Японский', native: '日本語' },
  { id: 'zh', ru: 'Китайский', native: '中文' }
];