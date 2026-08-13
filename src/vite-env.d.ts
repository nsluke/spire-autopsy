/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRIBUTE_URL?: string;
  readonly VITE_CONTRIBUTE_SAME_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '../../package.json' {
  const value: { version: string; name: string };
  export const version: string;
  export default value;
}
