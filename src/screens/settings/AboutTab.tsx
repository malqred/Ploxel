import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Checkbox, ProgressBar } from '../../ui/Controls';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { Section } from './parts';
import { Markdown } from '../../ui/Markdown';
import { fmtBytes, fmtSpeed } from '../../i18n';
import type { DownloadTask } from '../../../shared/types';

const GITHUB_URL = 'https://github.com/malqred/Ploxel';

/** Знак GitHub (в lucide больше нет логотипов брендов). */
function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

interface UpdateInfo {
  available: boolean;
  version: string;
  error?: string;
  notes?: string;
  page?: string;
  size?: number;
}

export function AboutTab() {
  const { info } = useSettings();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [deleteInstances, setDeleteInstances] = useState(false);
  const [deleteAll, setDeleteAll] = useState(false);
  const { toast } = useToast();
  const [progress, setProgress] = useState<DownloadTask | null>(null);

  // Прогресс скачивания установщика — прямо под кнопкой
  useEffect(() => {
    if (!installing) return;
    return api.on('downloads:changed', (list) => {
      const task = (list as DownloadTask[]).find((t) => t.title.startsWith('Обновление Ploxel'));
      if (task) setProgress(task);
    });
  }, [installing]);

  useEffect(() => {
    if (!info) return;
  }, [info]);

  if (!info) return null;

  const check = async () => {
    setChecking(true);
    try {
      const res = await api.invoke<UpdateInfo>('update:check');
      setUpdate(res);
      if (res.available) toast('info', `Доступна версия ${res.version}`);
      else if (res.error) toast('warning', 'Проверка обновлений', res.error);
      else toast('success', 'Обновлений нет', `У вас последняя версия — ${info.version}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Section title="Ploxel launcher" hint="Неофициальный лаунчер для Minecraft: Java Edition. Не связан с Mojang или Microsoft.">
        <div className="about-grid">
          <div className="about-card">
            <div className="about-card__label">Версия</div>
            <div className="about-card__value">{info.version}</div>
          </div>
          <div className="about-card">
            <div className="about-card__label">Платформа</div>
            <div className="about-card__value">{info.platform === 'win32' ? 'Windows' : info.platform}</div>
          </div>
          <div className="about-card">
            <div className="about-card__label">Папка данных</div>
            <div className="about-card__value" style={{ fontSize: 11, wordBreak: 'break-all' }}>{info.dataRoot}</div>
          </div>
        </div>

      </Section>

      <Section
        title="Обновления"
        hint="Новые версии выходят на GitHub. Лаунчер проверяет их при запуске (это можно выключить в «Общих»), а установка идёт поверх — сборки и настройки сохраняются."
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={check} loading={checking}>
            Проверить
          </Button>
        }
      >
        {update?.available ? (
          <>
            <p>{`Доступна версия ${update.version} (у вас ${info.version}). Установщик скачается, лаунчер закроется, обновится и откроется снова.`}</p>
            {update.notes && (
              <div className="update-notes">
                <Markdown text={update.notes} />
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <Button
                icon={<Download size={15} />}
                loading={installing}
                onClick={() => {
                  setInstalling(true);
                  toast('info', 'Скачиваем обновление', 'Прогресс — в меню слева.');
                  api
                    .invoke('update:install')
                    .catch((e) => {
                      setInstalling(false);
                      toast('error', 'Обновление не удалось', e instanceof Error ? e.message : String(e));
                    });
                }}
              >
                {update.size ? `Скачать и установить (${fmtBytes(update.size)})` : 'Скачать и установить'}
              </Button>
              {update.page && (
                <Button variant="secondary" icon={<ExternalLink size={15} />} onClick={() => api.shell.openExternal(update.page!)}>
                  Что нового
                </Button>
              )}
            </div>
            {installing && progress && (progress.bytesTotal ?? 0) > 0 && (
              <div className="col" style={{ gap: 6, marginTop: 10 }}>
                <ProgressBar value={progress.bytesDone ?? 0} max={progress.bytesTotal ?? 0} />
                <span className="tiny muted">
                  {`Скачано ${fmtBytes(progress.bytesDone ?? 0)} из ${fmtBytes(progress.bytesTotal ?? 0)} · ${fmtSpeed(progress.speedBps ?? 0)}`}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="small muted">
            {update?.error ?? (update ? `У вас последняя версия — ${info.version}.` : 'Нажмите «Проверить», чтобы узнать, есть ли новая версия.')}
          </p>
        )}
      </Section>

      <Section title="Благодарности и лицензии" hint="Лаунчер построен на открытых компонентах и официальных сервисах.">
        <div className="col" style={{ gap: 8 }}>
          <RowLink label="Modrinth API" url="https://modrinth.com" note="каталог модов, API v2" />
          <RowLink label="CurseForge API" url="https://www.curseforge.com" note="каталог модов, API v1" />
          <RowLink label="Mojang / Minecraft" url="https://www.minecraft.net" note="манифесты версий и ассеты — только официальные адреса" />
          <RowLink label="Lucide Icons" url="https://lucide.dev" note="иконки, лицензия ISC" />
          <RowLink label="Electron, React, Vite" url="https://www.electronjs.org" note="MIT / Apache-2.0" />
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Minecraft — торговая марка Mojang AB. Ploxel не использует официальные логотипы и арты, не обходит
          лицензирование игры и не продаёт доступ.
        </p>
      </Section>

      <Section
        title="Удаление"
        hint="Удаляет только этот Ploxel. Другие версии лаунчера и посторонние файлы остаются на месте."
      >
        <p className="small">
          Программа закроется и удалит свою папку установки. Сборки и все данные (аккаунты, настройки, скачанные
          версии игры) можно удалить галочками в окне удаления — иначе они останутся для переустановки.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            disabled={!info.packaged}
            onClick={() => {
              setDeleteInstances(false);
              setDeleteAll(false);
              setUninstallOpen(true);
            }}
          >
            Удалить Ploxel
          </Button>
          {!info.packaged && (
            <span className="tiny muted">Доступно только для установленной версии.</span>
          )}
        </div>
      </Section>

      <div className="about-github">
        <Button variant="secondary" icon={<GitHubMark />} onClick={() => api.shell.openExternal(GITHUB_URL)}>
          Ploxel на GitHub
        </Button>
      </div>

      <ConfirmDialog
        open={uninstallOpen}
        title="Удалить Ploxel?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setUninstallOpen(false)}
        onConfirm={() => {
          setUninstallOpen(false);
          void api
            .invoke<{ scheduled: boolean; removedInstances: boolean; warning?: string }>('app:uninstall', {
              deleteInstances,
              deleteAllData: deleteAll
            })
            .then((res) => {
              if (res.warning) toast('warning', 'Удаление', res.warning);
              else toast('info', 'Ploxel удаляется', 'Лаунчер закроется через пару секунд.');
            })
            .catch((e) =>
              toast('error', 'Удаление отменено', e instanceof Error ? e.message : String(e))
            );
        }}
      >
        <p>
          Будет удалена папка этой версии Ploxel и её ярлыки. Другие установленные версии лаунчера и файлы,
          которые к нему не относятся, не затрагиваются.
        </p>
        <label className="row" style={{ gap: 10, marginTop: 12, cursor: 'pointer' }}>
          <Checkbox checked={deleteInstances} onChange={setDeleteInstances} label="Также удалить мои сборки" />
          <span className="col" style={{ gap: 2 }}>
            <span>Также удалить мои сборки</span>
            <span className="tiny muted">
              Папка сборок целиком: моды, миры и конфиги. Отменить это будет нельзя.
            </span>
          </span>
        </label>
        <label className="row" style={{ gap: 10, marginTop: 12, cursor: 'pointer' }}>
          <Checkbox checked={deleteAll} onChange={setDeleteAll} label="Также удалить мои данные" />
          <span className="col" style={{ gap: 2 }}>
            <span>Также удалить мои данные</span>
            <span className="tiny muted">
              Аккаунты и вход через Microsoft и Ely.by, настройки, ключ ИИ, переписка с помощником, скины, кэш,
              скачанные версии игры и Java, логи и ярлыки сборок. Сборки и резервные копии миров останутся, если не
              отмечена первая галочка. Данные общие для всех версий Ploxel на этом компьютере. Отменить это будет
              нельзя.
            </span>
          </span>
        </label>
      </ConfirmDialog>
    </>
  );
}


function RowLink({ label, url, note }: { label: string; url: string; note: string }) {
  return (
    <button className="action-row" onClick={() => api.shell.openExternal(url)}>
      <ExternalLink size={15} />
      <span className="grow">{label}</span>
      <span className="tiny muted">{note}</span>
    </button>
  );
}