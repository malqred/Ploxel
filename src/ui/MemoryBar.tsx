import { useEffect, useState } from 'react';
import { MemoryStick } from 'lucide-react';
import { api } from '../api';
import { fmtGb } from '../i18n';

interface SystemMemory {
  totalMb: number;
  freeMb: number;
}

/**
 * Полоска памяти компьютера над ползунком: сколько занято программами сейчас,
 * сколько выделяется игре и сколько останется. Обновляется раз в 2 секунды.
 */
export function MemoryBar({ allocatedGb }: { allocatedGb: number }) {
  const [mem, setMem] = useState<SystemMemory | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void api
        .invoke<SystemMemory>('system:memory')
        .then((m) => alive && setMem(m))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!mem || mem.totalMb <= 0) return null;
  const totalGb = mem.totalMb / 1024;
  const freeGb = mem.freeMb / 1024;
  const usedShare = Math.min(1, Math.max(0, (mem.totalMb - mem.freeMb) / mem.totalMb));
  const gameShare = Math.min(1 - usedShare, Math.max(0, allocatedGb / totalGb));
  const tooMuch = allocatedGb > freeGb;

  return (
    <div className="mem-bar" data-warn={tooMuch ? 'true' : undefined}>
      <div className="mem-bar__head">
        <span className="row" style={{ gap: 6 }}>
          <MemoryStick size={14} />
          {`Свободно сейчас: ${fmtGb(freeGb)} из ${fmtGb(totalGb)}`}
        </span>
        <span>{`Игре: ${fmtGb(allocatedGb)}`}</span>
      </div>
      <div className="mem-bar__track" role="img" aria-label={`Занято ${Math.round(usedShare * 100)}%, игре ${Math.round(gameShare * 100)}%`}>
        <span className="mem-bar__used" style={{ transform: `scaleX(${usedShare})` }} />
        <span
          className="mem-bar__game"
          style={{ transform: `translateX(${usedShare * 100}%) scaleX(${gameShare})` }}
        />
      </div>
      <div className="mem-bar__legend">
        <span>
          <i className="mem-bar__dot mem-bar__dot--used" /> Заняты программами
        </span>
        <span>
          <i className="mem-bar__dot mem-bar__dot--game" /> Выделено игре
        </span>
        <span>
          <i className="mem-bar__dot" /> Свободно
        </span>
      </div>
      {tooMuch && (
        <span className="tiny" style={{ color: 'var(--warning)' }}>
          Сейчас свободно меньше, чем выделено игре: закройте лишние программы или уменьшите память, иначе игра может
          тормозить.
        </span>
      )}
    </div>
  );
}
