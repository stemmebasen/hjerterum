import type { SagaDeps, SagaEnv } from "./env.js";

type Word = { text?: string; speaker_id?: string; type?: string };

/** Speaker-labelled lines from ElevenLabs Scribe words: consecutive words of one speaker are one
 * line ("Taler 1: ..."), so the minutes can tell who said what. */
export function speakerTranscript(result: { text?: string; words?: Word[] }): string {
  const words = (result.words ?? []).filter(word => word.type !== "audio_event" && typeof word.text === "string");
  if (!words.some(word => word.speaker_id)) return (result.text ?? "").trim();
  const labels = new Map<string, string>();
  const lines: string[] = [];
  let current = "", buffer = "";
  for (const word of words) {
    const speaker = word.speaker_id ?? current;
    if (speaker !== current && buffer.trim()) { lines.push(`${labels.get(current)}: ${buffer.trim()}`); buffer = ""; }
    if (!labels.has(speaker)) labels.set(speaker, `Taler ${labels.size + 1}`);
    current = speaker;
    buffer += word.text;
  }
  if (buffer.trim()) lines.push(`${labels.get(current)}: ${buffer.trim()}`);
  return lines.join("\n");
}

/** Danish transcription with speakers told apart (ElevenLabs Speech-to-Text). */
export async function transcribe(env: SagaEnv, deps: SagaDeps, audio: ArrayBuffer, fileName: string, mimeType: string): Promise<string> {
  if (!env.ELEVENLABS_API_KEY) throw new Error("transcription_not_configured");
  const form = new FormData();
  form.set("model_id", "scribe_v1");
  form.set("language_code", "dan");
  form.set("diarize", "true");
  form.set("tag_audio_events", "false");
  form.set("file", new Blob([audio], { type: mimeType || "application/octet-stream" }), fileName);
  const response = await deps.fetcher("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, body: form
  });
  const data = await response.json().catch(() => null) as { text?: string; words?: Word[] } | null;
  if (!response.ok || !data) throw new Error(`transcription_failed: ${response.status}`);
  const transcript = speakerTranscript(data);
  if (!transcript) throw new Error("transcription_empty");
  return transcript;
}
