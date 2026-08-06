import { sendEmail } from "./processors";
import { isDatabaseReady } from "../services/databaseService";
import { sendViaMailgrid } from "../services/mailgridService";

jest.mock("../services/mailgridService", () => ({ sendViaMailgrid: jest.fn() }));

jest.mock("../services/databaseService", () => ({
  isDatabaseReady: jest.fn(),
  getConfigService: jest.fn(),
  getJobRepository: jest.fn(),
  getEmailLogRepository: jest.fn(),
}));

describe("sendEmail institutional template", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CREFITO11_LOGO_URL =
      "https://bulkmail.example.com/api/assets/crefito11-email-logo.png";
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: "mailgrid-1" });
  });

  afterEach(() => {
    delete process.env.CREFITO11_LOGO_URL;
  });

  it("should wrap the HTML body with the institutional template before sending", async () => {
    await sendEmail({
      to: "dest@example.com",
      subject: "Aviso",
      html: "<p>Ola {{nome}}</p>",
      variables: { nome: "Maria" },
      campaignId: "campaign-1",
    });

    expect(sendViaMailgrid).toHaveBeenCalledWith(
      expect.objectContaining({ host: "" }),
      expect.objectContaining({
        to: "dest@example.com",
        subject: "Aviso",
        html: expect.stringContaining("CREFITO11"),
        text: expect.stringContaining("Ola Maria"),
      }),
    );
    expect((sendViaMailgrid as jest.Mock).mock.calls[0][1].html).toContain("<p>Ola Maria</p>");
    expect((sendViaMailgrid as jest.Mock).mock.calls[0][1].html).toContain("Mensagem enviada automaticamente.");
  });

  it("should use the public institutional logo without a CID attachment", async () => {
    await sendEmail({
      to: "dest@example.com",
      subject: "Aviso",
      html: "<p>Conteudo</p>",
    });

    const sentHtml = (sendViaMailgrid as jest.Mock).mock.calls[0][1].html;
    expect(sentHtml).toContain(
      'src="https://bulkmail.example.com/api/assets/crefito11-email-logo.png"',
    );
    expect(sentHtml).toContain('alt="CREFITO11"');
    expect(sentHtml).not.toContain("cid:");
  });
});
