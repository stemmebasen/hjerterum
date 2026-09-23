import type { SagaDeps, SagaEnv } from "./env.js";

export type InlineButton = { text: string; callback_data: string };

/** Telegram Bot API. The bot token only ever goes to api.telegram.org. */
export function telegramClient(env: SagaEnv, deps: SagaDeps) {
  const token = env.SAGA_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("telegram_not_configured");
  const base = `https://api.telegram.org/bot${token}`;
  async function call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    const response = await deps.fetcher(`${base}/${method}`, body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
    if (!response.ok || !data?.ok) throw new Error(`telegram_${method}_failed: ${data?.description ?? response.status}`);
    return data.result as T;
  }
  const keyboard = (buttons?: InlineButton[][]) => buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
  return {
    sendMessage: (chatId: string, text: string, options: { replyTo?: number; buttons?: InlineButton[][] } = {}) =>
      call<{ message_id: number }>("sendMessage", {
        chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true,
        ...(options.replyTo ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } } : {}),
        ...keyboard(options.buttons)
      }),
    sendDocument: (chatId: string, fileName: string, content: string, caption: string, buttons?: InlineButton[][]) => {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", caption.slice(0, 1024));
      form.set("document", new Blob([content], { type: "text/markdown" }), fileName);
      if (buttons) form.set("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
      return call<{ message_id: number }>("sendDocument", form);
    },
    editMessageReplyMarkup: (chatId: string, messageId: number) =>
      call<unknown>("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    answerCallbackQuery: (id: string, text?: string) =>
      call<unknown>("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }),
    async downloadFile(fileId: string): Promise<ArrayBuffer> {
      const file = await call<{ file_path?: string }>("getFile", { file_id: fileId });
      if (!file.file_path) throw new Error("telegram_file_missing");
      const response = await deps.fetcher(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!response.ok) throw new Error(`telegram_file_download_failed: ${response.status}`);
      return response.arrayBuffer();
    }
  };
}
export type TelegramClient = ReturnType<typeof telegramClient>;

export const approvalButtons = (kind: "post" | "minutes", id: number): InlineButton[][] =>
  [[{ text: "Godkend", callback_data: `approve:${kind}:${id}` }, { text: "Afvis", callback_data: `reject:${kind}:${id}` }]];
