import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Конфигурация с секретами. Файл config.json кладётся рядом с exe
 * (или в корень проекта при разработке) либо задаётся переменными окружения.
 *
 * Ключи НЕ зашиваются в код и НЕ выдумываются. Если ключа нет — функция
 * работает в урезанном режиме и честно об этом сообщает.
 */

export interface AppConfig {
  microsoftClientId: string;
  curseforgeApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  updateFeedUrl: string;
}

let cached: AppConfig | null = null;

function readJson(file: string): Record<string, string> {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function getConfig(): AppConfig {
  if (cached) return cached;
  const exeDir = path.dirname(app.getPath('exe'));
  const fromExe = readJson(path.join(exeDir, 'config.json'));
  const fromResources = readJson(path.join(process.resourcesPath, 'config.json'));
  const fromApp = readJson(path.join(app.getAppPath(), 'config.json'));
  const merged: Record<string, string> = { ...fromApp, ...fromResources, ...fromExe };
  const env = process.env;
  cached = {
    microsoftClientId: env.PLOXEL_MS_CLIENT_ID || merged.microsoftClientId || '',
    curseforgeApiKey: env.PLOXEL_CURSEFORGE_KEY || merged.curseforgeApiKey || '',
    aiBaseUrl: env.PLOXEL_AI_BASE_URL || merged.aiBaseUrl || 'https://api.openai.com/v1',
    aiModel: env.PLOXEL_AI_MODEL || merged.aiModel || 'gpt-4o-mini',
    aiApiKey: env.PLOXEL_AI_KEY || merged.aiApiKey || '',
    updateFeedUrl: env.PLOXEL_UPDATE_URL || merged.updateFeedUrl || ''
  };
  return cached;
}