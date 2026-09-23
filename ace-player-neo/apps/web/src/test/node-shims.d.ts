/* Tipos mínimos de los módulos de Node que usan algunos tests (se ejecutan en
   Node con jsdom). No se cargan los tipos completos de Node en la web a
   propósito: cambiarían, por ejemplo, lo que devuelve setTimeout en todo el
   código del navegador. */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
}

declare module 'node:path' {
  const path: {
    dirname(path: string): string;
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
    relative(from: string, to: string): string;
  };
  export default path;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
