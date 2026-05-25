import { sendEmail } from "./processors";
import { getTransporter, getSenderInfo } from "../config/smtp";
import { isDatabaseReady } from "../services/databaseService";

jest.mock("../config/smtp", () => ({
  getTransporter: jest.fn(),
  getSenderInfo: jest.fn(),
}));

jest.mock("../services/databaseService", () => ({
  isDatabaseReady: jest.fn(),
  getConfigService: jest.fn(),
  getJobRepository: jest.fn(),
  getEmailLogRepository: jest.fn(),
}));

describe("sendEmail institutional template", () => {
  const sendMail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (getSenderInfo as jest.Mock).mockReturnValue({
      email: "sender@example.com",
      name: "CREFITO11",
    });
    (getTransporter as jest.Mock).mockReturnValue({
      sendMail,
    });
    sendMail.mockResolvedValue({ messageId: "message-1" });
  });

  it("should wrap the HTML body with the institutional template before sending", async () => {
    await sendEmail({
      to: "dest@example.com",
      subject: "Aviso",
      html: "<p>Ola {{nome}}</p>",
      variables: { nome: "Maria" },
      campaignId: "campaign-1",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "dest@example.com",
        subject: "Aviso",
        html: expect.stringContaining("CREFITO-11"),
        text: expect.stringContaining("Ola Maria"),
      }),
    );
    expect(sendMail.mock.calls[0][0].html).toContain("<p>Ola Maria</p>");
    expect(sendMail.mock.calls[0][0].html).toContain("Mensagem automatica enviada pelo sistema BulkMail Pro");
  });

  it("should include CID logo attachment when the default asset is available", async () => {
    await sendEmail({
      to: "dest@example.com",
      subject: "Aviso",
      html: "<p>Conteudo</p>",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: "CREFITO 11 - Marca - Pos Completa.png",
            cid: "crefito11-logo@bulkmail-pro",
            contentType: "image/png",
          }),
        ]),
      }),
    );
    expect(sendMail.mock.calls[0][0].html).toContain("cid:crefito11-logo@bulkmail-pro");
    expect(sendMail.mock.calls[0][0].html).not.toContain('src="assets/');
  });
});
