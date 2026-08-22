import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  importEmailStatusCsv,
  mapImportedStatus,
  parseEmailStatusCsv,
} from './emailStatusImportService';

describe('emailStatusImportService', () => {
  const files: string[] = [];

  const csvFile = (contents: string): string => {
    const filePath = path.join(os.tmpdir(), `bulkmail-status-${Date.now()}-${files.length}.csv`);
    fs.writeFileSync(filePath, contents);
    files.push(filePath);
    return filePath;
  };

  afterEach(() => {
    files.splice(0).forEach((file) => fs.rmSync(file, { force: true }));
  });

  it.each([
    ['Entregue', { status: 'delivered', statusCode: 1 }],
    ['SMTP error: 452 mailbox full', { status: 'soft_bounce', statusCode: 2 }],
    ['SMTP error: 550 recipient rejected', { status: 'hard_bounce', statusCode: 0 }],
    ['Connection timed out', { status: 'soft_bounce', statusCode: 2 }],
  ] as const)('maps provider status %s', (value, expected) => {
    expect(mapImportedStatus(value)).toEqual(expected);
  });

  it('parses semicolon CSVs with multiline quoted status messages', async () => {
    const filePath = csvFile([
      '\uFEFFID Mensagem;Assunto;Conta SMTP;De;Para;Data envio;Hora envio;ip/host envio;Data entrega;Hora entrega;Status',
      'msg-1;Assunto;conta;de@example.com;to@example.com;21/08/2026;13:20:45;host;21/08/2026;14:59:36;Entregue',
      'msg-2;Assunto;conta;de@example.com;bounce@example.com;21/08/2026;13:20:45;host;21/08/2026;14:59:36;"SMTP error 550: mailbox unavailable',
      'permanent rejection"',
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath);

    expect(parsed.totalRows).toBe(2);
    expect(parsed.updates).toHaveLength(2);
    expect(parsed.updates[0]).toEqual(expect.objectContaining({ messageId: 'msg-1', status: 'delivered' }));
    expect(parsed.updates[1]).toEqual(expect.objectContaining({
      messageId: 'msg-2',
      status: 'hard_bounce',
      statusMessage: expect.stringContaining('permanent rejection'),
    }));
  });

  it('reports duplicate and invalid rows without creating records', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;14:59:36;Entregue',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;14:59:36;Entregue',
      'msg-2;to@example.com;21/08/2026;invalid;21/08/2026;14:59:36;Entregue',
    ].join('\n'));
    const repository: { applyImportedStatuses: jest.Mock } = {
      applyImportedStatuses: jest.fn().mockResolvedValue({
        updated: 1,
        unchanged: 0,
        ignoredStale: 0,
        notFound: 0,
        otherCampaign: 0,
        recipientMismatch: 0,
      }),
    };

    const result = await importEmailStatusCsv(filePath, 'job-1', repository);

    expect(repository.applyImportedStatuses).toHaveBeenCalledWith('job-1', [
      expect.objectContaining({ messageId: 'msg-1' }),
    ]);
    expect(result).toMatchObject({ totalRows: 3, validRows: 1, duplicateRows: 1, invalidRows: 1, updated: 1 });
  });

  it('rejects a CSV without the provider headers', async () => {
    const filePath = csvFile('ID Mensagem;Para\nmsg-1;to@example.com\n');
    await expect(parseEmailStatusCsv(filePath)).rejects.toThrow('Cabeçalhos obrigatórios ausentes');
  });

  it('keeps the newest valid event when message IDs are duplicated out of order', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;Entregue',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;17:00:00;SMTP error 550 recipient rejected',
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath);

    expect(parsed.duplicateRows).toBe(1);
    expect(parsed.updates).toEqual([
      expect.objectContaining({ messageId: 'msg-1', status: 'delivered', sourceRow: 2 }),
    ]);
  });

  it('does not let an invalid duplicate suppress a later valid row', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;status desconhecido',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;19:00:00;Entregue',
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath);

    expect(parsed).toMatchObject({ totalRows: 2, invalidRows: 1, duplicateRows: 0 });
    expect(parsed.updates).toEqual([expect.objectContaining({ messageId: 'msg-1', status: 'delivered' })]);
  });

  it('requires complete send and event timestamps', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;;21/08/2026;18:00:00;Entregue',
      'msg-2;to@example.com;21/08/2026;13:20:45;;18:00:00;Entregue',
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath);

    expect(parsed).toMatchObject({ totalRows: 2, invalidRows: 2, updates: [] });
  });

  it('enforces the streaming row limit', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;Entregue',
      'msg-2;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;Entregue',
    ].join('\n'));

    await expect(parseEmailStatusCsv(filePath, { maxRows: 1 })).rejects.toThrow('100.000 linhas');
  });

  it('rejects files exceeding the byte limit before parsing', async () => {
    const filePath = csvFile('ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status\n');
    await expect(parseEmailStatusCsv(filePath, { maxBytes: 10 })).rejects.toThrow('50 MB');
  });

  it('bounds invalid row details while preserving the full invalid count', async () => {
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      'msg-1;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;?',
      'msg-2;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;?',
      'msg-3;to@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;?',
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath, { invalidRowNumberLimit: 2 });

    expect(parsed).toMatchObject({
      invalidRows: 3,
      invalidRowNumbers: [2, 3],
      invalidRowNumbersTruncated: true,
    });
  });

  it('parses the Mailgrid model report supplied with the story', async () => {
    const modelPath = path.resolve(__dirname, '../../../assets/relatorio_envios_2026-08-21_162702.csv');

    const parsed = await parseEmailStatusCsv(modelPath);

    expect(parsed).toMatchObject({
      duplicateRows: 0,
      invalidRows: 0,
      invalidRowNumbersTruncated: false,
    });
    expect(parsed.totalRows).toBeGreaterThan(0);
    expect(parsed.updates).toHaveLength(parsed.totalRows);
  });

  it('streams a Mailgrid-compatible report with 3,907 valid rows', async () => {
    const rows = Array.from({ length: 3907 }, (_, index) => (
      `msg-${index + 1};recipient-${index + 1}@example.com;21/08/2026;13:20:45;21/08/2026;18:00:00;Entregue`
    ));
    const filePath = csvFile([
      'ID Mensagem;Para;Data envio;Hora envio;Data entrega;Hora entrega;Status',
      ...rows,
    ].join('\n'));

    const parsed = await parseEmailStatusCsv(filePath);

    expect(parsed).toMatchObject({
      totalRows: 3907,
      duplicateRows: 0,
      invalidRows: 0,
      invalidRowNumbersTruncated: false,
    });
    expect(parsed.updates).toHaveLength(3907);
  });
});
