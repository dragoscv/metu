/**
 * Re-export of the shared `@metu/logger`. Kept as a stable import path for
 * existing call sites in apps/web. New code should import directly from
 * `@metu/logger`.
 */
export { log, __internal } from '@metu/logger';
export type { LogLevel } from '@metu/logger';
