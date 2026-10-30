import { useEffect, useRef, type ReactNode } from 'react';
import { useSettings } from '../state/settings';
import { createTranslator } from '../i18n/translator';
// Словари грузятся по требованию — отдельным файлом только выбранного языка:
// все 12 сразу (4 МБ) замедляли запуск, а русскому интерфейсу не нужен ни один
const LOADERS = import.meta.glob<{ default: Record<string, string> }>('../i18n/locales/*.json');
const cache = new Map<string, Record<string, string>>();

async function loadDict(lang: string): Promise<Record<string, string> | null> {
  const hit = cache.get(lang);
  if (hit) return hit;
  const load = LOADERS[`../i18n/locales/${lang}.json`];
  if (!load) return null;
  const dict = (await load()).default;
  cache.set(lang, dict);
  return dict;
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const SKIP = '.md, .console__log, .ai-answer, .ai-preview, .msg__bubble, code, pre, .md-inline, [data-i18n-skip]';

interface Saved {
  text?: string;
  attrs?: Map<string, string>;
}

/**
 * Переводит тексты интерфейса на выбранный язык по заранее собранным словарям.
 * Работает поверх готовой разметки: React-компоненты не нужно переписывать,
 * а динамически добавленные узлы (модальные окна, тосты) переводятся наблюдателем.
 */
export function LocalizationLayer({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const lang = settings?.general.language ?? 'ru';
  const saved = useRef(new Map<Node, Saved>());
  const observer = useRef<MutationObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    restore();
    if (lang === 'ru') {
      document.documentElement.lang = 'ru';
      return restore;
    }
    void loadDict(lang).then((dict) => {
      if (!cancelled && dict) apply(dict);
    });
    return () => {
      cancelled = true;
      restore();
    };

    function apply(dict: Record<string, string>) {
    document.documentElement.lang = lang;

    const lookup = createTranslator(dict);

    const skipped = (el: Element | null) => !!el?.closest(SKIP);

    const translateText = (node: Node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const raw = node.nodeValue;
      if (!raw) return;
      if (skipped((node.parentElement as Element) ?? null)) return;
      const match = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!match) return;
      const core = match[2];
      const tr = lookup(core);
      if (!tr || tr === core) return;
      const prev = saved.current.get(node);
      saved.current.set(node, { ...(prev ?? {}), text: prev?.text ?? raw });
      node.nodeValue = match[1] + tr + match[3];
    };

    const translateAttrs = (el: Element) => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      for (const attr of ATTRS) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const tr = lookup(value.trim());
        if (!tr || tr === value) continue;
        const prev = saved.current.get(el) ?? {};
        const attrs = prev.attrs ?? new Map<string, string>();
        if (!attrs.has(attr)) attrs.set(attr, value);
        saved.current.set(el, { ...prev, attrs });
        el.setAttribute(attr, tr);
      }
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        translateText(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (skipped(el)) return;
      translateAttrs(el);
      for (const child of Array.from(el.childNodes)) walk(child);
    };

    walk(document.body);
    observer.current = new MutationObserver((mutations) => {
      // Удалённые со страницы узлы не держим: иначе за долгую сессию память растёт без предела
      if (saved.current.size > 3000) {
        for (const node of saved.current.keys()) if (!node.isConnected) saved.current.delete(node);
      }
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of Array.from(m.addedNodes)) walk(node);
        } else if (m.type === 'characterData') {
          if (m.target.parentElement && skipped(m.target.parentElement)) continue;
          const raw = m.target.nodeValue;
          if (!raw) continue;
          const core = raw.trim();
          const tr = lookup(core);
          if (tr && tr !== core) {
            const prev = saved.current.get(m.target);
            saved.current.set(m.target, { ...(prev ?? {}), text: prev?.text ?? raw });
            const lead = raw.match(/^\s*/)?.[0] ?? '';
            const trail = raw.match(/\s*$/)?.[0] ?? '';
            m.target.nodeValue = lead + tr + trail;
          }
        } else if (m.type === 'attributes' && m.attributeName && ATTRS.includes(m.attributeName)) {
          translateAttrs(m.target as Element);
        }
      }
    });
    observer.current.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
    }

    function restore() {
      observer.current?.disconnect();
      observer.current = null;
      for (const [node, rec] of saved.current) {
        if (node.nodeType === Node.TEXT_NODE && rec.text !== undefined) {
          node.nodeValue = rec.text;
        } else if (node.nodeType === Node.ELEMENT_NODE && rec.attrs) {
          for (const [attr, value] of rec.attrs) (node as Element).setAttribute(attr, value);
        }
      }
      saved.current.clear();
    }
  }, [lang]);

  return <>{children}</>;
}