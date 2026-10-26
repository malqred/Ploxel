import type { LoaderKind } from './types';

/**
 * «Создать новую» на странице проекта: с какой версией игры и загрузчиком
 * создавать сборку. Версия берётся из фильтров страницы, загрузчик — из
 * фильтра или из списка загрузчиков самого проекта.
 */
export interface NewInstanceTargetInput {
  kind: 'mod' | 'modpack' | 'resourcepack' | 'shader';
  filterVersion: string;
  targetVersion?: string;
  fileGameVersions?: string[];
  projectGameVersions?: string[];
  filterLoader: string;
  projectLoaders: string[];
}

export interface NewInstanceTarget {
  gameVersion: string;
  loader: LoaderKind;
}

const LOADER_KINDS = ['fabric', 'forge', 'neoforge', 'quilt'] as const;

export function newInstanceTarget(input: NewInstanceTargetInput): NewInstanceTarget | null {
  const gameVersion = [
    input.filterVersion,
    input.targetVersion,
    ...(input.fileGameVersions ?? []),
    ...(input.projectGameVersions ?? [])
  ].find((v) => !!v && v.trim());
  if (!gameVersion) return null;

  let loader: LoaderKind = 'vanilla';
  if (input.kind === 'mod' || input.kind === 'modpack') {
    const found = [input.filterLoader.toLowerCase(), ...input.projectLoaders.map((l) => l.toLowerCase())].find((l) =>
      (LOADER_KINDS as readonly string[]).includes(l)
    );
    if (found) loader = found as LoaderKind;
  }
  return { gameVersion, loader };
}