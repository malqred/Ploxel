import { getConfig } from './config';
import { loadSettings } from './settings';
import { getSecret } from './secrets';

/**
 * ИИ-помощник.
 *
 * Провайдер — любой OpenAI-совместимый API (OpenAI, OpenRouter, Groq,
 * локальный LM Studio/Ollama). Ключ берётся из настроек (зашифрован на диске)
 * либо из config.json. Без ключа функция выключается с понятным сообщением.
 *
 * Перед отправкой лог очищается от персональных данных, а пользователь
 * видит предпросмотр и подтверждает отправку.
 */

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  source: 'settings' | 'config' | 'none';
}

export function resolveAiConfig(): AiConfig {
  const settings = loadSettings().ai;
  const cfg = getConfig();
  const storedKey = getSecret('ai-key');
  if (storedKey) {
    return {
      baseUrl: settings.baseUrl || cfg.aiBaseUrl || 'https://api.openai.com/v1',
      model: settings.model || cfg.aiModel || 'gpt-4o-mini',
      apiKey: storedKey,
      source: 'settings'
    };
  }
  if (cfg.aiApiKey) {
    return {
      baseUrl: settings.baseUrl || cfg.aiBaseUrl,
      model: settings.model || cfg.aiModel,
      apiKey: cfg.aiApiKey,
      source: 'config'
    };
  }
  return {
    baseUrl: settings.baseUrl || cfg.aiBaseUrl || 'https://api.openai.com/v1',
    model: settings.model || cfg.aiModel || 'gpt-4o-mini',
    apiKey: '',
    source: 'none'
  };
}

export function aiAvailable(): boolean {
  return !!resolveAiConfig().apiKey;
}

/** Убирает из текста ник, пути, токены, IP-адреса и прочие личные данные. */
export function sanitizeLog(text: string, nick?: string): string {
  let out = text;
  if (nick && nick.length >= 3) {
    out = out.replaceAll(nick, '<ник>');
  }
  // Windows: C:\Users\Имя\... и вообще абсолютные пути
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '<дом>');
  out = out.replace(/[A-Za-z]:\\(?:[^\\\s:*?"<>|]+\\)*[^\\\s:*?"<>|]*/g, '<путь>');
  // POSIX home
  out = out.replace(/\/(?:home|Users)\/[^\s/]+/g, '<дом>');
  // Токены и ключи
  out = out.replace(/(accessToken|access_token|session|token|Bearer)[=:\s]+[A-Za-z0-9._~+/=-]{12,}/gi, '$1=<скрыто>');
  out = out.replace(/\b[0-9a-f]{32}\b/gi, '<id>');
  // IP-адреса (серверы/локальная сеть)
  out = out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>');
  // UUID
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>');
  return out;
}

export interface LogAnalysis {
  preview: string;
  answer: string;
}

/** Язык ответа ИИ — язык интерфейса лаунчера. */
const REPLY_LANGUAGE: Record<string, string> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pl: 'Polish', sv: 'Swedish',
  fi: 'Finnish', uk: 'Ukrainian', ko: 'Korean', ja: 'Japanese', zh: 'Simplified Chinese'
};
function replyIn(): string {
  const lang = loadSettings().general.language;
  return REPLY_LANGUAGE[lang] ? `Отвечай на языке пользователя: ${REPLY_LANGUAGE[lang]}` : 'Отвечай по-русски';
}

const systemPrompt = () => `Ты — помощник лаунчера Minecraft. ${replyIn()}, коротко и по делу.
Пользователь — новичок. Объясни причину ошибки простыми словами, затем предложи
2–4 конкретных шага исправления. Не советуй обходить лицензию и не проси
персональные данные. Если в логе нет явной ошибки, скажи, что критических
ошибок не видно, и предложи, что проверить.`;

export async function analyzeLog(rawLog: string, nick?: string): Promise<LogAnalysis> {
  const cfg = resolveAiConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'ИИ-помощник не настроен. Укажите API-ключ в Настройки → ИИ-помощник (поддерживается любой OpenAI-совместимый сервис).'
    );
  }
  const preview = truncate(sanitizeLog(rawLog, nick), 12000);
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: `Лог лаунчера и игры:\n\n${preview}\n\nЧто случилось и как исправить?` }
      ]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ИИ ответил ошибкой ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return { preview, answer: json.choices?.[0]?.message?.content ?? 'Пустой ответ.' };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Чат с ИИ-помощником лаунчера. */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const cfg = resolveAiConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'ИИ-помощник не настроен. Настройки → ИИ-помощник: подойдёт локальная модель или бесплатный ключ.'
    );
  }
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.4,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content:
            `Ты — помощник лаунчера Ploxel для Minecraft: Java Edition. ${replyIn()}, кратко и по шагам. ` +
            'Помогай с выбором версии и загрузчика, памятью, Java, модами, шейдерами, мирами, ошибками и настройками лаунчера. ' +
            'Не предлагай обходить лицензию и не проси персональные данные.'
        },
        ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content }))
      ]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ИИ ответил ошибкой ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices?.[0]?.message?.content ?? 'Пустой ответ.';
}

export async function testAi(): Promise<string> {
  const cfg = resolveAiConfig();
  if (!cfg.apiKey) throw new Error('Ключ не задан');
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Ответь одним словом: работает' }]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return `Подключение работает. Ответ модели: «${(json.choices?.[0]?.message?.content ?? '').trim().slice(0, 80)}»`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `…(начало скрыто)…\n${text.slice(-limit)}`;
}
export interface AiBuildDraft {
  gameVersion?: string;
  loader?: string;
  name?: string;
  summary?: string;
  mods: { name: string; reason?: string }[];
  resourcepacks: { name: string; reason?: string }[];
  shaders: { name: string; reason?: string }[];
}

/** Достаёт JSON из ответа модели: без ```-обёрток и пояснений вокруг. */
export function parseBuildDraft(text: string): AiBuildDraft {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('ИИ ответил не списком модов. Попробуйте ещё раз или уточните запрос.');
  const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((x) => (typeof x === 'string' ? { name: x } : (x as { name?: unknown; reason?: unknown })))
      .filter((x) => x && typeof x.name === 'string' && x.name.trim())
      .map((x) => ({ name: String(x.name).trim(), reason: typeof x.reason === 'string' ? x.reason.trim() : undefined }));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    gameVersion: str(raw.gameVersion),
    loader: str(raw.loader)?.toLowerCase(),
    name: str(raw.name),
    summary: str(raw.summary),
    mods: list(raw.mods),
    resourcepacks: list(raw.resourcepacks),
    shaders: list(raw.shaders)
  };
}

export type ModCountRange = '0-20' | '20-50' | '50-100' | '100-200' | '200+';
export const MOD_COUNT: Record<ModCountRange, [number, number]> = {
  '0-20': [0, 20],
  '20-50': [20, 50],
  '50-100': [50, 100],
  '100-200': [100, 200],
  '200+': [200, 260]
};

export interface DraftOptions {
  gameVersion: string;
  loader: 'fabric' | 'quilt' | 'forge' | 'neoforge';
  count: ModCountRange;
}

/**
 * Основа любой сборки, о которой пользователь не обязан писать: оптимизация
 * под выбранные версию и загрузчик и 3D Skin Layers. QoL-моды сюда не входят —
 * их ИИ берёт, только если пользователь сам о них попросил.
 */
export function baseSetRules(gameVersion: string, loader: string): string {
  const fabricLike = loader === 'fabric' || loader === 'quilt';
  const optimization = fabricLike
    ? 'Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling, ModernFix, Dynamic FPS'
    : 'Embeddium (или Sodium, если у него есть версия для NeoForge этой версии игры), FerriteCore, ModernFix, Entity Culling, ImmediatelyFast';
  return `Обязательная основа (даже если пользователь о ней не писал):
- оптимизация, подобранная строго под Minecraft ${gameVersion} и ${loader}: ${optimization} — только те, у которых есть версия под эти игру и загрузчик, без дублей по назначению;
- 3D Skin Layers — объёмный второй слой скинов.
Моды для удобства (QoL: инвентарь, рецепты, миникарта, подсказки и т. п.) сам не добавляй — только если пользователь прямо попросил их или удобство.`;
}

/** Подбор сборки: ИИ возвращает JSON со списком проектов Modrinth. */
export async function draftBuild(description: string, opts: DraftOptions): Promise<AiBuildDraft> {
  const cfg = resolveAiConfig();
  if (!cfg.apiKey) throw new Error('ИИ-помощник не настроен. Укажите ключ в Настройки → ИИ-помощник.');
  const [min, max] = MOD_COUNT[opts.count] ?? MOD_COUNT['0-20'];
  const big = max > 60;
  const shaderLoader = opts.loader === 'forge' ? 'Oculus' : 'Iris Shaders';
  const lang = replyIn().replace('Отвечай на языке пользователя: ', '').replace('Отвечай по-русски', 'русский');
  const system = `Ты собираешь сборку Minecraft: Java Edition под пожелания пользователя.
Пользователь уже выбрал в интерфейсе: версия игры ${opts.gameVersion}, загрузчик ${opts.loader}. Это не обсуждается — даже если в тексте написано другое.
Ответь ТОЛЬКО JSON-объектом без пояснений и без markdown:
{"name":"короткое название сборки","summary":"одна фраза о сборке",
"mods":[{"name":"Sodium","reason":"${big ? '2–4 слова' : 'зачем, 3–8 слов'}"}],"resourcepacks":[{"name":"...","reason":"..."}],"shaders":[{"name":"...","reason":"..."}]}
Количество модов: ${min === 0 ? `не больше ${max}` : `от ${min} до ${max}`}.
${baseSetRules(opts.gameVersion, opts.loader)}
Перед ответом проверь каждый мод:
- он есть на Modrinth, name — его точное английское название там;
- у него есть версия именно для Minecraft ${opts.gameVersion} и загрузчика ${opts.loader} (не бери моды только для ${opts.loader === 'fabric' || opts.loader === 'quilt' ? 'Forge/NeoForge' : 'Fabric'});
- он совместим со всеми остальными модами списка: никакого OptiFine; не сочетай Sodium с Embeddium/Rubidium, Iris с Oculus, Lithium с Canary/Radium;
- не дублируй функции: один мод рецептов (JEI, REI или EMI), одна миникарта, один мод подсказок о блоках (Jade, WTHIT или The One Probe);
- аддоны берёшь только вместе с их основой (аддоны Create — вместе с Create и т. п.);
- не добавляй устаревшие моды: Indium, Phosphor, Starlight.
Если есть шейдеры, добавь в mods «${shaderLoader}». Библиотеки (Fabric API, Cloth Config, Architectury и т.п.) не перечисляй — лаунчер докачает их сам.
Ресурспаки и шейдеры добавляй, только если они уместны по запросу.
name, reason и summary пиши на языке пользователя (${lang}).`;
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: Math.min(14000, Math.max(2000, 600 + max * (big ? 28 : 40))),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: description }
      ]
    }),
    signal: AbortSignal.timeout(big ? 240000 : 120000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ИИ ответил ошибкой ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const draft = parseBuildDraft(json.choices?.[0]?.message?.content ?? '');
  return { ...draft, gameVersion: opts.gameVersion, loader: opts.loader };
}

/**
 * «Улучшить с ИИ»: ИИ получает список модов сборки и пожелание пользователя
 * и предлагает только новые проекты. Как улучшать — решает пользователь;
 * сверх его запроса ничего не добавляется.
 */
export async function draftImprove(
  description: string,
  ctx: { gameVersion: string; loader: string; installed: string[] }
): Promise<AiBuildDraft> {
  const cfg = resolveAiConfig();
  if (!cfg.apiKey) throw new Error('ИИ-помощник не настроен. Укажите ключ в Настройки → ИИ-помощник.');
  const lang = replyIn().replace('Отвечай на языке пользователя: ', '').replace('Отвечай по-русски', 'русский');
  const installed = ctx.installed.length ? ctx.installed.slice(0, 400).join(', ') : '(модов нет)';
  const system = `Ты улучшаешь готовую сборку Minecraft: Java Edition. Версия игры ${ctx.gameVersion}, загрузчик ${ctx.loader}.
Уже установлено: ${installed}.
Пользователь пишет, КАК улучшить сборку. Предлагай только то, что нужно для его запроса, ничего сверх.
Ответь ТОЛЬКО JSON-объектом без пояснений и без markdown:
{"summary":"одна фраза, что изменится","mods":[{"name":"...","reason":"зачем, 3–8 слов"}],"resourcepacks":[...],"shaders":[...]}
Правила:
- только НОВЫЕ проекты: не повторяй установленные и не добавляй моды с той же задачей, что у установленных;
- каждый мод есть на Modrinth (name — точное английское название), у него есть версия для Minecraft ${ctx.gameVersion} и ${ctx.loader};
- всё совместимо с установленными модами и между собой; никакого OptiFine;
- аддоны — только если их основа уже стоит или тоже добавляется;
- библиотеки (Fabric API, Cloth Config и т.п.) не перечисляй — лаунчер докачает их сам;
- если для шейдеров нужен загрузчик шейдеров и его нет в сборке — добавь «${ctx.loader === 'forge' ? 'Oculus' : 'Iris Shaders'}».
reason и summary пиши на языке пользователя (${lang}).`;
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: description }
      ]
    }),
    signal: AbortSignal.timeout(150000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ИИ ответил ошибкой ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const draft = parseBuildDraft(json.choices?.[0]?.message?.content ?? '');
  return { ...draft, gameVersion: ctx.gameVersion, loader: ctx.loader };
}
