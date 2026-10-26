import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog, Modal } from '../ui/Overlay';
import { Toggle } from '../ui/Controls';
import { SearchField } from '../ui/TextField';
import { ScreenHeader } from '../ui/Common';
import { useSettings } from '../state/settings';
import { useToast } from '../state/toast';
import {
  KEYBINDS,
  KEYBIND_CATEGORIES,
  describeKey,
  keySpecFromCode,
  keySpecFromMouse,
  type KeybindDef
} from '../../shared/keybinds';

/**
 * Общее управление: набор клавиш для Minecraft 26.4. Изменённые привязки
 * подставляются в options.txt каждой новой сборки — и только при создании.
 */
export function ControlsScreen() {
  const { settings, update } = useSettings();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<KeybindDef | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  const overrides = settings?.controls.keybinds ?? {};
  const applyToNew = settings?.controls.applyToNewInstances ?? true;

  const save = (keybinds: Record<string, string>) => {
    // Именно замена набора: пустой объект или объект без одной клавиши должен
    // сбросить значения, а не слиться со старыми (см. settings:setKeybinds).
    void api.invoke<unknown>('settings:setKeybinds', keybinds).catch((e) => {
      toast('error', 'Не удалось сохранить клавиши', e instanceof Error ? e.message : String(e));
    });
  };

  const commit = (spec: string) => {
    if (!capture) return;
    save({ ...overrides, [capture.id]: spec });
    toast('success', 'Клавиша назначена', `${capture.label}: ${describeKey(spec)}`);
    setCapture(null);
  };

  const valueOf = (def: KeybindDef) => overrides[def.id] ?? def.default ?? 'key.keyboard.unknown';

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      const spec = keySpecFromCode(e.code);
      if (!spec) return;
      e.preventDefault();
      e.stopPropagation();
      commit(spec);
    };
    const onMouse = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) return;
      const spec = keySpecFromMouse(e.button);
      if (!spec) return;
      e.preventDefault();
      e.stopPropagation();
      commit(spec);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  });

  const effective = useMemo(
    () => KEYBINDS.map((def) => ({ def, value: overrides[def.id] ?? def.default ?? 'key.keyboard.unknown' })),
    [overrides]
  );

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { def, value } of effective) {
      // Отладочные клавиши работают вместе с F3 — совпадения с ними не считаем.
      if (def.category === 'debug') continue;
      if (value === 'key.keyboard.unknown') continue;
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([value]) => value));
  }, [effective]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return KEYBIND_CATEGORIES.map((category) => ({
      category,
      items: effective.filter(
        ({ def }) =>
          def.category === category.id &&
          (!q || def.label.toLowerCase().includes(q) || describeKey(valueOf(def)).toLowerCase().includes(q))
      )
    })).filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, query]);

  if (!settings) return null;

  return (
    <div className="screen">
      <ScreenHeader
        title="Настройки управления"
        sub="Общие клавиши для всех новых сборок. Набор — по последней версии Minecraft 26.4."
        actions={
          <Button
            variant="secondary"
            icon={<RotateCcw size={15} />}
            disabled={!Object.keys(overrides).length}
            onClick={() => setConfirmReset(true)}
          >
            Сбросить всё
          </Button>
        }
      />

      <section className="panel keybind-intro">
        <div className="row" style={{ gap: 12 }}>
          <span className="keybind-intro__icon">
            <Keyboard size={20} />
          </span>
          <p className="small" style={{ margin: 0 }}>
            Клавиши применяются к сборке один раз — когда вы её создаёте. Дальше управление принадлежит игре:
            если вы поменяли что-то в самой сборке, лаунчер это не перезапишет.
          </p>
        </div>
        <div className="keybind-intro__row">
          <div className="col grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: 550 }}>Применять к новым сборкам</span>
            <span className="tiny muted">
              Уже созданные сборки не меняются. Клавиши, которых нет в старой версии игры, при создании пропускаются.
            </span>
          </div>
          <Toggle
            checked={applyToNew}
            label="Применять к новым сборкам"
            onChange={(v) =>
              void update({ controls: { ...settings.controls, applyToNewInstances: v } })
            }
          />
        </div>
        <div className="keybind-intro__row">
          <span className="tiny muted">
            Например, «Друзья» появились в 26.2, а «Другие игроки» — только в 26.4. В сборке на 1.21.4 такие
            привязки не запишутся, и игра запустится со своими настройками по умолчанию.
          </span>
        </div>
      </section>

      <div className="keybind-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Найти клавишу: прыжок, инвентарь, чат…" />
        <span className="chip">{`Изменено: ${Object.keys(overrides).length}`}</span>
      </div>

      {groups.length === 0 ? (
        <div className="panel">
          <p className="small muted" style={{ margin: 0 }}>Ничего не нашлось — попробуйте другое слово.</p>
        </div>
      ) : (
        groups.map(({ category, items }) => (
          <section className="panel keybind-group" key={category.id}>
            <h2 className="keybind-group__title">{category.label}</h2>
            {items.map(({ def }) => {
              const value = valueOf(def);
              const changed = def.id in overrides;
              return (
                <div className="keybind-row" key={def.id}>
                  <div className="keybind-row__text">
                    <span className="keybind-row__label">{def.label}</span>
                    {def.defaultHint && <span className="keybind-row__hint">{`По умолчанию: ${def.defaultHint}`}</span>}
                  </div>
                  {duplicates.has(value) && <span className="chip chip--warn">дубликат</span>}
                  <button
                    className="keybind-key"
                    data-active={changed ? 'true' : undefined}
                    onClick={() => setCapture(def)}
                    title="Нажмите, чтобы назначить клавишу"
                  >
                    {describeKey(value)}
                  </button>
                  {changed && (
                    <IconButton
                      label="Сбросить клавишу"
                      size="sm"
                      ghost
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[def.id];
                        save(next);
                      }}
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}

      <Modal
        open={!!capture}
        onClose={() => setCapture(null)}
        title={capture ? `Клавиша для «${capture.label}»` : 'Клавиша'}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCapture(null)}>Отмена</Button>
            <Button
              variant="neutral"
              onClick={() => {
                if (!capture) return;
                save({ ...overrides, [capture.id]: 'key.keyboard.unknown' });
                setCapture(null);
              }}
            >
              Очистить
            </Button>
          </>
        }
      >
        <div className="keybind-capture" ref={zone}>
          <span className="keybind-capture__key">?</span>
          <span className="keybind-capture__title">Нажмите клавишу или кнопку мыши</span>
          <span className="tiny muted">Esc — отмена. Текущая: {capture ? describeKey(valueOf(capture)) : ''}</span>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmReset}
        title="Сбросить все клавиши?"
        confirmLabel="Сбросить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          save({});
          setConfirmReset(false);
          toast('success', 'Клавиши сброшены', 'Новые сборки получат управление Minecraft по умолчанию.');
        }}
      >
        <p>Все общие привязки вернутся к значениям Minecraft. Уже созданные сборки и их настройки не изменятся.</p>
      </ConfirmDialog>
    </div>
  );
}