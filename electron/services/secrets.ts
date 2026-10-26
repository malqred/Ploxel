import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getRoot } from './paths';

/**
 * Секреты (ключ ИИ) храним отдельно от настроек — в зашифрованном виде
 * через safeStorage (в Windows это DPAPI, привязка к учётной записи).
 * В обычном JSON секретов нет.
 */
function secretFile(name: string) {
  return path.join(getRoot(), 'secrets', `${name}.bin`);
}

export function setSecret(name: string, value: string): boolean {
  const file = secretFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!value) {
    fs.rmSync(file, { force: true });
    return true;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Без системного шифрования не храним ключ на диске вовсе.
    return false;
  }
  fs.writeFileSync(file, safeStorage.encryptString(value));
  return true;
}

export function getSecret(name: string): string | null {
  try {
    const buf = fs.readFileSync(secretFile(name));
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export function hasSecret(name: string): boolean {
  return fs.existsSync(secretFile(name));
}

export function deleteSecret(name: string) {
  fs.rmSync(secretFile(name), { force: true });
}