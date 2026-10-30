import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '../../ui/Button';
import { fmtGb } from '../../i18n';
import type { MemoryAdvice } from '../../../shared/memory-advice';

const fmtPart = (gb: number) => `${gb > 0 ? '+' : gb < 0 ? '−' : ''}${fmtGb(Math.abs(gb))}`;

/** Рекомендация памяти для сборки и из чего она сложилась. */
export function MemoryAdviceHint({
  advice,
  current,
  onApply
}: {
  advice: MemoryAdvice | null;
  current: number;
  onApply: (gb: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!advice) return <span className="field__hint">Считаем рекомендацию по модам сборки…</span>;
  const same = Math.round(current) === advice.gb;
  return (
    <div className="mem-advice">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Sparkles size={14} className="mem-advice__icon" />
        <span className="grow">
          <strong>{`Рекомендуем для этой сборки: ${advice.gb} ГБ`}</strong>
        </span>
        {!same && (
          <Button variant="secondary" size="sm" onClick={() => onApply(advice.gb)}>
            {`Поставить ${advice.gb} ГБ`}
          </Button>
        )}
        <button type="button" className="mem-advice__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Почему столько <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>
      {advice.limitedByPc && (
        <span className="tiny" style={{ color: 'var(--warning)' }}>
          {`Для такого набора модов лучше ${advice.idealGb} ГБ, но на этом компьютере столько не выделить без вреда для системы.`}
        </span>
      )}
      {open && (
        <div className="mem-advice__parts">
          {advice.parts.map((p, i) => (
            <div key={i} className="mem-advice__part">
              <span className="grow">
                {p.count !== undefined && <span className="mem-advice__count">{p.count}</span>}
                <span>{p.label}</span>
                {p.detail && <span className="muted"> · {p.detail}</span>}
              </span>
              <span className="mem-advice__gb">{i === 0 ? fmtGb(p.gb) : fmtPart(p.gb)}</span>
            </div>
          ))}
          <span className="tiny muted">
            Рекомендация пересчитывается при каждом открытии настроек: учитываются только включённые моды. Моды
            оптимизации и библиотеки почти не добавляют памяти, контент (мобы, миры, оружие, техника, магия, прорисовка) —
            заметно больше. Выделять больше рекомендованного не нужно: лишняя память не ускоряет игру, а при 12–16 ГБ и
            выше возможны подвисания из-за очистки памяти Java.
          </span>
        </div>
      )}
    </div>
  );
}
