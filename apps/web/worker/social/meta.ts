import type { SagaDeps } from "../saga/env.js";

/** Requested: "Så vi skal have kontakt til vores sociale medier." Hjerterum's Facebook page and its Instagram (a professional account
 * linked to the page), through Meta's Graph API. Only what the PR cockpit needs: connecting (Facebook Login), the posts Hjerterum is
 * tagged in, a post on the page, and a photo or carousel on Instagram. The page's token never leaves this file's calls to Meta. */

export const GRAPH_VERSION = "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What the page's token must be able to do: read the page and what it is tagged in, post on it, and read and publish on its Instagram. */
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_posts",
  "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "business_management"];
/** Reported (the chair, 6 Nov 2026): "Invalid Scopes: pages_messaging, publish_video" - Facebook's dialog refuses the whole login when the app asks for a
 * permission its use cases in Meta's dashboard do not have. pages_messaging is asked for only once the app has the Messenger use case
 * (META_MESSENGER=1); a video on the page needs only pages_manage_posts. */
export const MESSENGER_SCOPES = ["pages_messaging"];
export const scopesFor = (env: MetaEnv) => env.META_MESSENGER === "1" ? [...META_SCOPES, ...MESSENGER_SCOPES] : META_SCOPES;

export type MetaEnv = { META_APP_ID?: string; META_APP_SECRET?: string; META_LOGIN_CONFIG_ID?: string; META_MESSENGER?: string };
export const metaReady = (env: MetaEnv) => Boolean(env.META_APP_ID && env.META_APP_SECRET);

export class MetaError extends Error {
  constructor(message: string, readonly code: number | null = null) { super(message); }
}

type Fetcher = SagaDeps["fetcher"];

async function graph<T>(fetcher: Fetcher, method: "GET" | "POST", path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  const url = method === "GET" ? `${path.startsWith("https://") ? path : GRAPH + path}${path.includes("?") ? "&" : "?"}${query}` : GRAPH + path;
  const response = await fetcher(url, method === "GET" ? { headers: { accept: "application/json" } }
    : { method, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: query.toString() });
  const data = await response.json().catch(() => null) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!response.ok || !data || data.error) throw new MetaError(`meta_${response.status}: ${(data?.error?.message ?? "").slice(0, 200)}`.trim(), data?.error?.code ?? null);
  return data;
}

// ---- Connecting ----

/** Facebook's login dialog: back to `redirect` with a code and our `state`. With a Facebook Login for Business configuration its id is used, else the scopes. */
export function loginUrl(env: MetaEnv, redirect: string, state: string): string {
  const params = new URLSearchParams({ client_id: env.META_APP_ID ?? "", redirect_uri: redirect, state, response_type: "code" });
  if (env.META_LOGIN_CONFIG_ID) params.set("config_id", env.META_LOGIN_CONFIG_ID);
  else params.set("scope", scopesFor(env).join(","));
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
}

export type MetaPage = { id: string; name: string; token: string; igUserId: string | null; igUsername: string | null };

/** The code from the dialog becomes a long-lived user token, and that gives each page's own token - one that does not expire. */
export async function pagesFromCode(env: MetaEnv, fetcher: Fetcher, code: string, redirect: string): Promise<MetaPage[]> {
  if (!metaReady(env)) throw new MetaError("meta_not_configured");
  const app = { client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET! };
  const short = await graph<{ access_token: string }>(fetcher, "GET", "/oauth/access_token", { ...app, redirect_uri: redirect, code });
  const long = await graph<{ access_token: string }>(fetcher, "GET", "/oauth/access_token", { ...app, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token });
  const pages = await graph<{ data?: Array<{ id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } }> }>(
    fetcher, "GET", "/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50", access_token: long.access_token });
  return (pages.data ?? []).filter(p => p.access_token).map(p => ({ id: p.id, name: p.name, token: p.access_token!,
    igUserId: p.instagram_business_account?.id ?? null, igUsername: p.instagram_business_account?.username ?? null }));
}

/** Hjerterum's page among those the person manages: the one named Hjerterum, else the only one. */
export function hjerterumPage(pages: MetaPage[]): MetaPage | null {
  return pages.find(p => /hjerterum/i.test(p.name)) ?? (pages.length === 1 ? pages[0]! : null);
}

// ---- What Hjerterum is tagged in ----

export type TaggedPost = {
  network: "facebook" | "instagram";
  id: string;
  author: string | null;
  permalink: string | null;
  text: string;
  createdMs: number;
  /** Pictures in the post (Instagram: the photos, in order; Facebook: its picture). Instagram's addresses expire, so they are read again before posting. */
  images: string[];
  /** "image", "carousel" or "video" - Instagram can only pass on photos. */
  media: "image" | "carousel" | "video" | "none";
  /** Sent to the page in Messenger, not tagged. */
  via?: "messenger";
};

/** Public posts on Facebook that tag the page (newest first). */
export async function taggedOnFacebook(fetcher: Fetcher, page: { id: string; token: string }, limit = 25): Promise<TaggedPost[]> {
  const data = await graph<{ data?: Array<{ id: string; message?: string; permalink_url?: string; from?: { name?: string }; created_time?: string; full_picture?: string }> }>(
    fetcher, "GET", `/${page.id}/tagged`, { fields: "id,message,permalink_url,from{name},created_time,full_picture", limit: String(limit), access_token: page.token });
  return (data.data ?? []).map(p => ({ network: "facebook" as const, id: p.id, author: p.from?.name ?? null, permalink: p.permalink_url ?? null, text: p.message ?? "",
    createdMs: Date.parse(p.created_time ?? "") || 0, images: p.full_picture ? [p.full_picture] : [], media: p.full_picture ? "image" as const : "none" as const }));
}

/** Requested (the chair, 6 Nov 2026): "Hvorfor dukker disse to ikke op i admin? Altså, hvorfor finder Saga dem ikke?" - a teacher sent their reel, another a
 * Facebook video, in a message to the page - and "Saga læser Messenger". Each link to a post on Instagram or Facebook that someone else sent the page lately,
 * as a post to share: the sender, their words, and the link (a video goes out on Facebook as a link). */
export async function sentInMessenger(fetcher: Fetcher, page: { id: string; token: string }, limit = 25): Promise<TaggedPost[]> {
  type Message = { id: string; message?: string; created_time?: string; from?: { id?: string; name?: string };
    shares?: { data?: Array<{ link?: string; name?: string; description?: string }> }; attachments?: { data?: Array<{ type?: string; url?: string; target?: { url?: string };
      image_data?: { url?: string; preview_url?: string }; video_data?: { url?: string; preview_url?: string } }> } };
  const data = await graph<{ data?: Array<{ messages?: { data?: Message[] } }> }>(fetcher, "GET", `/${page.id}/conversations`, { platform: "messenger", limit: String(limit),
    fields: "updated_time,messages.limit(10){id,message,created_time,from,shares{link,name,description},attachments{type,url,target,image_data,video_data}}", access_token: page.token });
  const out: TaggedPost[] = [];
  for (const conversation of data.data ?? []) for (const m of conversation.messages?.data ?? []) {
    if (!m.from?.id || m.from.id === page.id) continue;
    const links = new Set<string>();
    for (const found of (m.message ?? "").matchAll(/https?:\/\/(?:www\.|m\.|web\.)?(?:instagram\.com|facebook\.com|fb\.watch)\/[^\s<>"')]+/gi)) links.add(found[0]);
    for (const share of m.shares?.data ?? []) if (share.link) links.add(share.link);
    for (const a of m.attachments?.data ?? []) for (const url of [a.target?.url, a.url]) if (url && /instagram\.com|facebook\.com|fb\.watch/i.test(url)) links.add(url);
    const picture = (m.attachments?.data ?? []).map(a => a.image_data?.url ?? a.image_data?.preview_url ?? a.video_data?.preview_url).find(Boolean);
    const video = (m.attachments?.data ?? []).some(a => a.video_data || /video/i.test(a.type ?? ""));
    for (const link of links) {
      const clean = link.replace(/[?#].*$/, "").replace(/\/$/, "");
      const instagram = /instagram\.com/i.test(clean);
      const code = /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i.exec(clean)?.[1];
      out.push({ network: instagram ? "instagram" : "facebook", id: code ? `ig-${code}` : `link-${clean.replace(/^https?:\/\/(?:www\.|m\.|web\.)?/i, "").slice(0, 160)}`,
        author: m.from.name ?? null, permalink: instagram ? `${clean}/` : clean, text: (m.message ?? "").replace(/https?:\/\/\S+/g, "").replace(/[ \t]+\n/g, "\n").trim(),
        createdMs: Date.parse(m.created_time ?? "") || 0, images: picture ? [picture] : [],
        media: instagram && /\/(?:reel|reels|tv)\//i.test(clean) || video ? "video" : "none", via: "messenger" });
    }
  }
  return out;
}

type IgMedia = { id: string; caption?: string; media_type?: string; media_url?: string; permalink?: string; username?: string; timestamp?: string;
  children?: { data?: Array<{ media_type?: string; media_url?: string }> } };
const IG_FIELDS = "id,caption,media_type,media_url,permalink,username,timestamp,children{media_type,media_url}";

function igPost(m: IgMedia): TaggedPost {
  const children = m.children?.data ?? [];
  const photos = m.media_type === "CAROUSEL_ALBUM" ? children.filter(c => c.media_type === "IMAGE" && c.media_url).map(c => c.media_url!)
    : m.media_type === "IMAGE" && m.media_url ? [m.media_url] : [];
  const media = m.media_type === "CAROUSEL_ALBUM" ? (photos.length === children.length && photos.length ? "carousel" : "video")
    : m.media_type === "IMAGE" ? "image" : "video";
  return { network: "instagram", id: m.id, author: m.username ?? null, permalink: m.permalink ?? null, text: m.caption ?? "",
    createdMs: Date.parse(m.timestamp ?? "") || 0, images: photos, media };
}

/** Instagram posts that tag Hjerterum in the photo (/tags). */
export async function taggedOnInstagram(fetcher: Fetcher, account: { igUserId: string; token: string }, limit = 25): Promise<TaggedPost[]> {
  const data = await graph<{ data?: IgMedia[] }>(fetcher, "GET", `/${account.igUserId}/tags`, { fields: IG_FIELDS, limit: String(limit), access_token: account.token });
  return (data.data ?? []).map(igPost);
}

/** One Instagram post as it is now (fresh picture addresses), for passing it on. */
export async function instagramMedia(fetcher: Fetcher, token: string, id: string): Promise<TaggedPost> {
  return igPost(await graph<IgMedia>(fetcher, "GET", `/${id}`, { fields: IG_FIELDS, access_token: token }));
}

/** Reported (the chair, 5 Nov 2026): "Fejlede Deling fra kunet_menneske - meta_400: Unsupported get request. Object with ID '…' does not exist, cannot be
 * loaded due to missing permissions" - another account's post cannot be read by its id; it can through Hjerterum's own list of tags. The pictures' fresh
 * addresses: by the id, else from the tags, else those Saga kept when she found it. */
export async function freshInstagramImages(fetcher: Fetcher, account: { igUserId: string; token: string }, id: string, kept: string[]): Promise<string[]> {
  const byId = await instagramMedia(fetcher, account.token, id).then(p => p.images, () => [] as string[]);
  if (byId.length) return byId;
  const tagged = await taggedOnInstagram(fetcher, account, 50).then(list => list.find(p => p.id === id)?.images ?? [], () => [] as string[]);
  return tagged.length ? tagged : kept;
}

// ---- Posting ----

/** A post on the page: words and, when given, a link (Facebook shows the linked page or post as a card). */
export async function postToPage(fetcher: Fetcher, page: { id: string; token: string }, post: { message: string; link?: string | null }): Promise<string> {
  const made = await graph<{ id: string }>(fetcher, "POST", `/${page.id}/feed`, { message: post.message, ...(post.link ? { link: post.link } : {}), access_token: page.token });
  return made.id;
}

/** A video post on the page - the event's video, as on Instagram - with the words (and the link in them). Facebook fetches the video from its address. */
export async function postVideoToPage(fetcher: Fetcher, page: { id: string; token: string }, post: { url: string; description: string }): Promise<string> {
  const made = await graph<{ id: string; post_id?: string }>(fetcher, "POST", `/${page.id}/videos`, { file_url: post.url, description: post.description, published: "true", access_token: page.token });
  return made.post_id ?? made.id;
}

/** Asked (the chair, 6 Nov 2026): "Og et lille link til det publicerede opslag hvis muligt" - the address of a post Hjerterum has published. */
export async function permalinkOf(fetcher: Fetcher, token: string, network: "facebook" | "instagram", id: string): Promise<string | null> {
  const data = await graph<{ permalink?: string; permalink_url?: string }>(fetcher, "GET", `/${id}`, { fields: network === "instagram" ? "permalink" : "permalink_url", access_token: token }).catch(() => null);
  const link = data?.permalink ?? data?.permalink_url ?? null;
  return link && /^https:\/\/(?:www\.)?(?:facebook|instagram)\.com\//.test(link) ? link : network === "facebook" ? `https://www.facebook.com/${encodeURIComponent(id)}` : null;
}

/** A photo post on the page - the chair's design from Plakater og opslag - with the words (and the link in them). */
export async function postPhotoToPage(fetcher: Fetcher, page: { id: string; token: string }, post: { url: string; caption: string }): Promise<string> {
  const made = await graph<{ id: string; post_id?: string }>(fetcher, "POST", `/${page.id}/photos`, { url: post.url, caption: post.caption, published: "true", access_token: page.token });
  return made.post_id ?? made.id;
}

/** A photo or a carousel (2-10 photos) on Instagram: the containers first, then published. Instagram reads the photos from their (public) addresses. */
export async function publishToInstagram(fetcher: Fetcher, account: { igUserId: string; token: string }, post: { caption: string; images: string[]; collaborators?: string[] },
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<string> {
  const images = post.images.slice(0, 10);
  if (!images.length) throw new MetaError("instagram_needs_a_photo");
  const token = account.token, me = `/${account.igUserId}`;
  // Requested (Gitta): invite the teacher as "samarbejdspartner" - they are told at once, and the post is shown to their followers too. At most three.
  const invited = (post.collaborators ?? []).slice(0, 3);
  const collaborators = invited.length ? { collaborators: JSON.stringify(invited) } : {};
  let container: string;
  if (images.length === 1) container = (await graph<{ id: string }>(fetcher, "POST", `${me}/media`, { image_url: images[0]!, caption: post.caption, ...collaborators, access_token: token })).id;
  else {
    const children: string[] = [];
    for (const image of images) children.push((await graph<{ id: string }>(fetcher, "POST", `${me}/media`, { image_url: image, is_carousel_item: "true", access_token: token })).id);
    container = (await graph<{ id: string }>(fetcher, "POST", `${me}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: post.caption, ...collaborators, access_token: token })).id;
  }
  // A container is usually ready at once; a carousel can take a moment.
  for (let i = 0; i < 6; i++) {
    const { status_code } = await graph<{ status_code?: string }>(fetcher, "GET", `/${container}`, { fields: "status_code", access_token: token });
    if (!status_code || status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new MetaError(`instagram_container_${status_code.toLowerCase()}`);
    await wait(2000);
  }
  return (await graph<{ id: string }>(fetcher, "POST", `${me}/media_publish`, { creation_id: container, access_token: token })).id;
}

/** Requested: "månedlig indsigt" - the page's followers and the Instagram account's followers and posts, as they are now. Each is null when Meta does not answer it. */
export async function followerCounts(fetcher: Fetcher, page: { id: string; token: string }, instagram: { igUserId: string; token: string } | null): Promise<{ fb: number | null; ig: number | null; igMedia: number | null }> {
  const fb = await graph<{ followers_count?: number; fan_count?: number }>(fetcher, "GET", `/${page.id}`, { fields: "followers_count,fan_count", access_token: page.token })
    .then(d => d.followers_count ?? d.fan_count ?? null).catch(() => null);
  const ig = instagram ? await graph<{ followers_count?: number; media_count?: number }>(fetcher, "GET", `/${instagram.igUserId}`, { fields: "followers_count,media_count", access_token: instagram.token }).catch(() => null) : null;
  return { fb, ig: ig?.followers_count ?? null, igMedia: ig?.media_count ?? null };
}

/** Requested: "Alt der kan automatiseres skal automatiseres" - "Ugens events" as a reel (.github/workflows/ugens-reel.yml makes the video). Instagram fetches
 * the video from its public address and works on it for a while, so a reel goes out in steps over Saga's rounds: the container, its status, the publishing. */
export async function startReel(fetcher: Fetcher, account: { igUserId: string; token: string }, post: { videoUrl: string; caption: string; collaborators?: string[] }): Promise<string> {
  const invited = (post.collaborators ?? []).slice(0, 3);
  return (await graph<{ id: string }>(fetcher, "POST", `/${account.igUserId}/media`, { media_type: "REELS", video_url: post.videoUrl, caption: post.caption, share_to_feed: "true",
    ...(invited.length ? { collaborators: JSON.stringify(invited) } : {}), access_token: account.token })).id;
}
export async function reelStatus(fetcher: Fetcher, token: string, container: string): Promise<string> {
  return (await graph<{ status_code?: string }>(fetcher, "GET", `/${container}`, { fields: "status_code", access_token: token })).status_code ?? "IN_PROGRESS";
}
export async function finishReel(fetcher: Fetcher, account: { igUserId: string; token: string }, container: string): Promise<string> {
  return (await graph<{ id: string }>(fetcher, "POST", `/${account.igUserId}/media_publish`, { creation_id: container, access_token: account.token })).id;
}

/** Requested (the chair, 3 Nov 2026): a tagged post that Hjerterum has already shared is shown "Delt d. <dato>". The page's own recent posts: when each was
 * made, and what it shares or links to (the shared post's id, its address). */
export async function pagePosts(fetcher: Fetcher, page: { id: string; token: string }, limit = 100): Promise<Array<{ createdMs: number; refs: string[] }>> {
  const data = await graph<{ data?: Array<{ created_time?: string; parent_id?: string; permalink_url?: string; message?: string; attachments?: { data?: Array<{ url?: string; target?: { id?: string; url?: string } }> } }> }>(
    fetcher, "GET", `/${page.id}/posts`, { fields: "created_time,parent_id,message,attachments{url,target{id,url}}", limit: String(limit), access_token: page.token });
  return (data.data ?? []).map(p => ({ createdMs: Date.parse(p.created_time ?? "") || 0,
    refs: [p.parent_id, ...(p.attachments?.data ?? []).flatMap(a => [a.url, a.target?.id, a.target?.url]), ...(p.message?.match(/https?:\/\/\S+/g) ?? [])].filter((r): r is string => Boolean(r)) }));
}

/** Hjerterum's own recent Instagram posts: when, and the words (an Instagram share is told by the maker named in them). */
export async function ownInstagramMedia(fetcher: Fetcher, account: { igUserId: string; token: string }, limit = 50): Promise<Array<{ createdMs: number; caption: string }>> {
  const data = await graph<{ data?: Array<{ caption?: string; timestamp?: string }> }>(fetcher, "GET", `/${account.igUserId}/media`, { fields: "caption,timestamp", limit: String(limit), access_token: account.token });
  return (data.data ?? []).map(m => ({ createdMs: Date.parse(m.timestamp ?? "") || 0, caption: m.caption ?? "" }));
}
