import type { WorldInstallResult } from '../../../shared/types';
import { requestManualDownloads } from '../../ui/ManualDownloads';

type Toast = (kind: 'success' | 'warning' | 'error', title: string, body?: string) => void;

/** Сообщение после установки мира из каталога: куда он попал и что докачано для него. */
export function worldInstallToast(res: WorldInstallResult, title: string, instanceName: string, toast: Toast) {
  // Файлы, которые можно скачать только с сайта, — окно с кнопками «Скачать»
  if (res.manual?.length) requestManualDownloads(res.manual);
  if (res.createdInstance) {
    toast(
      res.missing.length ? 'warning' : 'success',
      `${title} добавлен`,
      `Мир и нужные ему моды — в новой сборке «${res.createdInstance}».`
    );
    window.location.hash = `/library?instance=${res.instanceId}`;
    return;
  }
  if (res.missing.length) {
    const list = res.missing.join(', ');
    toast(
      'warning',
      `${title} добавлен`,
      res.needsLoader ? `Миру нужны моды, а в сборке нет загрузчика: ${list}` : `Не удалось поставить для мира: ${list}`
    );
    return;
  }
  if (res.installed.length) {
    toast('success', `${title} добавлен`, `Докачано для мира: ${res.installed.length}`);
    return;
  }
  toast('success', `${title} добавлен`, `Мир появится в списке миров сборки «${instanceName}».`);
}
