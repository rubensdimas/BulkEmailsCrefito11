import fs from "fs";
import os from "os";
import path from "path";
import {
  renderInstitutionalEmailTemplate,
  resolveCrefito11LogoPath,
  stripHtmlToText,
} from "./emailTemplateService";

describe("emailTemplateService", () => {
  const tempLogoPath = path.join(os.tmpdir(), "crefito11-test-logo.png");

  beforeAll(() => {
    fs.writeFileSync(tempLogoPath, "png");
  });

  afterAll(() => {
    if (fs.existsSync(tempLogoPath)) {
      fs.unlinkSync(tempLogoPath);
    }
  });

  it("should render institutional header, original body and footer", () => {
    const result = renderInstitutionalEmailTemplate({
      html: "<p>Ola <strong>{{nome}}</strong></p>",
      logoPath: tempLogoPath,
    });

    expect(result.html).toContain("CREFITO-11");
    expect(result.html).toContain("<p>Ola <strong>{{nome}}</strong></p>");
    expect(result.html).toContain("Mensagem automatica enviada pelo sistema BulkMail Pro");
    expect(result.html).toContain("cid:crefito11-logo@bulkmail-pro");
    expect(result.html).not.toContain('src="assets/');
  });

  it("should attach the CREFITO11 logo by CID when a logo path is available", () => {
    const result = renderInstitutionalEmailTemplate({
      html: "<p>Conteudo</p>",
      logoPath: tempLogoPath,
    });

    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: "CREFITO 11 - Marca - Pos Completa.png",
        path: tempLogoPath,
        cid: "crefito11-logo@bulkmail-pro",
        contentType: "image/png",
      }),
    ]);
  });

  it("should generate plain text fallback from final institutional content", () => {
    const result = renderInstitutionalEmailTemplate({
      html: "<p>Primeira linha</p><p>Segunda <strong>linha</strong></p>",
      logoPath: tempLogoPath,
    });

    expect(result.text).toContain("CREFITO-11");
    expect(result.text).toContain("Primeira linha");
    expect(result.text).toContain("Segunda linha");
    expect(result.text).toContain("Mensagem automatica enviada pelo sistema BulkMail Pro");
  });

  it("should sanitize dangerous body HTML while preserving safe formatting", () => {
    const result = renderInstitutionalEmailTemplate({
      html: '<script>alert("x")</script><p onclick="evil()">Texto <b>seguro</b></p>',
      logoPath: tempLogoPath,
    });

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.html).toContain("<p>Texto <b>seguro</b></p>");
  });

  it("should resolve an explicit logo path and convert basic HTML to text", () => {
    expect(resolveCrefito11LogoPath(tempLogoPath)).toBe(tempLogoPath);
    expect(stripHtmlToText("<p>Ola&nbsp;<b>Mundo</b></p>")).toBe("Ola Mundo");
  });
});
