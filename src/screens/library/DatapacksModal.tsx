import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, Library, PackageOpen, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Button, IconButton } from '../../ui/Button';
import { Toggle } from '../../ui/Controls';
import { EmptyState } from '../../ui/Common';
import { ConfirmDialog, Modal } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { fmtBytes } from '../../i18n';
import type { DatapackInfo, WorldInfo } from '../../../shared/types';

/** Датапаки одного мира: включить, выключить, удалить, добавить свои или из каталога. */
export function DatapacksModal({ world, onClose }: { world: WorldInfo | null; onClose: () => void }) {
  const [items, setItems] = useState<DatapackInfo[] | null>(null);
  const [toRemove, setToRemove] = useState<DatapackInfo | null>(null);
  const { toast } = useToast();

  const reload = useCallback(async () => {
    if (!world) return;
    try {
      setItems(await api.invoke<DatapackInfo[]>('datapacks:list', world.instanceId, world.folder));
    } catch (e) {
      setItems([]);
      toast('error', 'Не удалось прочитать датапаки', e instanceof Error ? e.message : String(e));
    }
  }, [world?.instanceId, world?.folder]);

  useEffect(() => {
    setItems(null);
    void reload();
  }, [reload]);

  if (!world) return null;

  const toggle = async (pack: DatapackInfo, enabled: boolean) => {
    setItems((list) => list?.map((d) => (d.fileName === pack.fileName ? { ...d, enabled } : d)) ?? null);
    try {
      await api.invoke('datapacks:setEnabled', world.instanceId, world.folder, pack.fileName, enabled);
    } catch (e) {
      toast('error', 'Не удалось переключить', e instanceof Error ? e.message : String(e));
      await reload();
    }
  };

  const remove = async (pack: DatapackInfo) => {
    setToRemove(null);
    try {
      await api.invoke('datapacks:remove', world.instanceId, world.folder, pack.fileName);
      await reload();
      toast('success', `${pack.name} удалён из мира`);
    } catch (e) {
      toast('error', 'Не удалось удалить', e instanceof Error ? e.message : String(e));
    }
  };

  const addFiles = async () => {
    const files = await api.invoke<string[]>('dialog:files', 'Добавить датапаки', [{ name: 'Датапак', extensions: ['zip'] }]);
    if (!files.length) return;
    const added = await api.invoke<number>('datapacks:addFiles', world.instanceId, world.folder, files);
    await reload();
    toast(added ? 'success' : 'warning', added ? `Добавлено датапаков: ${added}` : 'Подходящих файлов нет', added ? undefined : 'Нужны архивы .zip');
  };

  const openCatalog = () => {
    onClose();
    const params = new URLSearchParams({ instance: world.instanceId, type: 'datapack', world: world.folder });
    window.location.hash = `/mods?${params.toString()}`;
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Датапаки мира «${world.name}»`}
      actions={
        <>
          <Button variant="ghost" icon={<FolderOpen size={15} />} onClick={() => api.invoke('datapacks:open', world.instanceId, world.folder)}>
            Открыть папку
          </Button>
          <div className="grow" />
          <Button variant="secondary" icon={<FilePlus2 size={15} />} onClick={addFiles}>
            Добавить файлы
          </Button>
          <Button icon={<Library size={15} />} onClick={openCatalog}>
            Найти в каталоге
          </Button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Датапаки меняют рецепты, генерацию мира, добычу и механики без модов. Изменения применятся при следующем входе в мир.
        Выключенный датапак остаётся в папке и не загружается.
      </p>
      {!items ? (
        <div className="col" style={{ gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton" style={{ height: 56 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<PackageOpen size={24} />}
          title="В этом мире нет датапаков"
          hint="Найдите датапак в каталоге или добавьте свой архив .zip."
        />
      ) : (
        <div className="datapack-list">
          {items.map((pack) => (
            <div key={pack.fileName} className={`datapack-row ${pack.enabled ? '' : 'is-off'}`}>
              {pack.iconUrl ? (
                <img className="datapack-row__icon" src={pack.iconUrl} alt="" loading="lazy" />
              ) : (
                <span className="datapack-row__icon datapack-row__icon--empty">
                  <PackageOpen size={16} />
                </span>
              )}
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="datapack-row__name truncate" data-i18n-skip>
                  {pack.name}
                </span>
                <span className="tiny muted truncate">
                  {[
                    pack.source === 'modrinth' ? 'Modrinth' : pack.source === 'curseforge' ? 'CurseForge' : 'Свой файл',
                    pack.version,
                    pack.isFolder ? 'папка' : fmtBytes(pack.sizeBytes)
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {pack.description && (
                  <span className="tiny muted truncate" data-i18n-skip title={pack.description}>
                    {pack.description}
                  </span>
                )}
              </div>
              <Toggle checked={pack.enabled} onChange={(v) => toggle(pack, v)} label={pack.enabled ? 'Выключить' : 'Включить'} />
              <IconButton label="Удалить из мира" size="sm" ghost onClick={() => setToRemove(pack)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toRemove}
        title="Удалить датапак?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setToRemove(null)}
        onConfirm={() => toRemove && void remove(toRemove)}
      >
        {toRemove ? `«${toRemove.name}» будет удалён из папки мира. Если датапак менял генерацию, уже созданные области останутся как есть.` : ''}
      </ConfirmDialog>
    </Modal>
  );
}
