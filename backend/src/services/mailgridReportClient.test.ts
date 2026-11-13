import {
  MAILGRID_REPORT_TOKEN_PLACEHOLDER,
  MAILGRID_REPORT_URL,
  MailgridReportError,
  fetchMailgridReport,
  parseReportRows,
  parseSaoPauloDateTime,
  readMailgridReportToken,
  toSaoPauloDateTime,
} from './mailgridReportClient';

// Shape copied from a real /report/ response (2026-11-12), with addresses anonymized.
const realRow = {
  msgid: '1xR8qI-00000006RnI-3lbQ', email_de: 'isencao@example.com', email_para: 'pessoa@example.com',
  data: '11/11/2026', hora: '10:58:28', status: 'Entregue com sucesso', tipo_status: 'Aceita',
  data_envio: '11/11/2026', hora_envio: '10:58:27', sender: 'isencao@example.com', sender_ip: '20.206.67.134',
  sender_host: 'prd-crefito-8', size: '7.29 KB', delivery_ip: '74.125.197.27',
  delivery_host: 'gmail-smtp-in.l.google.com', message_id: 'abc@example.com', assunto: 'Status - Isenção CREFITO',
};
const authFailure = [{ status: 'STATUS: ERRO - FALHA DE AUTENTICACAO', codigo: '207' }];

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const window = { start: new Date('2026-11-12T03:00:00Z'), end: new Date('2026-11-12T05:00:00Z') };

describe('mailgridReportClient', () => {
  const originalToken = process.env.TOKEN_AUTH_MAILGRID;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.TOKEN_AUTH_MAILGRID;
    else process.env.TOKEN_AUTH_MAILGRID = originalToken;
  });

  it('parses real rows into entries with -03:00 event_at and sent_at', () => {
    const { entries, skipped } = parseReportRows([realRow]);
    expect(skipped).toBe(0);
    expect(entries[0]).toMatchObject({
      msgid: realRow.msgid, email_para: 'pessoa@example.com', tipo_status: 'Aceita', sender_host: 'prd-crefito-8',
      assunto: 'Status - Isenção CREFITO', event_at: new Date('2026-11-11T13:58:28.000Z'),
      sent_at: new Date('2026-11-11T13:58:27.000Z'), raw: realRow,
    });
  });

  it('keeps the SMTP error text of bounces and null for accepted rows', () => {
    const bounce = { ...realRow, tipo_status: 'Hard Bounce', status: 'Erro na entrega',
      erro: 'SMTP error from remote mail server after RCPT TO:<pessoa@example.com>: 550-5.1.1 The email account does not exist' };
    const { entries } = parseReportRows([bounce, realRow, { ...bounce, msgid: 'b2', erro: '  ' }]);
    expect(entries[0].erro).toBe(bounce.erro);
    expect(entries[1].erro).toBeNull();
    expect(entries[2].erro).toBeNull();
  });

  it('23:30 local becomes next-day 02:30Z', () => {
    expect(parseSaoPauloDateTime('11/11/2026', '23:30:00')).toEqual(new Date('2026-11-12T02:30:00.000Z'));
    expect(parseSaoPauloDateTime('31/02/2026', '10:00:00')).toBeNull();
    expect(toSaoPauloDateTime(new Date('2026-11-12T02:30:00Z'))).toEqual({ date: '2026-11-11', time: '23:30' });
  });

  it('skips rows without msgid or with invalid date and counts them', () => {
    const { entries, skipped } = parseReportRows([
      realRow, { ...realRow, msgid: '' }, { ...realRow, msgid: 'x', data: '99/99/2026' }, { ...realRow, email_para: '' },
    ]);
    expect(entries).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('throws auth_failed on the codigo 207 body', () => {
    expect(() => parseReportRows(authFailure)).toThrow(expect.objectContaining({ code: 'auth_failed' }));
    expect(() => parseReportRows([{ status: 'STATUS: ERRO - PERIODO INVALIDO', codigo: '301' }]))
      .toThrow(expect.objectContaining({ code: 'invalid_response', message: expect.stringContaining('301') }));
    expect(() => parseReportRows({ erro: true })).toThrow(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('throws token_not_configured for empty or placeholder token without calling fetch', async () => {
    const fetchMock = jest.fn();
    for (const token of [null, '', MAILGRID_REPORT_TOKEN_PLACEHOLDER]) {
      await expect(fetchMailgridReport(window, { token, fetch: fetchMock })).rejects
        .toMatchObject({ code: 'token_not_configured' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.TOKEN_AUTH_MAILGRID = MAILGRID_REPORT_TOKEN_PLACEHOLDER;
    expect(readMailgridReportToken()).toBeNull();
    process.env.TOKEN_AUTH_MAILGRID = 'real-token';
    expect(readMailgridReportToken()).toBe('real-token');
  });

  it('retries 3 times on 5xx/network error then throws request_failed; does not retry auth_failed', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const failing = jest.fn()
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(fetchMailgridReport(window, { token: 't', fetch: failing, sleep })).rejects
      .toMatchObject({ code: 'request_failed' });
    expect(failing).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);

    const auth = jest.fn().mockResolvedValue(jsonResponse(authFailure));
    await expect(fetchMailgridReport(window, { token: 't', fetch: auth, sleep })).rejects
      .toBeInstanceOf(MailgridReportError);
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it('sends dataini/horaini/datafim/horafim in São Paulo time', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([realRow]));
    const result = await fetchMailgridReport(window, { token: 'secret', fetch: fetchMock });
    expect(result).toMatchObject({ fetched: 1, skipped: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(MAILGRID_REPORT_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      token_auth: 'secret', dataini: '2026-11-12', horaini: '00:00', datafim: '2026-11-12', horafim: '02:00',
    });
  });
});
