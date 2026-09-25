export type PublicProfile = {
  name: string;
  title: string;
  bio: string;
  topics: string;
  teaching: boolean;
  treatment: boolean;
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
  if (Object.keys(data).some(key => ![...Object.keys(limits), "teaching", "treatment"].includes(key))) throw new Error("invalid_profile");
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof data[key] !== "string" || (data[key] as string).length > limit) throw new Error("invalid_profile");
  }
  if (typeof data.teaching !== "boolean" || typeof data.treatment !== "boolean") throw new Error("invalid_profile");
  return { name: (data.name as string).trim(), title: (data.title as string).trim(), bio: (data.bio as string).trim(), topics: (data.topics as string).trim(), teaching: data.teaching, treatment: data.treatment };
}

export function isCompleteProfile(profile: PublicProfile): boolean {
  return Boolean(profile.name && profile.title && profile.bio && (profile.teaching || profile.treatment));
}
