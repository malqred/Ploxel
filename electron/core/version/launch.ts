import type { RuleContext, VersionJson } from './types';
import { expandArguments, splitLegacyArguments } from './resolve';

export interface LaunchInput {
  version: VersionJson;
  ctx: RuleContext;
  classpath: string[];
  nativesDir: string;
  /** Папка libraries — Forge/NeoForge ссылаются на неё в своих аргументах JVM */
  librariesDir?: string;
  assetsRoot: string;
  assetIndex: string;
  gameDir: string;
  versionName: string;
  versionType: string;
  playerName: string;
  uuid: string;
  accessToken: string;
  userType: 'msa' | 'legacy' | 'mojang';
  memoryMb: number;
  extraJvmArgs?: string;
  width?: number;
  height?: number;
  quickPlaySingleplayer?: string;
  quickPlayMultiplayer?: string;
  launcherVersion: string;
  isOffline: boolean;
  logConfigPath?: string;
}

export interface LaunchPlan {
  mainClass: string;
  jvm: string[];
  game: string[];
  classpath: string;
}

export function buildLaunchPlan(input: LaunchInput): LaunchPlan {
  const { version, ctx } = input;
  const sep = ctx.os === 'windows' ? ';' : ':';
  const classpath = input.classpath.join(sep);
  const features: Record<string, boolean> = {
    ...ctx.features,
    is_demo_user: false,
    has_custom_resolution: !!(input.width && input.height),
    has_quick_plays_support: true,
    is_quick_play_singleplayer: !!input.quickPlaySingleplayer,
    is_quick_play_multiplayer: !!input.quickPlayMultiplayer
  };
  const ruleCtx: RuleContext = { ...ctx, features };

  const vars: Record<string, string> = {
    natives_directory: input.nativesDir,
    launcher_name: 'Ploxel',
    launcher_version: input.launcherVersion,
    classpath,
    classpath_separator: sep,
    library_directory: input.librariesDir ?? '',
    version_name: input.versionName,
    version_type: input.versionType,
    game_directory: input.gameDir,
    assets_root: input.assetsRoot,
    game_assets: input.assetsRoot,
    assets_index_name: input.assetIndex,
    auth_player_name: input.playerName,
    auth_uuid: input.uuid.replace(/-/g, ''),
    auth_access_token: input.accessToken,
    auth_session: input.accessToken,
    auth_xuid: '0',
    clientid: 'ploxel',
    user_type: input.userType,
    user_properties: '{}',
    resolution_width: input.width ? String(input.width) : '854',
    resolution_height: input.height ? String(input.height) : '480',
    quickPlayPath: '',
    quickPlaySingleplayer: input.quickPlaySingleplayer ?? '',
    quickPlayMultiplayer: input.quickPlayMultiplayer ?? ''
  };

  const jvm: string[] = [`-Xmx${Math.max(512, input.memoryMb)}M`];
  if (version.arguments?.jvm?.length) {
    jvm.push(...expandArguments(version.arguments.jvm, ruleCtx, vars));
  } else {
    jvm.push(`-Djava.library.path=${input.nativesDir}`, '-cp', classpath);
  }

  if (version.logging?.client) {
    if (input.logConfigPath) jvm.push(`-Dlog4j2.configurationFile=${input.logConfigPath}`);
    jvm.push('-Dlog4j2.formatMsgNoLookups=true');
  } else {
    jvm.push('-Dlog4j2.formatMsgNoLookups=true');
  }

  if (input.extraJvmArgs?.trim()) {
    jvm.push(...splitArgs(input.extraJvmArgs.trim()));
  }

  const game: string[] = [];
  if (version.arguments?.game?.length) {
    game.push(...expandArguments(version.arguments.game, ruleCtx, vars));
  } else if (version.minecraftArguments) {
    game.push(...splitLegacyArguments(version.minecraftArguments, vars));
  }

  if (input.quickPlaySingleplayer) {
    game.push('--quickPlaySingleplayer', input.quickPlaySingleplayer);
  }
  if (input.quickPlayMultiplayer) {
    game.push('--quickPlayMultiplayer', input.quickPlayMultiplayer);
  }

  if (!jvm.some((a) => a === '-cp' || a === '-classpath')) {
    jvm.push('-cp', classpath);
  }

  return { mainClass: version.mainClass, jvm, game, classpath };
}

/** Разбивает строку аргументов, уважая кавычки. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Полная команда: java + JVM-аргументы + mainClass + игровые аргументы. */
export function buildCommand(javaPath: string, plan: LaunchPlan): string[] {
  return [javaPath, ...plan.jvm, plan.mainClass, ...plan.game];
}