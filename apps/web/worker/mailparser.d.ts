// The slice of mailparser that teamMail.ts uses (the package ships no types; @types/mailparser would pull in Node's).
declare module "mailparser" {
  type AddressObject = { text?: string; value?: Array<{ name?: string; address?: string }> };
  export function simpleParser(source: unknown): Promise<{ text?: string; html?: string | false; textAsHtml?: string; subject?: string; date?: Date;
    from?: AddressObject; to?: AddressObject | AddressObject[]; cc?: AddressObject | AddressObject[]; replyTo?: AddressObject;
    attachments?: Array<{ filename?: string; contentType?: string; size?: number; content?: Uint8Array; cid?: string; contentDisposition?: string; related?: boolean }> }>;
}
