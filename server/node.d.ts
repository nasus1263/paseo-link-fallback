// The plugin typechecks without @types/node; declare only the Node APIs the server uses.
declare module "node:fs/promises" {
  export interface DirEntry {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export interface Stats {
    isFile(): boolean;
  }
  export function readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  export function stat(path: string): Promise<Stats>;
}

declare module "node:path" {
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}
