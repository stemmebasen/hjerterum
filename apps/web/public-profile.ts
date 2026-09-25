export type PublicProfile = {
  name: string;
  title: string;
  bio: string;
  topics: string;
  teaching: boolean;
  treatment: boolean;
  publicEmail?: string;
  publicPhone?: string;
  websiteUrl?: string;
  linkLabel?: "Læs mere" | "Book en tid";
};

export type OwnPublicProfile = {
  draft: PublicProfile | null;
  published: PublicProfile | null;
  revision: number;
  canPublish: boolean;
};

export function parsePublicProfile(input: unknown): PublicProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_profile");
  const data = input as Record<string, unknown>;
  const limits = { name: 80, title: 120, bio: 600, topics: 160 };
  if (Object.keys(data).some(key => ![...Object.keys(limits), "teaching", "treatment", "publicEmail", "publicPhone", "websiteUrl", "linkLabel"].includes(key))) throw new Error("invalid_profile");
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof data[key] !== "string" || (data[key] as string).length > limit) throw new Error("invalid_profile");
  }
  if (typeof data.teaching !== "boolean" || typeof data.treatment !== "boolean") throw new Error("invalid_profile");
  const contact: Pick<PublicProfile, "publicEmail" | "publicPhone" | "websiteUrl" | "linkLabel"> = {};
  for (const [key, limit] of Object.entries({ publicEmail: 254, publicPhone: 40, websiteUrl: 512 })) {
    const value = data[key];
    if (value === undefined) continue; // Existing profiles have no contact fields.
    if (typeof value !== "string" || value.length > limit) throw new Error("invalid_profile");
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (key === "publicEmail") {
      if (!/^[^\s@?#%&]+@[^\s@?#%&]+\.[^\s@?#%&]+$/.test(trimmed)) throw new Error("invalid_profile");
      contact.publicEmail = trimmed;
    }
    if (key === "publicPhone") {
      if (!/^\+?[0-9 ()-]+$/.test(trimmed) || trimmed.replace(/\D/g, "").length < 5) throw new Error("invalid_profile");
      contact.publicPhone = trimmed;
    }
    if (key === "websiteUrl") {
      let url: URL;
      try { url = new URL(trimmed); } catch { throw new Error("invalid_profile"); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || /[\s\x00-\x1f]/.test(trimmed)) throw new Error("invalid_profile");
      contact.websiteUrl = url.href;
    }
  }
  if (data.linkLabel !== undefined && !["Læs mere", "Book en tid"].includes(String(data.linkLabel))) throw new Error("invalid_profile");
  if (contact.websiteUrl) contact.linkLabel = data.linkLabel === "Book en tid" ? "Book en tid" : "Læs mere";
  return { ...contact, name: (data.name as string).trim(), title: (data.title as string).trim(), bio: (data.bio as string).trim(), topics: (data.topics as string).trim(), teaching: data.teaching, treatment: data.treatment };
}

export function isCompleteProfile(profile: PublicProfile): boolean {
  return Boolean(profile.name && profile.title && profile.bio && (profile.teaching || profile.treatment));
}
