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

const mailgridEnvironmentKeys = [
  "MAILGRID_HOST",
  "MAILGRID_USER",
  "MAILGRID_PASS",
  "MAILGRID_SENDER",
  "MAILGRID_SENDER_NAME",
] as const;

const originalMailgridEnvironment = Object.fromEntries(
  mailgridEnvironmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof mailgridEnvironmentKeys)[number], string | undefined>;

describe("sendEmail institutional template", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAILGRID_HOST = "smtp.test.invalid";
    process.env.MAILGRID_USER = "sender@test.invalid";
    process.env.MAILGRID_PASS = "test-password";
    process.env.MAILGRID_SENDER = "sender@test.invalid";
    process.env.MAILGRID_SENDER_NAME = "BulkMail Test";
    process.env.CREFITO11_LOGO_URL =
      "https://bulkmail.example.com/api/assets/crefito11-email-logo.png";
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: "mailgrid-1" });
  });

  afterEach(() => {
    for (const key of mailgridEnvironmentKeys) {
      const originalValue = originalMailgridEnvironment[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
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
      expect.objectContaining({ host: "smtp.test.invalid" }),
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
