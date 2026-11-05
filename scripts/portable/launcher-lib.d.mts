// launcher-lib.mjs の型（テストが型つきで読むための宣言。配布物には入れない）
export const DEFAULT_PORT: number;
export const PORT_TRIES: number;
export function defaultDataDir(input: {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
}): string;
export function parseEnvFile(text: string): Record<string, string>;
export function mergeEnv(
  processEnv: Record<string, string | undefined>,
  fileEnv: Record<string, string>,
): Record<string, string | undefined>;
export function isPortFree(port: number, host?: string): Promise<boolean>;
export function findFreePort(
  start: number,
  tries?: number,
  check?: (port: number) => Promise<boolean>,
): Promise<number | undefined>;
export function parsePort(value: unknown): number | undefined;
export function openCommand(platform: string, url: string): { command: string; args: string[] };
export function isUchidaiRunning(
  port: number,
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<boolean>;
