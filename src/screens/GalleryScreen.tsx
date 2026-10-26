import { useState } from 'react';
import { ArrowRight, Check, Download, Heart, Play, Plus, Star, Trash2 } from 'lucide-react';
import { ScreenHeader, EmptyState } from '../ui/Common';
import { Button, IconButton } from '../ui/Button';
import { Checkbox, ProgressBar, Radio, Slider, Tabs, Toggle } from '../ui/Controls';
import { SearchField, Select, TextArea, TextField } from '../ui/TextField';
import { ConfirmDialog, Modal, Tip } from '../ui/Overlay';
import { SkinViewer } from '../ui/SkinViewer';
import { useToast } from '../state/toast';

/** Внутренняя витрина компонентов (для разработки), не раздел для пользователя. */
export function GalleryScreen() {
  const [tab, setTab] = useState('all');
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(true);
  const [mixed, setMixed] = useState(false);
  const [radio, setRadio] = useState(1);
  const [slider, setSlider] = useState(42);
  const [text, setText] = useState('');
  const [select, setSelect] = useState('forge');
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(35);
  const { toast } = useToast();

  return (
    <div className="screen">
      <ScreenHeader
        title="Витрина компонентов"
        sub="Служебная страница: все состояния, объём и анимации в одном месте."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setProgress((p) => (p >= 100 ? 10 : p + 15))}>
              Прогресс +15%
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toast('info', 'Уведомление', 'Так выглядит всплывающее сообщение с описанием.')
              }
            >
              Показать toast
            </Button>
          </>
        }
      />

      <section className="panel settings-section">
        <h2 className="panel__title">Кнопки</h2>
        <div className="row wrap" style={{ gap: 10 }}>
          <Button>Основная</Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="purple">Обновить</Button>
          <Button variant="neutral">Нейтральная</Button>
          <Button variant="danger" icon={<Trash2 size={15} />}>Удалить</Button>
          <Button variant="ghost">Призрачная</Button>
          <Button disabled>Заблокирована</Button>
          <Button loading>Загрузка</Button>
          <Button size="sm" icon={<Plus size={14} />}>Малая</Button>
          <Button size="lg" icon={<Play size={18} fill="currentColor" />}>Большая</Button>
          <Button size="xl" glow icon={<Play size={20} fill="currentColor" />}>ИГРАТЬ</Button>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <IconButton label="Аккаунт"><Check size={16} /></IconButton>
          <IconButton label="Скачать"><Download size={16} /></IconButton>
          <IconButton label="Далее"><ArrowRight size={16} /></IconButton>
          <IconButton label="Избранное" ghost><Heart size={16} /></IconButton>
          <IconButton label="Малый" size="sm"><Star size={14} /></IconButton>
          <IconButton label="Заблокировано" disabled><Plus size={16} /></IconButton>
        </div>
      </section>

      <section className="panel settings-section">
        <h2 className="panel__title">Переключатели</h2>
        <div className="row wrap" style={{ gap: 24 }}>
          <div className="row"><Toggle checked={on} onChange={setOn} /><span className="small">Тумблер</span></div>
          <div className="row"><Toggle checked={false} onChange={() => {}} /><span className="small">Выключен</span></div>
          <div className="row"><Toggle checked onChange={() => {}} disabled /><span className="small">Заблокирован</span></div>
          <div className="row"><Checkbox checked={check} onChange={setCheck} /><span className="small">Чекбокс</span></div>
          <div className="row"><Checkbox checked={false} indeterminate={mixed} onChange={() => setMixed(!mixed)} /><span className="small">Неопределённый</span></div>
          <div className="row"><Checkbox checked onChange={() => {}} disabled /><span className="small">Заблокирован</span></div>
          {[1, 2, 3].map((n) => (
            <button key={n} className="row" onClick={() => setRadio(n)}>
              <Radio checked={radio === n} onChange={() => setRadio(n)} />
              <span className="small">Вариант {n}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel settings-section">
        <h2 className="panel__title">Вкладки, ползунки, прогресс</h2>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'all', label: 'Все' },
            { id: 'mods', label: 'Моды' },
            { id: 'packs', label: 'Сборки' },
            { id: 'fav', label: 'Избранное' }
          ]}
        />
        <div className="row" style={{ gap: 24, alignItems: 'flex-start', marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <Slider value={slider} min={0} max={100} onChange={setSlider} format={(v) => `${v}%`} marks={['0', '50', '100']} />
          </div>
          <div style={{ flex: 1 }}>
            <ProgressBar value={progress} thick label={`${progress}%`} />
            <div style={{ height: 8 }} />
            <ProgressBar value={0} loading />
          </div>
        </div>
      </section>

      <section className="panel settings-section">
        <h2 className="panel__title">Поля и списки</h2>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 260 }}>
            <TextField label="Обычное поле" value={text} onChange={setText} placeholder="Введите текст" />
          </div>
          <div style={{ width: 260 }}>
            <TextField label="Ошибка" value="abc" onChange={() => {}} error="Недопустимое значение" />
          </div>
          <div style={{ width: 260 }}>
            <SearchField value="" onChange={() => {}} placeholder="Поиск…" />
          </div>
          <div style={{ width: 200 }}>
            <Select
              value={select}
              onChange={setSelect}
              options={[
                { value: 'forge', label: 'Forge 1.21.1' },
                { value: 'fabric', label: 'Fabric 0.16.5' },
                { value: 'neoforge', label: 'NeoForge 21.1.80' }
              ]}
            />
          </div>
          <div style={{ width: 340 }}>
            <TextArea label="Многострочное" value="" onChange={() => {}} placeholder="Текст…" />
          </div>
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Tip title="Подсказка" sub="Тёмная плашка с заголовком и описанием.">
            <Button variant="secondary" size="sm">Наведите</Button>
          </Tip>
          <Button variant="secondary" size="sm" onClick={() => setModal(true)}>Открыть окно</Button>
          <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>Подтверждение</Button>
        </div>
      </section>

      <section className="panel settings-section">
        <h2 className="panel__title">Карточки и состояния</h2>
        <div className="card-grid">
          <div className="card card--hover">
            <div className="card__media" />
            <div className="card__title">Карточка проекта</div>
            <div className="card__meta">128 тыс. загрузок · Fabric</div>
          </div>
          <div className="card" aria-selected="true">
            <div className="card__media" />
            <div className="card__title">Выбранная карточка</div>
            <div className="card__meta">Состояние выбора</div>
          </div>
          <div className="card">
            <div className="skeleton" style={{ height: 72 }} />
            <div className="skeleton" style={{ height: 14, width: '60%' }} />
            <div className="skeleton" style={{ height: 14, width: '40%' }} />
          </div>
          <EmptyState title="Пустое состояние" hint="Когда данных нет, показываем спокойную заглушку с подсказкой." />
        </div>
      </section>

      <section className="panel settings-section">
        <h2 className="panel__title">3D-скин</h2>
        <p className="small muted">Модель проверяется на экране «Скины»; здесь — тот же компонент.</p>
        <div style={{ height: 300 }}>
          <SkinViewer
            skin={null}
            variant="classic"
            layers={{ hat: true, jacket: true, sleeves: true, pants: true }}
          />
        </div>
      </section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Пример модального окна"
        actions={<Button onClick={() => setModal(false)}>Понятно</Button>}
      >
        <p>Заголовок, содержимое и действия. Окно закрывается по Esc и клику по фону.</p>
        <TextField label="Поле внутри окна" value="" onChange={() => {}} placeholder="Поставьте курсор — фокус виден" />
      </Modal>

      <ConfirmDialog
        open={confirm}
        title="Удалить сборку?"
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          toast('success', 'Так выглядит подтверждение действия');
        }}
      >
        <p>Пояснение последствий: что именно будет удалено и как это отменить.</p>
      </ConfirmDialog>
    </div>
  );
}