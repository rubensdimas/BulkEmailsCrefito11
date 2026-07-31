import { MailgridConfig } from "../models/SystemConfig";

export const MAILGRID_SEND_URL = "https://api.mailgrid.net.br/sendmail/";

export interface MailgridSendInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
  fromName?: string;
  replyTo?: string;
}

interface MailgridResponseItem {
  status?: string;
  codigo?: string | number;
  id?: string;
  to?: string;
}

export interface MailgridSendResult {
  messageId: string;
}

const readResponseItems = (body: unknown): MailgridResponseItem[] => {
  if (Array.isArray(body)) return body as MailgridResponseItem[];
  if (body && typeof body === "object") return [body as MailgridResponseItem];
  return [];
};

export class MailgridError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export const sendViaMailgrid = async (
  config: MailgridConfig,
  input: MailgridSendInput,
): Promise<MailgridSendResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(MAILGRID_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        host_smtp: config.host,
        usuario_smtp: config.user,
        senha_smtp: config.pass,
        emailRemetente: input.from,
        nomeRemetente: input.fromName,
        emailReply: input.replyTo,
        emailDestino: [input.to],
        assunto: input.subject,
        mensagem: input.html,
        mensagemAlt: input.text,
        mensagemTipo: "html",
        mensagemEncoding: "base64",
      }),
    });

    const rawBody = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new MailgridError(`Mailgrid returned invalid JSON (${response.status})`, undefined, response.status >= 500);
    }

    const item = readResponseItems(body)[0];
    const code = item?.codigo === undefined ? undefined : String(item.codigo);
    if (!response.ok || code !== "200" || !item?.id) {
      const message = item?.status || `Mailgrid send failed (${response.status})`;
      throw new MailgridError(message, code, code === "204" || response.status >= 500);
    }

    return { messageId: item.id };
  } catch (error) {
    if (error instanceof MailgridError) throw error;
    const message = error instanceof Error ? error.message : "Mailgrid request failed";
    throw new MailgridError(message, undefined, true);
  } finally {
    clearTimeout(timeout);
  }
};
