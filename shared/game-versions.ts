/**
 * Версии Minecraft из каталогов: Modrinth отдаёт вперемешку релизы,
 * снапшоты (19w02a), пре-релизы и кандидаты, причём от старых к новым.
 * Здесь — отбор релизов и сортировка от новых к старым.
 */

/** Релиз: 1.20.1, 1.21, а также новая схема 26.1 / 26.1.2 */
export function isReleaseVersion(v: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(v);
}

export function compareGameVersions(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Уникальные релизы от новых к старым; снапшоты — только если попросили. */
export function sortGameVersions(list: string[], includeSnapshots = false): string[] {
  const unique = [...new Set(list.filter(Boolean))];
  const releases = unique.filter(isReleaseVersion).sort((a, b) => compareGameVersions(b, a));
  if (!includeSnapshots) return releases;
  const other = unique.filter((v) => !isReleaseVersion(v)).sort().reverse();
  return [...releases, ...other];
}

/** Коротко для строки версии: «1.21.8, 1.21.7, 1.21.6 +12». */
export function summarizeGameVersions(list: string[], max = 3): string {
  const releases = sortGameVersions(list);
  const shown = releases.length ? releases : [...new Set(list)];
  const head = shown.slice(0, max).join(', ');
  return shown.length > max ? `${head} +${shown.length - max}` : head;
}
