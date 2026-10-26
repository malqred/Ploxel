import { useEffect, useState } from 'react';
import { ChevronRight, FlaskConical, Newspaper, Plus, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../ui/Button';
import { fmtDate, fmtRelative } from '../../i18n';
import type { Instance } from '../../../shared/types';
import { compareGameVersions } from '../../../shared/game-versions';
import { MinecraftNewsModal } from './MinecraftNewsModal';

interface VersionEntry {
  id: string;
  type: string;
  releaseTime: string;
}

/** Открыть окно создания сборки с выбранной версией игры. */
export function createInstanceFor(version: string) {
  window.location.hash = `/library?create=1&version=${encodeURIComponent(version)}`;
}

/**
 * «Minecraft сейчас»: последний релиз и снапшот из официального манифеста
 * Mojang, сколько сборок отстают от релиза. По клику — окно с заметками к
 * обновлениям и новостями Java Edition.
 */
export function MinecraftNews({ instances }: { instances: Instance[] }) {
  const [release, setRelease] = useState<VersionEntry | null>(null);
  const [snapshot, setSnapshot] = useState<VersionEntry | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<{ version?: string } | null>(null);

  useEffect(() => {
    void api
      .invoke<{ latest: { release: string; snapshot: string }; versions: VersionEntry[] }>('versions:list', true)
      .then((res) => {
        setRelease(res.versions.find((v) => v.id === res.latest.release) ?? null);
        const snap = res.versions.find((v) => v.id === res.latest.snapshot);
        setSnapshot(snap && snap.id !== res.latest.release ? snap : null);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const behind = release
    ? instances.filter((i) => /^\d+\.\d+/.test(i.gameVersion) && compareGameVersions(i.gameVersion, release.id) < 0).length
    : 0;
  const has = (id: string) => instances.some((i) => i.gameVersion === id);

  return (
    <section className="panel mc-now">
      <div className="mc-now__head">
        <h2 className="panel__title">Minecraft сейчас</h2>
        <Button variant="ghost" size="sm" icon={<Newspaper size={14} />} onClick={() => setOpen({})}>
          Все новости
        </Button>
      </div>
      {!release ? (
        <div className="skeleton" style={{ height: 64 }} />
      ) : (
        <div className="mc-now__rows">
          <div className="mc-now__row">
            <button className="mc-now__open" onClick={() => setOpen({ version: release.id })} title="Что нового">
              <span className="mc-now__icon">
                <Sparkles size={18} />
              </span>
              <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="mc-now__version">{release.id}</span>
                <span className="tiny muted">{`Релиз · ${fmtDate(release.releaseTime)}`}</span>
              </span>
              <ChevronRight size={16} className="muted" />
            </button>
            {!has(release.id) && (
              <Button size="sm" icon={<Plus size={14} />} onClick={() => createInstanceFor(release.id)}>
                Создать сборку
              </Button>
            )}
          </div>
          {snapshot && (
            <div className="mc-now__row">
              <button className="mc-now__open" onClick={() => setOpen({ version: snapshot.id })} title="Что нового">
                <span className="mc-now__icon mc-now__icon--snapshot">
                  <FlaskConical size={18} />
                </span>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="mc-now__version">{snapshot.id}</span>
                  <span className="tiny muted">{`Снапшот · ${fmtRelative(snapshot.releaseTime)}`}</span>
                </span>
                <ChevronRight size={16} className="muted" />
              </button>
              {!has(snapshot.id) && (
                <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => createInstanceFor(snapshot.id)}>
                  Создать сборку
                </Button>
              )}
            </div>
          )}
          {behind > 0 && (
            <p className="small muted mc-now__note">{`Сборок на версиях старше ${release.id}: ${behind}. Перед переходом проверьте, вышли ли моды под новую версию.`}</p>
          )}
          <p className="tiny muted mc-now__note">Снапшоты — тестовые версии: играйте в отдельной сборке, миры на них могут сломаться.</p>
        </div>
      )}
      <MinecraftNewsModal open={!!open} initialVersion={open?.version} onClose={() => setOpen(null)} />
    </section>
  );
}
