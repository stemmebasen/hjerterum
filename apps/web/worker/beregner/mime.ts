/** A plain e-mail (RFC 5322 / MIME) built in the worker: a text and an HTML part and any attachments. Used to lay a
 * booking request straight into Hjerterum's own inbox (teamMail.ts deliverToTeamInbox) - nothing is sent anywhere. */

export type MimeAddress = { name?: string; address: string };
export type MimeAttachment = { filename: string; contentType: string; bytes: Uint8Array };

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const wrap = (text: string) => text.replace(/.{1,76}/g, line => `${line}\r\n`);
/** A header word: plain ASCII as it is, anything else as RFC 2047 UTF-8 base64. */
export const headerWord = (text: string) => /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(encoder.encode(text))}?=`;
const clean = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const address = (a: MimeAddress) => a.name ? `${headerWord(clean(a.name).replace(/"/g, "'"))} <${clean(a.address)}>` : `<${clean(a.address)}>`;

export function buildMime(mail: { from: MimeAddress; to: MimeAddress; replyTo?: MimeAddress; subject: string; text: string; html: string;
  attachments?: MimeAttachment[]; date: Date; messageId: string }): Uint8Array {
  const boundary = `hjerterum-${crypto.randomUUID()}`, alt = `${boundary}-alt`;
  const lines = [
    `From: ${address(mail.from)}`, `To: ${address(mail.to)}`, ...(mail.replyTo ? [`Reply-To: ${address(mail.replyTo)}`] : []),
    `Subject: ${headerWord(clean(mail.subject))}`, `Date: ${mail.date.toUTCString().replace("GMT", "+0000")}`, `Message-ID: <${mail.messageId}>`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`, "", `--${alt}`,
    "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(b64(encoder.encode(mail.text))), `--${alt}`,
    "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrap(b64(encoder.encode(mail.html))), `--${alt}--`, "",
  ];
  for (const file of mail.attachments ?? []) {
    const name = clean(file.filename).replace(/"/g, "'") || "billede";
    lines.push(`--${boundary}`, `Content-Type: ${file.contentType}; name="${headerWord(name)}"`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${headerWord(name)}"`, "", wrap(b64(file.bytes)));
  }
  lines.push(`--${boundary}--`, "");
  return encoder.encode(lines.join("\r\n"));
}
