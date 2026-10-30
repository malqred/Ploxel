/**
 * Рекомендуемая память для сборки — по версии игры, загрузчику и тому, какие
 * моды стоят. Основа — общие советы сообществ и авторов модпаков:
 *  - ванильной игре и пустой сборке хватает 2–3 ГБ (официальный лаунчер даёт 2 ГБ);
 *  - до ~75 модов — 4–6 ГБ, 100–200 модов — 6–10 ГБ, огромные модпаки — 10–12 ГБ;
 *  - шейдеры, Distant Horizons и HD-ресурспаки добавляют сверху;
 *  - больше 12–16 ГБ обычно вредно: сборка мусора Java начинает «подвисать».
 * Каждый мод весит по своей категории: оптимизация и библиотеки почти ничего,
 * мелкие улучшения (QoL) — немного, контент (бои, мобы, миры, техника, магия,
 * прорисовка) — больше, известные «тяжёлые» моды — ещё больше. Чем больше модов,
 * тем меньше прибавка за каждый следующий: часть памяти у них общая.
 */

export type ModWeightGroup = 'optimization' | 'library' | 'light' | 'content' | 'heavy';

export interface AdviceMod {
  name: string;
  fileName?: string;
  slug?: string;
  /** категории Modrinth, если мод оттуда */
  categories?: string[];
}

export interface AdviceInput {
  gameVersion: string;
  loader: string;
  mods: AdviceMod[];
  /** включённые шейдерпаки */
  shaderPacks?: number;
  /** размеры включённых ресурспаков, МБ */
  resourcePackSizesMb?: number[];
  /** вся память компьютера, ГБ (чтобы не советовать больше, чем есть) */
  totalGb?: number;
}

export interface AdvicePart {
  label: string;
  gb: number;
  /** сколько модов в группе */
  count?: number;
  /** пояснение без перевода: версия и загрузчик */
  detail?: string;
}

export interface MemoryAdvice {
  /** рекомендуемая память, целые ГБ */
  gb: number;
  /** из чего сложилась цифра (для подсказки «почему столько») */
  parts: AdvicePart[];
  /** рекомендация урезана памятью компьютера */
  limitedByPc: boolean;
  /** сколько получилось бы без ограничения компьютера */
  idealGb: number;
}

export const GROUP_WEIGHT: Record<ModWeightGroup, number> = {
  optimization: 0.02,
  library: 0.03,
  light: 0.08,
  content: 0.1,
  heavy: 0.3
};

const GROUP_LABEL: Record<ModWeightGroup, string> = {
  optimization: 'оптимизация',
  library: 'библиотеки',
  light: 'мелкие улучшения',
  content: 'контент и прорисовка',
  heavy: 'тяжёлые моды'
};

const key = (s: string) => s.toLowerCase().replace(/\.(jar|zip|disabled)$/g, '').replace(/[^a-z0-9]/g, '');

/** Части названий: начало ключа или вхождение (ключ — без пробелов и дефисов). */
const HEAVY = [
  'create', 'alexsmobs', 'alexscaves', 'biomesoplenty', 'twilightforest', 'mekanism', 'iceandfire', 'cataclysm',
  'epicfight', 'physicsmod', 'arsnouveau', 'theaether', 'aether', 'thermalexpansion', 'thermalfoundation',
  'appliedenergistics', 'ae2', 'immersiveengineering', 'botania', 'tconstruct', 'tinkersconstruct', 'bloodmagic',
  'ironsspellbooks', 'ironsspells', 'mowziesmobs', 'quark', 'adastra', 'bumblezone', 'blueskies', 'deeperdarker',
  'betternether', 'betterend', 'regionsunexplored', 'ohthebiomesyoullgo', 'byg', 'oritech', 'modernindustrialization',
  'gregtech', 'industrialforegoing', 'occultism', 'mca', 'minecraftcomesalive', 'valkyrienskies', 'ftbquests',
  'dimensionaldoors', 'galacticraft', 'tacz', 'timelessandclassics', 'pointblank', 'vics', 'securitycraft'
];

const OPTIMIZATION = [
  'sodium', 'lithium', 'phosphor', 'starlight', 'ferritecore', 'modernfix', 'entityculling', 'immediatelyfast', 'c2me',
  'krypton', 'moreculling', 'dynamicfps', 'fastload', 'lazydfu', 'smoothboot', 'memoryleakfix', 'noisium',
  'embeddium', 'rubidium', 'canary', 'radium', 'saturn', 'betterfpsdist', 'clumps', 'cullleaves', 'enhancedblockentities',
  'fpsreducer', 'nvidium', 'vmp', 'veryManyPlayers', 'servercore', 'alternatecurrent', 'scalablelux', 'badoptimizations',
  'ksyxis', 'exordium', 'cullless', 'fastquit', 'threadtweak', 'letmedespawn', 'chunky', 'lmd', 'redirector',
  'getittogether', 'mixintrace', 'fastfurnace', 'fastworkbench', 'fastsuite', 'bettermodsbutton'
].map(key);

const LIBRARY = [
  'fabricapi', 'fabriclanguagekotlin', 'kotlinforforge', 'kotlinlang', 'architectury', 'geckolib', 'clothconfig',
  'forgeconfigapiport', 'mixinextras', 'balm', 'puzzleslib', 'bookshelf', 'citadel', 'curios', 'trinkets', 'accessories',
  'placebo', 'creativecore', 'framework', 'resourcefulconfig', 'resourcefullib', 'yacl', 'yetanotherconfiglib', 'owo',
  'cardinalcomponents', 'terrablender', 'collective', 'cupboard', 'moonlight', 'lithostitched', 'playeranimator',
  'playeranimationlib', 'midnightlib', 'searchables', 'fzzyconfig', 'jamlib', 'konkrete', 'fancymenu', 'connector',
  'quiltedfabricapi', 'qsl', 'indium', 'satin', 'iceberg', 'prism', 'coroutil', 'zeta', 'autoreglib', 'glitchcore',
  'supermartijn642', 'corelib', 'blueprint', 'structurize', 'domum', 'patchouli', 'modonomicon', 'lodestone'
].map(key);

const LIGHT = [
  'modmenu', 'mousetweaks', 'appleskin', 'jade', 'wthit', 'hwyla', 'inventoryprofiles', 'zoomify', 'betterf3',
  'controlling', 'shulkerboxtooltip', 'jei', 'justenoughitems', 'rei', 'roughlyenoughitems', 'emi', 'chatheads',
  'reeses', 'betterthirdperson', 'freecam', 'durabilitytooltip', 'itemborders', 'boatitemview', 'blur',
  'betterpingdisplay', 'notenoughcrashes', 'craftpresence', 'simplevoicechat', 'voicechat', 'xaerosminimap',
  'xaerosworldmap', 'journeymap', 'betterstats', 'betteradvancements', 'searchinventory', 'inventorysorter',
  'cleanview', 'nochatreports', 'iris', 'oculus', 'stendhal', 'charmonium', 'carryon', 'torohealth', 'waystones', 'travelersbackpack'
].map(key);

/** Прорисовка и анимации — грузят память моделями и текстурами, считаем контентом. */
const VISUAL = [
  'entitymodelfeatures', 'entitytexturefeatures', 'emf', 'etf', 'notenoughanimations', 'skinlayers3d', '3dskinlayers',
  'fallingleaves', 'particlerain', 'visuality', 'effective', 'wavey', 'lambdynamiclights', 'dynamiclights',
  'continuity', 'cit', 'animatica', 'betterclouds', 'presencefootsteps', 'ambientsounds', 'soundphysics', 'firstperson',
  'betteranimations', 'eatinganimation', 'itemphysic', 'realisticsleep', 'illuminations', 'fancyblockparticles',
  'subtleeffects', 'cubesgalore', 'betterlanterns'
].map(key);

const CONTENT_CATEGORIES = new Set([
  'adventure', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'magic', 'mobs', 'storage',
  'technology', 'transportation', 'worldgen', 'minigame'
]);
const LIGHT_CATEGORIES = new Set(['utility', 'management', 'social', 'cursed']);

const MEMORY_SAVERS = ['ferritecore', 'modernfix'].map(key);
const SHADER_LOADERS = ['iris', 'oculus', 'optifine', 'optifabric'].map(key);

function matches(list: string[], ids: string[]): boolean {
  return ids.some((id) => id.length > 0 && list.some((k) => id === k || (k.length >= 4 && id.startsWith(k))));
}

function idsOf(mod: AdviceMod): string[] {
  const out = [mod.slug, mod.name, mod.fileName?.replace(/[-_+ ]?(mc)?\d.*$/i, '')].filter(Boolean).map((s) => key(s!));
  return [...new Set(out)];
}

/** К какой «весовой» группе относится мод. */
export function classifyMod(mod: AdviceMod): ModWeightGroup {
  const ids = idsOf(mod);
  const cats = new Set(mod.categories ?? []);
  if (matches(HEAVY, ids)) return 'heavy';
  if (matches(OPTIMIZATION, ids) || cats.has('optimization')) return 'optimization';
  if (matches(LIBRARY, ids) || cats.has('library') || ids.some((id) => /(api|lib|library)$/.test(id))) return 'library';
  if (matches(VISUAL, ids)) return 'content';
  if (matches(LIGHT, ids)) return 'light';
  if ([...cats].some((c) => CONTENT_CATEGORIES.has(c))) return 'content';
  if ([...cats].some((c) => LIGHT_CATEGORIES.has(c))) return 'light';
  // Неизвестный мод без категорий — скорее контент, чем мелочь
  return 'content';
}

function versionTuple(v: string): [number, number] {
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (!m) return [99, 0];
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Новая нумерация (26.x и дальше) — заведомо новее 1.21
  return a > 1 ? [1, 100 + a] : [a, b];
}

/** Основа: сколько нужно игре этой версии с этим загрузчиком без модов. */
export function baseMemoryGb(gameVersion: string, loader: string): number {
  const [, minor] = versionTuple(gameVersion);
  let base = minor < 13 ? 1.5 : minor < 18 ? 2 : 2.5;
  const kind = loader.toLowerCase();
  if (kind === 'fabric' || kind === 'quilt') base += 0.5;
  else if (kind === 'forge' || kind === 'neoforge') base += 1;
  return base;
}
/**
 * Плавное «сжатие»: первые 4 ГБ прибавки — как есть, дальше растёт медленнее.
 * Так 200 модов — около 10 ГБ, а огромный модпак с шейдерами — 12–13, а не 20.
 */
export function compressExtra(raw: number): number {
  if (raw <= 4) return raw;
  return 4 + 2 * Math.log(1 + (raw - 4) / 2);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function recommendMemory(input: AdviceInput): MemoryAdvice {
  const [, minor] = versionTuple(input.gameVersion);
  const loaderName = input.loader === 'vanilla' || !input.loader ? '' : ' · ' + input.loader[0].toUpperCase() + input.loader.slice(1);
  const base = baseMemoryGb(input.gameVersion, input.loader);

  const counts: Record<ModWeightGroup, number> = { optimization: 0, library: 0, light: 0, content: 0, heavy: 0 };
  let distant = false;
  let shaderLoader = false;
  let savers = 0;
  for (const mod of input.mods) {
    const ids = idsOf(mod);
    if (ids.some((id) => id.startsWith('distanthorizons'))) {
      distant = true;
      continue;
    }
    if (matches(SHADER_LOADERS, ids)) shaderLoader = true;
    if (matches(MEMORY_SAVERS, ids)) savers++;
    counts[classifyMod(mod)]++;
  }

  // Прибавки «как есть», до сжатия
  const raw: AdvicePart[] = [];
  // Моды старых версий легче: меньше блоков, моделей и текстур
  const oldFactor = minor < 13 ? 0.75 : 1;
  let modsRaw = 0;
  for (const g of Object.keys(counts) as ModWeightGroup[]) {
    if (!counts[g]) continue;
    const gb = counts[g] * GROUP_WEIGHT[g] * oldFactor;
    modsRaw += gb;
    raw.push({ label: GROUP_LABEL[g], count: counts[g], gb });
  }
  if (distant) raw.push({ label: 'Distant Horizons (дальняя прорисовка)', gb: 1.5 });
  if ((input.shaderPacks ?? 0) > 0 && (shaderLoader || input.loader === 'vanilla')) raw.push({ label: 'шейдеры', gb: 1 });
  const packs = input.resourcePackSizesMb ?? [];
  if (packs.length) {
    let rp = 0;
    for (const mb of packs) rp += mb >= 100 ? 1 : mb >= 30 ? 0.5 : 0.05;
    rp = Math.min(2, rp);
    if (rp >= 0.1) raw.push({ label: packs.some((mb) => mb >= 30) ? 'ресурспаки высокого разрешения' : 'ресурспаки', gb: rp });
  }

  const rawTotal = raw.reduce((s, p) => s + p.gb, 0);
  let extra = compressExtra(rawTotal);
  const scale = rawTotal > 0 ? extra / rawTotal : 0;
  const parts: AdvicePart[] = [
    { label: 'Игра без модов', gb: base, detail: 'Minecraft ' + input.gameVersion + loaderName },
    ...raw.map((p) => ({ ...p, gb: round1(p.gb * scale) }))
  ];
  // FerriteCore и ModernFix заметно уменьшают расход памяти модами
  if (savers > 0 && modsRaw > 0.5) {
    const saved = modsRaw * scale * (savers >= 2 ? 0.2 : 0.12);
    extra -= saved;
    parts.push({ label: savers >= 2 ? 'FerriteCore и ModernFix экономят память' : 'мод экономии памяти', gb: -round1(saved) });
  }

  const ideal = Math.min(16, Math.max(2, Math.round(base + extra)));
  // Системе и другим программам оставляем хотя бы 2–3 ГБ
  const pcLimit = input.totalGb ? Math.max(1, Math.floor(input.totalGb - Math.max(2, input.totalGb * 0.25))) : Infinity;
  const gb = Math.max(1, Math.min(ideal, pcLimit));
  return { gb, parts, limitedByPc: gb < ideal, idealGb: ideal };
}
