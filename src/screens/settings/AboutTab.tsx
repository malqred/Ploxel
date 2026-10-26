import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Controls';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { Section } from './parts';
import { Markdown } from '../../ui/Markdown';
import { fmtBytes } from '../../i18n';

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
              deleteInstances: deleteInstances || deleteAll,
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
        <label className="row" style={{ gap: 10, marginTop: 12, cursor: deleteAll ? 'default' : 'pointer' }}>
          <Checkbox
            checked={deleteInstances || deleteAll}
            onChange={setDeleteInstances}
            disabled={deleteAll}
            label="Также удалить мои сборки"
          />
          <span className="col" style={{ gap: 2 }}>
            <span>Также удалить мои сборки</span>
            <span className="tiny muted">
              Папка сборок целиком: моды, миры и конфиги. Отменить это будет нельзя.
            </span>
          </span>
        </label>
        <label className="row" style={{ gap: 10, marginTop: 12, cursor: 'pointer' }}>
          <Checkbox checked={deleteAll} onChange={setDeleteAll} label="Удалить все данные Ploxel" />
          <span className="col" style={{ gap: 2 }}>
            <span>Удалить все данные Ploxel</span>
            <span className="tiny muted">
              Не останется ничего: сборки и миры, аккаунты, настройки, ключ ИИ, скины, переписка с помощником,
              скачанные версии игры, Java, кэш и ярлыки сборок. Данные общие для всех версий Ploxel на этом
              компьютере. Отменить это будет нельзя.
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