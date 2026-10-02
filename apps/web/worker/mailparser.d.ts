// The slice of mailparser that teamMail.ts uses (the package ships no types; @types/mailparser would pull in Node's).
declare module "mailparser" {
  export function simpleParser(source: unknown): Promise<{ text?: string; html?: string | false }>;
}
