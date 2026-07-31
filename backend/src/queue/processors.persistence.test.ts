import { processEmailJob } from "./processors";
import { getEmailLogRepository, getJobRepository, isDatabaseReady } from "../services/databaseService";
import { sendViaMailgrid } from "../services/mailgridService";

jest.mock("../services/databaseService", () => ({
  getEmailLogRepository: jest.fn(),
  getJobRepository: jest.fn(),
  getConfigService: jest.fn(),
  isDatabaseReady: jest.fn(),
}));
jest.mock("../services/mailgridService", () => ({ sendViaMailgrid: jest.fn() }));

describe("processEmailJob persistence", () => {
  it("stores the Mailgrid message id when the individual send succeeds", async () => {
    const log = { id: "log-1", status: "pending" };
    const emailLogRepo = {
      findByUniqueHash: jest.fn().mockResolvedValue(log),
      update: jest.fn(),
      markAsSent: jest.fn(),
      markAsFailed: jest.fn(),
    };
    (getEmailLogRepository as jest.Mock).mockReturnValue(emailLogRepo);
    (getJobRepository as jest.Mock).mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: "1q2w3e4r5t-ABC" });

    await processEmailJob({
      id: "queue-1",
      data: { to: "recipient@example.com", subject: "Aviso", html: "<p>Conteudo</p>", campaignId: "campaign-1" },
    });

    expect(emailLogRepo.markAsSent).toHaveBeenCalledWith("log-1", "1q2w3e4r5t-ABC");
  });
});
