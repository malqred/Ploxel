import fs from 'node:fs';
import path from 'node:path';
import { p } from './paths';
import type { NewsItem, PatchNote, PatchNoteItem } from '../../shared/types';
import { htmlToMarkdown } from '../../shared/html-to-markdown';

/**
 * Новости Minecraft — официальный источник launchercontent.mojang.com
 * (тот же, что использует официальный лаунчер). Картинки Mojang не
 * копируются: для карточек генерируется градиент, текст новости — из
 * официального фида со ссылкой на первоисточник.
 */

const NEWS_URL = 'https://launchercontent.mojang.com/v2/news.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час
const GRADIENTS: [string, string][] = [
  ['#7E9C89', '#C9D3B4'],
  ['#9B86C4', '#E2C6D8'],
  ['#6E9DB5', '#BFD8D8'],
  ['#C4826A', '#E9C9A8'],
  ['#5C7F66', '#A9C4A2'],
  ['#D9A441', '#F0D8A8']
];

interface RawNews {
  entries?: {
    title?: string;
    category?: string;
    tag?: string;
    date?: string;
    text?: string;
    newsType?: string[];
    readMoreLink?: string;
    newsPageLink?: string;
    image?: { url?: string };
  }[];
}

let memoryCache: { at: number; items: NewsItem[] } | null = null;

function cacheFile(): string {
  return p('cache', 'news.json');
}

function normalize(raw: RawNews, limit = 12): NewsItem[] {
  const entries = (raw.entries ?? []).filter(
    (e) => e.newsType?.includes('Java') || e.category === 'Minecraft: Java Edition'
  );
  return entries.slice(0, limit).map((e, i) => ({
    id: String(i) + '-' + (e.title ?? ''),
    title: e.title ?? '',
    summary: e.text ?? '',
    category: e.category ?? e.tag ?? 'Minecraft',
    date: e.date ?? new Date().toISOString(),
    url: e.readMoreLink ?? e.newsPageLink ?? 'https://www.minecraft.net/en-us/news',
    gradient: GRADIENTS[i % GRADIENTS.length],
    image: e.image?.url
  }));
}

function readCache(): { at: number; items: NewsItem[] } | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(items: NewsItem[]) {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), items }), 'utf8');
  } catch {
    /* кэш не критичен */
  }
}

export async function getNews(force = false): Promise<{ items: NewsItem[]; stale: boolean }> {
  const now = Date.now();
  if (!force && memoryCache && now - memoryCache.at < CACHE_TTL_MS) {
    return { items: memoryCache.items, stale: false };
  }
  const disk = readCache();
  if (!force && disk && now - disk.at < CACHE_TTL_MS) {
    memoryCache = disk;
    return { items: disk.items, stale: false };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(NEWS_URL, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'PloxelLauncher/0.1 (+local)' }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RawNews;
    const items = normalize(data).filter((n) => n.title);
    if (!items.length) throw new Error('пустой ответ');
    memoryCache = { at: now, items };
    writeCache(items);
    return { items, stale: false };
  } catch {
    if (disk) return { items: disk.items, stale: true };
    return { items: [], stale: true };
  }
}
/* --------------------- Заметки к обновлениям Java --------------------- */

const PATCH_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
const PATCH_NOTE_BASE = 'https://launchercontent.mojang.com/v2/';

interface RawPatchNotes {
  entries?: { id?: string; title?: string; version?: string; type?: string; date?: string; shortText?: string; contentPath?: string }[];
}

let notesCache: { at: number; items: PatchNoteItem[]; paths: Map<string, string> } | null = null;
const noteBodies = new Map<string, PatchNote>();

async function fetchJsonTimeout<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'PloxelLauncher (+local)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Список заметок к обновлениям: релизы, снапшоты, пре-релизы — новые сверху. */
export async function getPatchNotes(force = false): Promise<PatchNoteItem[]> {
  if (!force && notesCache && Date.now() - notesCache.at < CACHE_TTL_MS) return notesCache.items;
  const raw = await fetchJsonTimeout<RawPatchNotes>(PATCH_NOTES_URL);
  const paths = new Map<string, string>();
  const items: PatchNoteItem[] = [];
  for (const e of raw.entries ?? []) {
    if (!e.id || !e.version || !e.contentPath) continue;
    paths.set(e.id, e.contentPath);
    items.push({
      id: e.id,
      title: e.title ?? e.version,
      version: e.version,
      type: e.type === 'release' ? 'release' : 'snapshot',
      date: e.date ?? '',
      summary: e.shortText ?? ''
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  notesCache = { at: Date.now(), items: items.slice(0, 80), paths };
  return notesCache.items;
}

/** Полный текст заметок в markdown. */
export async function getPatchNote(id: string): Promise<PatchNote> {
  const hit = noteBodies.get(id);
  if (hit) return hit;
  if (!notesCache?.paths.has(id)) await getPatchNotes(true);
  const contentPath = notesCache?.paths.get(id);
  if (!contentPath || !/^[\w\-/.]+\.json$/.test(contentPath)) throw new Error('Заметки к обновлению не найдены');
  const raw = await fetchJsonTimeout<{ title?: string; version?: string; body?: string }>(PATCH_NOTE_BASE + contentPath);
  const note: PatchNote = { id, title: raw.title ?? id, version: raw.version ?? id, body: htmlToMarkdown(raw.body ?? '') };
  noteBodies.set(id, note);
  return note;
}

/** Новости Java Edition для окна «Новости Minecraft» — больше, чем на главной. */
export async function getJavaNews(): Promise<NewsItem[]> {
  const raw = await fetchJsonTimeout<RawNews>(NEWS_URL);
  return normalize(raw, 40).filter((n) => n.title);
}
