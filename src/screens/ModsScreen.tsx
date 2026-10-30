import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Select } from '../ui/TextField';
import { ScreenHeader } from '../ui/Common';
import { useSettings } from '../state/settings';
import { CatalogBrowser, type ContentType } from './mods/CatalogBrowser';
import { ProjectPage } from './mods/ProjectPage';
import { AiSuggestModal } from './mods/AiSuggestModal';
import type { CatalogProject, Instance } from '../../shared/types';

const BROWSE = '__browse__';

export function ModsScreen() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [targetId, setTargetId] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const cfOn = !!useSettings().info?.config.curseforgeKey;
  const [openProject, setOpenProject] = useState<{ project: CatalogProject; kind: ContentType} | null>(null);

  const initialQuery = useMemo(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    return params.get('q') ?? '';
  }, []);

  useEffect(() => {
    void api.invoke<Instance[]>('instances:list').then((list) => {
      setInstances(list);
      const hash = window.location.hash.match(/instance=([^&]+)/);
      const fromHash = hash ? decodeURIComponent(hash[1]) : null;
      const chosen = list.find((i) => i.id === fromHash) ?? list[0];
      setTargetId(chosen?.id ?? BROWSE);
    });
    void api.invoke<boolean>('ai:available').then(setAiOn);
  }, []);

  const closeAi = useCallback(() => setAiOpen(false), []);
  const addInstance = useCallback(
    (created: Instance) => setInstances((cur) => (cur.some((i) => i.id === created.id) ? cur : [...cur, created])),
    []
  );

  const isBrowse = targetId === BROWSE;
  const instance = instances.find((i) => i.id === targetId) ?? null;

  return (
    <div className="screen">
      <div className={openProject ? 'hidden' : 'col'} style={{ gap: 16 }}>
        <ScreenHeader
          title="Библиотека"
          sub={cfOn ? 'Modrinth и CurseForge: моды, сборки, ресурспаки и шейдеры.' : 'Modrinth: моды, сборки, ресурспаки и шейдеры.'}
          actions={
            <>
              {aiOn && (
                <Button variant="secondary" icon={<Sparkles size={15} />} onClick={() => setAiOpen(true)}>
                  Подобрать с ИИ
                </Button>
              )}
              <Select
                value={targetId}
                options={[
                  ...instances.map((i) => ({ value: i.id, label: i.name, hint: i.gameVersion })),
                  { value: BROWSE, label: 'Просмотр', hint: 'без привязки к сборке' }
                ]}
                onChange={setTargetId}
                placeholder="Выберите сборку"
                width={250}
                skipLabels
              />
            </>
          }
        />

        <CatalogBrowser
          instances={instances}
          mode={isBrowse ? 'browse' : 'instance'}
          instance={isBrowse ? null : instance}
          initialQuery={initialQuery}
          onOpenProject={(project, kind) => setOpenProject({ project, kind })}
        />
      </div>

      {openProject && (
        <ProjectPage
          project={openProject.project}
          kind={openProject.kind}
          instance={isBrowse ? null : instance}
          instances={instances}
          onBack={() => setOpenProject(null)}
          onInstalled={() => undefined}
          onInstanceCreated={addInstance}
        />
      )}

      <AiSuggestModal open={aiOpen} onClose={closeAi} onCreated={addInstance} />
    </div>
  );
}