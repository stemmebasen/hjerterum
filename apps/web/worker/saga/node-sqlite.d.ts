// Only the part of node:sqlite the Saga tests use (Node 22.13+ / 24, no @types/node in this app).
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: unknown[]): unknown;
      all(...values: unknown[]): unknown[];
      run(...values: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
  }
}
