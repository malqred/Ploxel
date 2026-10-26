import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FolderOpen, Globe2, Play, Upload } from 'lucide-react';
import { api } from '../api';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/TextField';
import { ScreenHeader, EmptyState } from '../ui/Common';
import { useToast } from '../state/toast';
import { fmtBytes, fmtRelative } from '../i18n';
import type { Instance, WorldInfo } from '../../shared/types';

/** Миры: отдельным экраном или вкладкой на странице сборки (instanceId + embedded). */
export function WorldsScreen({ instanceId, embedded }: { instanceId?: string; embedded?: boolean } = {}) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [filter, setFilter] = useState(instanceId ?? 'all');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    const [w, i] = await Promise.all([
      api.invoke<WorldInfo[]>('worlds:list', instanceId),
      api.invoke<Instance[]>('instances:list')
    ]);
    setWorlds(w);
    setInstances(i);
    setLoading(false);
  }, [instanceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(
    () => (filter === 'all' ? worlds : worlds.filter((w) => w.instanceId === filter)),
    [worlds, filter]
  );

  const instanceOf = (id: string) => instances.find((i) => i.id === id);

  const importTo = async (instanceId: string) => {
    try {
      const world = await api.invoke<WorldInfo | null>('worlds:import', instanceId);
      if (world) {
        toast('success', 'Мир импортирован', world.name);
        await reload();
      }
    } catch (e) {
      toast('error', 'Импорт не удался', e instanceof Error ? e.message : String(e));
    }
  };

  const exportWorld = async (world: WorldInfo) => {
    try {
      const file = await api.invoke<string | null>('worlds:export', world.instanceId, world.folder);
      if (file) toast('success', 'Мир сохранён', file);
    } catch (e) {
      toast('error', 'Экспорт не удался', e instanceof Error ? e.message : String(e));
    }
  };

  const play = async (world: WorldInfo) => {
    try {
      await api.invoke('launch:start', world.instanceId, { quickPlayWorld: world.folder });
    } catch (e) {
      toast('error', 'Не удалось запустить', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={embedded ? 'col' : 'screen'} style={embedded ? { gap: 'var(--space-3)' } : undefined}>
      {embedded ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted grow">Сохранения этой сборки. Импорт и экспорт — обычные zip-архивы.</span>
          <Button variant="secondary" size="sm" icon={<Upload size={15} />} onClick={() => instanceId && importTo(instanceId)}>
            Импорт мира
          </Button>
        </div>
      ) : (
      <ScreenHeader
        title="Миры"
        sub="Сохранения лежат внутри своих сборок. Импорт и экспорт — обычные zip-архивы."
        actions={
          <>
            <Select
              value={filter}
              options={[{ value: 'all', label: 'Все сборки' }, ...instances.map((i) => ({ value: i.id, label: i.name }))]}
              onChange={setFilter}
              width={220}
            />
            <Button
              variant="secondary"
              icon={<Upload size={15} />}
              onClick={() => {
                if (!instances.length) {
                  toast('warning', 'Сначала создайте сборку');
                  return;
                }
                void importTo(instances.find((i) => i.id === filter)?.id ?? instances[0].id);
              }}
            >
              Импорт мира
            </Button>
          </>
        }
      />
      )}

      {loading ? (
        <div className="worlds-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 230 }} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Globe2 size={26} />}
            title="Миров пока нет"
            hint="Создайте мир в игре или импортируйте архив с сохранением. Мир автоматически попадёт в выбранную сборку."
          />
        </div>
      ) : (
        <div className="worlds-grid">
          {shown.map((world, idx) => {
            const inst = instanceOf(world.instanceId);
            const mismatch = !!(world.gameVersion && inst && world.gameVersion !== inst.gameVersion);
            return (
              <article key={`${world.instanceId}/${world.folder}`} className="card world-card rise-in" style={{ ['--i' as string]: idx }}>
                <div className="world-card__preview">
                  {world.icon ? <img src={world.icon} alt="" /> : null}
                  <div className="world-card__top">
                    {!embedded && <span className="world-pill">{inst?.name ?? world.instanceId}</span>}
                    {mismatch && <span className="world-pill world-pill--warn">{`версия ${world.gameVersion}`}</span>}
                  </div>
                </div>
                <div className="world-card__name truncate">{world.name}</div>
                <div className="world-card__meta">
                  <span>{`Версия: ${world.gameVersion || 'неизвестна'}`}</span>
                  <span>{fmtBytes(world.sizeBytes)}</span>
                  {world.lastPlayed && <span>{fmtRelative(world.lastPlayed)}</span>}
                  {world.isHardcore && <span className="chip chip--danger" style={{ height: 18 }}>Хардкор</span>}
                </div>
                {mismatch && (
                  <div className="world-compat">
                    <AlertTriangle size={13} style={{ marginTop: 1 }} />
                    <span>{`Мир создан в ${world.gameVersion}, сборка — ${inst?.gameVersion}. Игра может не открыть мир или обновить его без возможности вернуться.`}</span>
                  </div>
                )}
                <div className="world-card__actions">
                  <Button size="sm" icon={<Play size={13} fill="currentColor" />} onClick={() => play(world)}>
                    Играть
                  </Button>
                  <span className="grow" />
                  <IconButton label="Открыть папку мира" size="sm" ghost onClick={() => api.invoke('worlds:open', world.instanceId, world.folder)}>
                    <FolderOpen size={15} />
                  </IconButton>
                  <Button size="sm" variant="secondary" onClick={() => exportWorld(world)}>
                    Экспорт
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}