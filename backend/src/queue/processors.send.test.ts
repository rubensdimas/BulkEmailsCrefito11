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
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: "mailgrid-1" });
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

  it("should use textual institutional header without a CID attachment", async () => {
    await sendEmail({
      to: "dest@example.com",
      subject: "Aviso",
      html: "<p>Conteudo</p>",
    });

    expect((sendViaMailgrid as jest.Mock).mock.calls[0][1].html).toContain("CREFITO11");
    expect((sendViaMailgrid as jest.Mock).mock.calls[0][1].html).not.toContain("cid:");
  });
});
