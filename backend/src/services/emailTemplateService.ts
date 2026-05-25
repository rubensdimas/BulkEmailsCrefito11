import fs from "fs";
import path from "path";
import type Mail from "nodemailer/lib/mailer";
import { sanitizeHtmlContent } from "./idempotencyService";

const CREFITO11_LOGO_CID = "no-reply@crefito11.gov.br";
const CREFITO11_LOGO_FILE = "CREFITO 11 - Marca - Neg 2 Completa.png";
const CREFITO11_LOGO_RELATIVE_PATH = path.join("logos", CREFITO11_LOGO_FILE);

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
    logoPath?: string;
}

export interface InstitutionalEmailTemplateResult {
    html: string;
    text: string;
    attachments: Mail.Attachment[];
}

const candidateLogoPaths = (explicitPath?: string): string[] => {
    const candidates = [
        explicitPath,
        process.env.CREFITO11_LOGO_PATH,
        path.resolve("/assets", CREFITO11_LOGO_RELATIVE_PATH),
        path.resolve(process.cwd(), "../assets", CREFITO11_LOGO_RELATIVE_PATH),
        path.resolve(process.cwd(), "assets", CREFITO11_LOGO_RELATIVE_PATH),
    ];

    return candidates.filter((candidate): candidate is string =>
        Boolean(candidate),
    );
};

export const resolveCrefito11LogoPath = (
    explicitPath?: string,
): string | null => {
    return (
        candidateLogoPaths(explicitPath).find((candidate) =>
            fs.existsSync(candidate),
        ) || null
    );
};

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

const buildInstitutionalHtml = (bodyHtml: string, logoSrc?: string): string => {
    const logoMarkup = logoSrc
        ? `<img src="${logoSrc}" width="220" alt="CREFITO-11" style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`
        : `<strong style="font-size:22px;line-height:28px;color:#ffffff;">${BRAND.name}</strong>`;

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
    logoPath,
}: InstitutionalEmailTemplateInput): InstitutionalEmailTemplateResult => {
    const sanitizedBody = sanitizeHtmlContent(html);
    const resolvedLogoPath = resolveCrefito11LogoPath(logoPath);
    const logoSrc = resolvedLogoPath ? `cid:${CREFITO11_LOGO_CID}` : undefined;
    const bodyText = text?.trim() || stripHtmlToText(sanitizedBody);

    const attachments: Mail.Attachment[] = resolvedLogoPath
        ? [
              {
                  filename: CREFITO11_LOGO_FILE,
                  path: resolvedLogoPath,
                  cid: CREFITO11_LOGO_CID,
                  contentType: "image/png",
              },
          ]
        : [];

    return {
        html: buildInstitutionalHtml(sanitizedBody, logoSrc),
        text: buildInstitutionalText(bodyText),
        attachments,
    };
};
