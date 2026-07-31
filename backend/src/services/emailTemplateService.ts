import { sanitizeHtmlContent } from "./idempotencyService";

const BRAND = {
    name: "CREFITO11",
    fullName:
        "Conselho Regional de Fisioterapia e Terapia Ocupacional da 11ª Regiao",
    primary: "#2E2F71",
    accent: "#FEAB68",
    text: "#1F2933",
    muted: "#5F6C7B",
    background: "#F4F7F6",
};

export interface InstitutionalEmailTemplateInput {
  html: string;
  text?: string;
}

export interface InstitutionalEmailTemplateResult {
  html: string;
  text: string;
}

export const stripHtmlToText = (html: string): string => {
    return html
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "- ")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};

const buildInstitutionalText = (bodyText: string): string => {
    return [
        BRAND.name,
        BRAND.fullName,
        "",
        bodyText,
        "",
        "Mensagem automatica enviada pelo sistema BulkMail Pro do CREFITO-11.",
    ]
        .filter((line) => line !== undefined)
        .join("\n");
};

const buildInstitutionalHtml = (bodyHtml: string): string => {
    const logoMarkup = `<strong style="font-size:22px;line-height:28px;color:#ffffff;">${BRAND.name}</strong>`;

    return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${BRAND.name}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.background};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${BRAND.background};">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;">
            <tr>
              <td style="background:${BRAND.primary};padding:24px 28px;border-bottom:4px solid ${BRAND.accent};">
                ${logoMarkup}
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px;font-size:16px;line-height:24px;color:${BRAND.text};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;background:#F8FAF9;border-top:1px solid #D9E2DE;font-size:12px;line-height:18px;color:${BRAND.muted};">
                <strong style="color:${BRAND.primary};">${BRAND.name}</strong><br>
                ${BRAND.fullName}<br>
                Mensagem enviada automaticamente.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export const renderInstitutionalEmailTemplate = ({
    html,
    text,
}: InstitutionalEmailTemplateInput): InstitutionalEmailTemplateResult => {
    const sanitizedBody = sanitizeHtmlContent(html);
    const bodyText = text?.trim() || stripHtmlToText(sanitizedBody);

    return {
        html: buildInstitutionalHtml(sanitizedBody),
        text: buildInstitutionalText(bodyText),
    };
};
