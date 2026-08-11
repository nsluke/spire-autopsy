/**
 * Minimal ambient typings for the Node builtins the test suite touches.
 * The app tsconfig deliberately carries no @types/node (this is a
 * browser-only project); these declarations cover exactly what the
 * vitest files call and nothing more.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string;
}
