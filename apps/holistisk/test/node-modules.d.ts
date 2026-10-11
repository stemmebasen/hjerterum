// Only the tests use Node built-ins (the Worker itself has no Node types): a minimal surface of what they call.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[]; run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } };
    close(): void;
  }
}
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
  export function readdirSync(path: URL | string): string[];
}
