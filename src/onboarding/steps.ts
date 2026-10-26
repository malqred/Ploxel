export interface OnboardingStep {
  id: string;
  title: string;
  text: string;
  target?: string;
  route?: string;
  optional?: boolean;
}

/**
 * Режим знакомства: «Базовый» — короткий обзор, «Подробный» — тот же базовый
 * обзор, а после него дополнительные разделы. Обучение можно и не включать.
 */
export type OnboardingMode = 'basic' | 'detailed';

const INTRO: OnboardingStep = {
  id: 'welcome',
  title: 'Добро пожаловать в Ploxel',
  text: 'Покажу главное: аккаунт, запуск игры, сборки, моды, консоль и оформление. Это займёт минуту.'
};

function importStep(): OnboardingStep {
  return {
    id: 'import',
    title: 'Перенос сборок',
    text: 'На этом компьютере найдены другие лаунчеры. Их сборки можно импортировать во вкладке «Сборки» → «Импорт». Старые файлы останутся на месте.',
    target: '[data-tour="nav-library"]',
    route: '/library',
    optional: true
  };
}

/** Базовый обзор — общий для обоих режимов: подробный начинается с него же. */
function basicCore(importAvailable: boolean): OnboardingStep[] {
  return [
    INTRO,
    {
      id: 'account',
      title: 'Аккаунт',
      text: 'Нажмите на профиль внизу слева, чтобы войти через Microsoft или играть офлайн. Вход через Microsoft даёт скины и онлайн-серверы.',
      target: '.profile-card',
      route: '/home'
    },
    ...(importAvailable ? [importStep()] : []),
    {
      id: 'launch',
      title: 'Быстрый запуск',
      text: 'Выберите сборку и нажмите «Играть». Первый запуск дольше: скачиваются файлы игры и Java.',
      target: '[data-tour="launch"]',
      route: '/home'
    },
    {
      id: 'library',
      title: 'Сборки',
      text: 'Каждая сборка — отдельная папка: моды, конфиги и миры не смешиваются. Выберите версию и загрузчик вверху — сборка создастся сама.',
      target: '[data-tour="nav-library"]',
      route: '/library'
    },
    {
      id: 'mods',
      title: 'Библиотека модов',
      text: 'Здесь Modrinth и CurseForge: поиск, фильтры, страницы модов и установка в выбранную сборку.',
      target: '[data-tour="nav-mods"]',
      route: '/mods'
    },
    {
      id: 'console',
      title: 'Консоль и падения',
      text: 'Консоль показывает лог игры. Если игра упала — разбор причин и кнопка «Спросить ИИ» появятся здесь.',
      target: '[data-tour="nav-console"]',
      route: '/console'
    },
    {
      id: 'appearance',
      title: 'Оформление',
      text: 'Темы, акценты, шрифты, масштаб и язык — в настройках. Всё применяется сразу.',
      target: '[data-tour="nav-settings"]',
      route: '/settings?tab=appearance'
    }
  ];
}

function basicFinish(): OnboardingStep {
  return {
    id: 'finish',
    title: 'Готово',
    text: 'Обучение можно запустить снова в Настройки → Обучение. Приятной игры!'
  };
}

/** Дополнения подробного режима — идут после базового обзора. */
function detailedExtras(importAvailable: boolean): OnboardingStep[] {
  return [
    {
      id: 'storage',
      title: 'Куда скачивать',
      text: 'Версии игры, библиотеки, ассеты и Java занимают десятки гигабайт. В Настройки → Загрузки можно выбрать диск или другую папку: лаунчер перенесёт туда существующие сборки и файлы. Удобно, если на диске C мало места.',
      target: '[data-tour="nav-settings"]',
      route: '/settings?tab=downloads'
    },
    {
      id: 'creating',
      title: 'Больше параметров сборки',
      text: 'Быстрое создание подходит для большинства случаев. Кнопка «Больше параметров» открывает окно с названием, памятью, Java и выбором версии загрузчика — пригодится для крупных модпаков.',
      target: '[data-tour="library-more"]',
      route: '/library'
    },
    {
      id: 'controls',
      title: 'Настройки управления',
      text: 'Внизу меню — «Настройки управления»: все основные клавиши Minecraft 26.4. Общие привязки применяются к каждой новой сборке один раз, при создании. Если вы поменяли управление в самой игре, лаунчер его не перезапишет.',
      target: '[data-tour="nav-controls"]',
      route: '/controls'
    },
    {
      id: 'skins',
      title: 'Скины',
      text: 'В разделе «Скины» можно загрузить свой скин, нарисовать его по слоям и посмотреть в 3D. Для лицензионного аккаунта скин отправляется на серверы Mojang.',
      target: '[data-tour="nav-skins"]',
      route: '/skins'
    },
    {
      id: 'assistant',
      title: 'ИИ-помощник',
      text: 'Помощник объясняет ошибки и подбирает моды. Он работает, только если вы сами подключите ключ OpenAI-совместимого сервиса — без этого раздел останется выключенным.',
      target: '[data-tour="nav-assistant"]',
      route: '/assistant'
    },
    {
      id: 'guides',
      title: 'Гайды и поиск',
      text: 'На главной есть поиск по гайдам и настройкам: пишите своими словами — «куда кидать моды», «лагает», «нет звука». Гайды открываются кнопкой «Все гайды» и подсказывают шаги в текущей версии лаунчера.',
      target: '[data-tour="guides"]',
      route: '/home'
    },
    {
      id: 'updates',
      title: 'Обновления и удаление',
      text: 'В Настройки → О лаунчере можно проверить обновления. Там же находится удаление: лаунчер уберёт только эту версию и, если отметить галочку, ваши сборки — остальные файлы останутся.',
      target: '[data-tour="nav-settings"]',
      route: '/settings?tab=about'
    },
    ...(importAvailable ? [] : [
      {
        id: 'import-tip',
        title: 'Импорт из других лаунчеров',
        text: 'Если позже захотите перенести сборки, откройте «Сборки» → «Импорт»: лаунчер найдёт .minecraft, Prism, CurseForge и другие установленные лаунчеры.',
        target: '[data-tour="nav-library"]',
        route: '/library'
      } satisfies OnboardingStep
    ])
  ];
}

function basicSteps(importAvailable: boolean): OnboardingStep[] {
  return [...basicCore(importAvailable), basicFinish()];
}

function detailedSteps(importAvailable: boolean): OnboardingStep[] {
  return [
    ...basicCore(importAvailable),
    ...detailedExtras(importAvailable),
    {
      id: 'finish',
      title: 'Готово',
      text: 'Подробный гайд можно открыть в любой момент: «Библиотека» → «Гайды» или поиск на главной. Обучение запускается заново в Настройки → Обучение.'
    }
  ];
}

/** Шаги обучения. Шаг импорта появляется только если найдены другие лаунчеры. */
export function buildOnboardingSteps(importAvailable: boolean, mode: OnboardingMode = 'basic'): OnboardingStep[] {
  return mode === 'detailed' ? detailedSteps(importAvailable) : basicSteps(importAvailable);
}