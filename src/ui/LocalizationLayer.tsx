import { useEffect, useRef, type ReactNode } from 'react';
import { useSettings } from '../state/settings';
import { createTranslator } from '../i18n/translator';
import en from '../i18n/locales/en.json';
import fr from '../i18n/locales/fr.json';
import es from '../i18n/locales/es.json';
import de from '../i18n/locales/de.json';
import it from '../i18n/locales/it.json';
import pl from '../i18n/locales/pl.json';
import sv from '../i18n/locales/sv.json';
import fi from '../i18n/locales/fi.json';
import uk from '../i18n/locales/uk.json';
import ko from '../i18n/locales/ko.json';
import ja from '../i18n/locales/ja.json';
import zh from '../i18n/locales/zh.json';

const DICTS: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  fr: fr as Record<string, string>,
  es: es as Record<string, string>,
  de: de as Record<string, string>,
  it: it as Record<string, string>,
  pl: pl as Record<string, string>,
  sv: sv as Record<string, string>,
  fi: fi as Record<string, string>,
  uk: uk as Record<string, string>,
  ko: ko as Record<string, string>,
  ja: ja as Record<string, string>,
  zh: zh as Record<string, string>
};

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
    const dict = DICTS[lang];
    restore();

    if (lang === 'ru' || !dict) {
      if (lang === 'ru') document.documentElement.lang = 'ru';
      return;
    }
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

    return restore;
  }, [lang]);

  return <>{children}</>;
}