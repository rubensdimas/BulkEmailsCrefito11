import { MailgridError, sendViaMailgrid } from "./mailgridService";

const config = {
  host: "smtp.mailgrid.net.br",
  user: "user@mailgrid.net.br",
  pass: "secret",
  from_address: "sender@example.com",
  from_name: "BulkMail Pro",
};

const input = {
  to: "recipient@example.com",
  subject: "Aviso",
  html: "<p>Conteudo</p>",
  text: "Conteudo",
  from: "sender@example.com",
};

describe("sendViaMailgrid", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("maps a successful response id to the provider message id", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ codigo: "200", id: "1q2w3e4r5t-ABC" }]), { status: 200 }),
    );

    await expect(sendViaMailgrid(config, input)).resolves.toEqual({ messageId: "1q2w3e4r5t-ABC" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mailgrid.net.br/sendmail/",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      emailDestino: ["recipient@example.com"],
      host_smtp: "smtp.mailgrid.net.br",
      usuario_smtp: "user@mailgrid.net.br",
    });
  });

  it("classifies Mailgrid code 204 as retryable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ codigo: "204", status: "ERRO DE ENVIO" }]), { status: 200 }),
    );

    await expect(sendViaMailgrid(config, input)).rejects.toMatchObject<Partial<MailgridError>>({
      code: "204",
      retryable: true,
    });
  });
});
