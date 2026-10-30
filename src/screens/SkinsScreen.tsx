import { useEffect, useState } from 'react';
import { Check, FolderOpen, RefreshCw, RotateCcw, Upload, UserRound } from 'lucide-react';
import { api } from '../api';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Controls';
import { ScreenHeader } from '../ui/Common';
import { SkinViewer } from '../ui/SkinViewer';
import { SkinEditor } from '../ui/SkinEditor';
import { useToast } from '../state/toast';
import { convertArms, detectArmModel, type ArmModel } from '../../shared/skin-model';
import type { Account, SkinLayers } from '../../shared/types';

/** Пиксели скина из data-URL (через canvas). */
function readPixels(src: string): Promise<{ data: Uint8ClampedArray; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ data: ctx.getImageData(0, 0, 64, img.naturalHeight).data, height: img.naturalHeight });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function pixelsToDataUrl(data: Uint8ClampedArray): string {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), 64, 64), 0, 0);
  return canvas.toDataURL('image/png');
}

const ARM_LABEL: Record<ArmModel, string> = { classic: 'широкие руки (Classic)', slim: 'тонкие руки (Slim)' };

interface SkinState {
  current: string | null;
  currentName: string | null;
  variant: 'classic' | 'slim';
  layers: SkinLayers;
  library: { file: string; name: string; dataUrl: string }[];
}

interface CapeInfo {
  id: string;
  name: string;
  url?: string;
  active: boolean;
}

const ALL_LAYERS: SkinLayers = { hat: true, jacket: true, sleeves: true, pants: true };

export function SkinsScreen() {
  const [state, setState] = useState<SkinState | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [capes, setCapes] = useState<CapeInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [walking, setWalking] = useState(() => localStorage.getItem('ploxel.skinWalk') !== '0');
  const [layers3d, setLayers3dState] = useState(() => localStorage.getItem('ploxel.skin3d') !== '0');
  const setLayers3d = (v: boolean) => {
    setLayers3dState(v);
    localStorage.setItem('ploxel.skin3d', v ? '1' : '0');
  };
  const { toast } = useToast();

  const setWalk = (v: boolean) => {
    setWalking(v);
    localStorage.setItem('ploxel.skinWalk', v ? '1' : '0');
  };

  const applyState = (s: SkinState) => {
    setState(s);
    setEdited(s.current);
  };

  /** Новый или выбранный скин: тип рук определяется по самой текстуре. */
  const applyWithModel = async (s: SkinState) => {
    applyState(s);
    if (!s.current) return;
    const px = await readPixels(s.current);
    if (!px || px.height !== 64) return;
    const model = detectArmModel(px.data);
    if (model !== s.variant) {
      applyState(await api.invoke<SkinState>('skins:variant', model));
      toast('info', `Скин сделан под ${ARM_LABEL[model]}`, 'Вариант модели переключён автоматически.');
    }
  };

  const load = async () => {
    const [s, a] = await Promise.all([
      api.invoke<SkinState>('skins:state'),
      api.invoke<Account | null>('accounts:active')
    ]);
    applyState(s);
    setAccount(a);
    if (a?.type === 'microsoft') {
      try {
        setCapes(await api.invoke<CapeInfo[]>('skins:capes', a.id));
      } catch {
        setCapes([]);
      }
    } else {
      setCapes([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const importSkin = async () => {
    const file = await api.dialog.file('Выберите скин (.png 64×64)', [{ name: 'PNG', extensions: ['png'] }]);
    if (!file) return;
    setBusy(true);
    try {
      const next = await api.invoke<SkinState>('skins:importFile', file);
      await applyWithModel(next);
      toast('success', 'Скин загружен', 'Можно дорисовать его в редакторе слева.');
    } catch (e) {
      toast('error', 'Скин не подошёл', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePainted = async (dataUrl: string) => {
    setBusy(true);
    try {
      const next = await api.invoke<SkinState>('skins:savePng', dataUrl, 'painted');
      applyState(next);
      toast('success', 'Скин сохранён', 'Он добавлен в «Мои скины» и выбран текущим.');
    } catch (e) {
      toast('error', 'Не удалось сохранить', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyToAccount = async () => {
    if (account?.type === 'elyby') {
      // У Ely.by нет API загрузки скина: файл загружается на сайте
      toast('info', 'Скин Ely.by меняется на сайте', 'Скачайте скин кнопкой «Скачать скин» и загрузите его на ely.by.');
      void api.shell.openExternal('https://ely.by');
      return;
    }
    if (!account || account.type !== 'microsoft') {
      toast('warning', 'Нужен аккаунт Microsoft', 'Офлайн-скин виден только в предпросмотре.');
      return;
    }
    setBusy(true);
    try {
      // На аккаунт уходит текстура под выбранные руки (как в предпросмотре)
      await api.invoke('skins:upload', account.id, state?.current ? await adapted(state.current, state.variant) : undefined);
      toast('success', 'Скин применён', 'Изменения появятся в игре в течение минуты.');
    } catch (e) {
      toast('error', 'Не удалось применить скин', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (account?.type === 'microsoft') {
      setBusy(true);
      try {
        await api.invoke('skins:reset', account.id);
        toast('success', 'Скин сброшен на стандартный');
      } catch (e) {
        toast('error', 'Не удалось сбросить', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
    applyState(await api.invoke<SkinState>('skins:clear'));
  };

  /**
   * Смена варианта модели. В «Моих скинах» скин остаётся один: под другие
   * руки он перекладывается на лету — в просмотре, при скачивании и при
   * отправке на аккаунт.
   */
  const setVariant = async (variant: ArmModel) => {
    if (!state || variant === state.variant) return;
    applyState(await api.invoke<SkinState>('skins:variant', variant));
  };

  /** Скин под выбранные руки (PNG data-URL): тонкие ↔ широкие перекладываются. */
  const adapted = async (src: string, variant: ArmModel): Promise<string> => {
    const px = await readPixels(src);
    if (!px || px.height !== 64) return src;
    const model = detectArmModel(px.data);
    return model === variant ? src : pixelsToDataUrl(convertArms(px.data, model, variant));
  };

  /** «Скачать» в редакторе: скин из предпросмотра — в выбранную папку под выбранным именем. */
  const downloadSkin = async () => {
    const src = edited ?? state?.current;
    if (!src || !state) {
      toast('warning', 'Сначала выберите или нарисуйте скин');
      return;
    }
    const base = (state.currentName ?? 'skin.png').replace(/\.png$/, '');
    const target = await api.dialog.save('Сохранить скин', `${base}.png`, [{ name: 'PNG', extensions: ['png'] }]);
    if (!target) return;
    try {
      const saved = await api.invoke<string>('skins:export', await adapted(src, state.variant), target);
      toast('success', 'Скин сохранён', saved);
    } catch (e) {
      toast('error', 'Не удалось сохранить скин', e instanceof Error ? e.message : String(e));
    }
  };

  const setCape = async (capeId: string | null) => {
    if (!account) return;
    try {
      await api.invoke('skins:setCape', account.id, capeId);
      await load();
      toast('success', capeId ? 'Плащ выбран' : 'Плащ скрыт');
    } catch (e) {
      toast('error', 'Не удалось изменить плащ', e instanceof Error ? e.message : String(e));
    }
  };

  if (!state) {
    return (
      <div className="screen">
        <ScreenHeader title="Скины" />
        <div className="panel skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Скины"
        sub="Рисуйте скин прямо здесь, смотрите 3D-превью и применяйте на аккаунт."
        actions={
          <>
            <Button variant="secondary" icon={<Upload size={15} />} onClick={importSkin} loading={busy}>
              Загрузить .png
            </Button>
            <Button onClick={applyToAccount} disabled={!state.current}>
              Применить на аккаунт
            </Button>
          </>
        }
      />

      <div className="skins-layout">
        <section className="panel skin-editor-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel__title">Редактор</h2>
            <span className="tiny muted">64×64</span>
          </div>
          <SkinEditor skin={edited} onChange={setEdited} onSave={savePainted} onDownload={downloadSkin} />
        </section>

        <section className="skin-panel">
          <SkinViewer skin={edited} variant={state.variant} layers={ALL_LAYERS} walking={walking} layers3d={layers3d} />
          <div className="skin-options">
            <span className="row" style={{ gap: 8, paddingRight: 8 }}>
              <Toggle checked={walking} onChange={setWalk} label="Анимация" />
              <span className="small">Анимация</span>
            </span>
            <span className="row" style={{ gap: 8, paddingRight: 8 }} title="Второй слой (волосы, куртка) рисуется объёмными пикселями, как в моде 3D Skin Layers">
              <Toggle checked={layers3d} onChange={setLayers3d} label="3D-слои" />
              <span className="small">3D-слои</span>
            </span>
            <button className="chip chip--button" data-active={state.variant === 'classic'} onClick={() => setVariant('classic')}>
              Classic (4px)
            </button>
            <button className="chip chip--button" data-active={state.variant === 'slim'} onClick={() => setVariant('slim')}>
              Slim (3px)
            </button>
            <button className="chip chip--button" onClick={reset}>
              <RotateCcw size={12} /> Сброс
            </button>
          </div>
          <p className="tiny muted">Левая кнопка — повернуть, колёсико — приблизить, зажатое колёсико — сдвинуть камеру. Двойной клик — вернуть ракурс.</p>
        </section>
      </div>

      <div className="skins-grid-lower">
        <section className="panel settings-section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel__title">Мои скины</h2>
            <span className="row" style={{ gap: 6 }}>
              <span className="tiny muted">{state.library.length}</span>
              <IconButton label="Открыть папку со скинами" size="sm" ghost onClick={() => void api.invoke('skins:openFolder')}>
                <FolderOpen size={15} />
              </IconButton>
            </span>
          </div>
          {state.library.length === 0 ? (
            <p className="small muted">Загрузите PNG или нарисуйте скин — он появится здесь.</p>
          ) : (
            <div className="skin-library">
              {state.library.map((item) => (
                <button
                  key={item.file}
                  className="skin-thumb"
                  aria-selected={state.currentName === item.file}
                  onClick={() =>
                    api.invoke<SkinState>('skins:select', item.file).then(async (next) => {
                      toast('info', 'Скин выбран', item.name);
                      await applyWithModel(next);
                    })
                  }
                >
                  <img src={item.dataUrl} alt={item.name} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel settings-section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="panel__title">Аккаунт</h2>
            <span className="chip chip--accent">
              <UserRound size={12} /> {account?.name ?? 'Гость'}
            </span>
          </div>
          {account?.type === 'microsoft' ? (
            <p className="small muted">
              Скин и плащ меняются через официальный API Minecraft. Если сервер не показывает скин сразу,
              подождите минуту и перезайдите.
            </p>
          ) : account?.type === 'elyby' ? (
            <p className="small muted">
              Аккаунт Ely.by: в игре виден скин, загруженный на сайте ely.by. Нарисуйте скин здесь, скачайте его и
              загрузите на ely.by — его увидят игроки с Ely.by и серверы с его поддержкой.
            </p>
          ) : (
            <p className="small muted">
              Офлайн-режим: скин сохраняется локально и виден в предпросмотре. Другие игроки увидят его лишь на
              серверах с плагинами синхронизации скинов — это ограничение Mojang.
            </p>
          )}
          {account?.type === 'microsoft' && (
            <>
              <div className="divider" />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="field__label" style={{ margin: 0 }}>Плащи</span>
                <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={load}>
                  Обновить
                </Button>
              </div>
              {capes.length === 0 ? (
                <p className="small muted">На аккаунте нет плащей.</p>
              ) : (
                <div className="cape-grid">
                  {capes.map((cape) => (
                    <button key={cape.id} className="cape-card" aria-selected={cape.active} onClick={() => setCape(cape.id)}>
                      {cape.url && <img src={cape.url} alt="" />}
                      <div className="row" style={{ gap: 4, marginTop: 4 }}>
                        {cape.active && <Check size={12} />} {cape.name}
                      </div>
                    </button>
                  ))}
                  <button className="cape-card" onClick={() => setCape(null)}>
                    <div style={{ height: 44 }} />
                    Скрыть плащ
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}