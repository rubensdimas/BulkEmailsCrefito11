import {
  renderInstitutionalEmailTemplate,
  stripHtmlToText,
} from "./emailTemplateService";

describe("emailTemplateService", () => {
  it("should render institutional header, original body and footer", () => {
    const result = renderInstitutionalEmailTemplate({
      html: "<p>Ola <strong>{{nome}}</strong></p>",
    });

    expect(result.html).toContain("CREFITO11");
    expect(result.html).toContain("<p>Ola <strong>{{nome}}</strong></p>");
    expect(result.html).toContain("Mensagem enviada automaticamente.");
    expect(result.html).not.toContain("cid:");
    expect(result.html).not.toContain('src="assets/');
  });

  it("should generate plain text fallback from final institutional content", () => {
    const result = renderInstitutionalEmailTemplate({
      html: "<p>Primeira linha</p><p>Segunda <strong>linha</strong></p>",
    });

    expect(result.text).toContain("CREFITO-11");
    expect(result.text).toContain("Primeira linha");
    expect(result.text).toContain("Segunda linha");
    expect(result.text).toContain("Mensagem automatica enviada pelo sistema BulkMail Pro");
  });

  it("should sanitize dangerous body HTML while preserving safe formatting", () => {
    const result = renderInstitutionalEmailTemplate({
      html: '<script>alert("x")</script><p onclick="evil()">Texto <b>seguro</b></p>',
    });

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.html).toContain("<p>Texto <b>seguro</b></p>");
  });

  it("should convert basic HTML to text", () => {
    expect(stripHtmlToText("<p>Ola&nbsp;<b>Mundo</b></p>")).toBe("Ola Mundo");
  });
});
