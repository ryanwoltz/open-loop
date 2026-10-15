declare const __OPEN_LOOP_VERSION__: string | undefined;

export const VERSION: string =
  typeof __OPEN_LOOP_VERSION__ === 'string' ? __OPEN_LOOP_VERSION__ : '0.0.0-dev';
