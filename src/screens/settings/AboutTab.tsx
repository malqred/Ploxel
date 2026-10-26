import { useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Controls';
import { ConfirmDialog } from '../../ui/Overlay';
import { useToast } from '../../state/toast';
import { Section } from './parts';

export function AboutTab() {
  const { info } = useSettings();
  const [update, setUpdate] = useState<{ available: boolean; version: string; error?: string; notes?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [deleteInstances, setDeleteInstances] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!info) return;
  }, [info]);

  if (!info) return null;

  const check = async () => {
    setChecking(true);
    try {
      const res = await api.invoke<{ available: boolean; version: string; error?: string; notes?: string }>('update:check');
      setUpdate(res);
      if (res.available) toast('info', `Доступна версия ${res.version}`);
      else if (res.error) toast('warning', 'Проверка обновлений', res.error);
      else toast('success', 'Обновлений нет', `Версия ${res.version}`);
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
        hint="Лаунчер может сам проверить, вышла ли новая версия."
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={check} loading={checking}>
            Проверить
          </Button>
        }
      >
        {update?.available ? (
          <>
            <p>
              Доступна версия <strong>{update.version}</strong>. Установщик скачается и запустится — лаунчер
              закроется.
            </p>
            {update.notes && <p className="small muted">{update.notes}</p>}
            <Button
              icon={<Download size={15} />}
              onClick={() => api.invoke('update:install', update).catch((e) => toast('error', 'Обновление не удалось', String(e)))}
            >
              Скачать и установить
            </Button>
          </>
        ) : (
          <p className="small muted">
            {update?.error ?? 'Нажмите «Проверить», чтобы узнать, есть ли новая версия.'}
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
          Программа закроется и удалит свою папку установки. Настройки и скачанные версии игры останутся в папке
          данных — их можно стереть вручную, если они больше не нужны.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <Button
            variant="danger"
            icon={<Trash2 size={16} />}
            disabled={!info.packaged}
            onClick={() => {
              setDeleteInstances(false);
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
              deleteInstances
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
          <Checkbox
            checked={deleteInstances}
            onChange={setDeleteInstances}
            label="Также удалить мои сборки"
          />
          <span className="col" style={{ gap: 2 }}>
            <span>Также удалить мои сборки</span>
            <span className="tiny muted">
              Папка сборок целиком: моды, миры и конфиги. Отменить это будет нельзя.
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