import type { SagaDeps, SagaEnv } from "./env.js";

/** Google Drive through a service account: Jacob shares Hjerterum's folders with the service
 * account's address as editor, and Saga sees and changes only what is shared. */
type ServiceAccount = { client_email: string; private_key: string };
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
/** A Worker has 128 MB of memory; recordings above this go through a smaller export instead. */
export const MAX_RECORDING_BYTES = 60 * 1024 * 1024;

const base64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function serviceAccount(env: SagaEnv): ServiceAccount {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("drive_not_configured");
  const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) throw new Error("drive_service_account_invalid");
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export async function driveAccessToken(env: SagaEnv, deps: SagaDeps): Promise<string> {
  const account = serviceAccount(env);
  const now = Math.floor(deps.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  }))}`;
  const pem = account.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await deps.fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` })
  });
  const data = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error(`drive_auth_failed: ${response.status}`);
  return data.access_token;
}

export type DriveFile = { id: string; name: string; mimeType: string; size: number; createdTime: string };

/** Audio and video files in the recordings folder, newest first. */
export async function listRecordings(env: SagaEnv, deps: SagaDeps, token: string): Promise<DriveFile[]> {
  const folder = env.GOOGLE_DRIVE_RECORDINGS_FOLDER_ID;
  if (!folder) return [];
  const q = `'${folder.replace(/'/g, "")}' in parents and trashed = false and (mimeType contains 'audio/' or mimeType contains 'video/')`;
  const url = `${DRIVE}/files?${new URLSearchParams({ q, fields: "files(id,name,mimeType,size,createdTime)", orderBy: "createdTime desc", pageSize: "20", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`;
  const response = await deps.fetcher(url, { headers: { authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => null) as { files?: Array<Record<string, unknown>> } | null;
  if (!response.ok || !data) throw new Error(`drive_list_failed: ${response.status}`);
  return (data.files ?? []).map(file => ({ id: String(file.id), name: String(file.name ?? "optagelse"), mimeType: String(file.mimeType ?? ""),
    size: Number(file.size ?? 0), createdTime: String(file.createdTime ?? "") }));
}

export async function downloadDriveFile(deps: SagaDeps, token: string, fileId: string): Promise<ArrayBuffer> {
  const response = await deps.fetcher(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`drive_download_failed: ${response.status}`);
  return response.arrayBuffer();
}

/** A new Google Doc in the minutes folder, converted from HTML so headings and lists survive. */
export async function createGoogleDoc(env: SagaEnv, deps: SagaDeps, token: string, name: string, html: string): Promise<{ id: string; url: string }> {
  const folder = env.GOOGLE_DRIVE_MINUTES_FOLDER_ID;
  if (!folder) throw new Error("drive_minutes_folder_not_configured");
  const boundary = `saga-${deps.now()}`;
  const body = [
    `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "",
    JSON.stringify({ name, mimeType: "application/vnd.google-apps.document", parents: [folder] }),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${boundary}--`, ""
  ].join("\r\n");
  const response = await deps.fetcher(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body
  });
  const data = await response.json().catch(() => null) as { id?: string; webViewLink?: string } | null;
  if (!response.ok || !data?.id) throw new Error(`drive_create_failed: ${response.status}`);
  return { id: data.id, url: data.webViewLink ?? `https://docs.google.com/document/d/${data.id}/edit` };
}

const DOCS = "https://docs.googleapis.com/v1/documents";

/** The board's own minutes document as plain text (for Saga's answers and new minutes). */
export async function readDocText(deps: SagaDeps, token: string, docId: string): Promise<string> {
  const response = await deps.fetcher(`${DRIVE}/files/${encodeURIComponent(docId)}/export?mimeType=text%2Fplain&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`drive_doc_read_failed: ${response.status}`);
  return (await response.text()).replace(/^\uFEFF/, "");
}

/** Saga's Markdown as plain document text: headings as lines, bullets as "•". */
export function plainMinutes(markdown: string): string {
  return markdown.split(/\r?\n/).map(line => line.replace(/^#{1,6}\s+/, "").replace(/^\s*[-*]\s+/, "• ").replace(/\*\*(.+?)\*\*/g, "$1")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Appends a titled section at the end of the document: the title as a heading, the rest as
 * normal text. Nothing above it is touched. */
export async function appendToDoc(deps: SagaDeps, token: string, docId: string, title: string, body: string): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const current = await deps.fetcher(`${DOCS}/${encodeURIComponent(docId)}?fields=body(content(endIndex))`, { headers: auth });
  const data = await current.json().catch(() => null) as { body?: { content?: Array<{ endIndex?: number }> } } | null;
  const end = Math.max(...(data?.body?.content ?? []).map(c => Number(c.endIndex) || 1), 1);
  if (!current.ok) throw new Error(`drive_doc_open_failed: ${current.status}`);
  const at = Math.max(end - 1, 1);
  const text = `\n${title}\n${body.trim()}\n`;
  const titleEnd = at + 1 + title.length + 1;
  const requests = [
    { insertText: { location: { index: at }, text } },
    { updateParagraphStyle: { range: { startIndex: at + 1, endIndex: titleEnd }, paragraphStyle: { namedStyleType: "HEADING_2" }, fields: "namedStyleType" } },
    { updateParagraphStyle: { range: { startIndex: titleEnd, endIndex: at + text.length }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } }
  ];
  const response = await deps.fetcher(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, {
    method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ requests })
  });
  if (!response.ok) throw new Error(`drive_doc_append_failed: ${response.status}`);
  return `https://docs.google.com/document/d/${docId}/edit`;
}
