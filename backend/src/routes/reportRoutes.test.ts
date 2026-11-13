import { PassThrough } from 'stream';
import type { NextFunction, Request, Response, Router } from 'express';
import { createReportRouter } from './reportRoutes';

type Handler = (request: Request, response: Response, next: NextFunction) => Promise<void>;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const handler = (router: Router, method: string, path: string): Handler => {
  const layer = (router as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const mockResponse = () => {
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};

const row = {
  id: '1', msgid: 'm1', email_de: 'from@example.com', email_para: 'to@example.com', status: 'Entregue com sucesso',
  tipo_status: 'Aceita', sender: null, sender_ip: '10.0.0.1', sender_host: 'prd-crefito-8', size: '7 KB',
  delivery_ip: '10.0.0.2', delivery_host: 'mx.example.com', message_id: 'mid', assunto: '=cmd()',
  event_at: new Date('2026-11-12T02:30:00Z'), sent_at: null, collected_at: new Date(), erro: '-550 5.1.1 no such user',
};

const repository = (total = 120) => ({
  query: jest.fn().mockResolvedValue({ rows: [row], total }),
  count: jest.fn().mockResolvedValue(total),
  stream: jest.fn().mockImplementation(async function* () { yield row; }),
  listSenderHosts: jest.fn().mockResolvedValue(['prd-crefito-8']),
});

describe('report routes', () => {
  it('GET / returns pagination with pageSize 50', async () => {
    const repo = repository();
    const response = mockResponse();
    await handler(createReportRouter(() => repo), 'get', '/')({ query: { page: '2', tipoStatus: 'Aceita' } } as unknown as Request,
      response as unknown as Response, jest.fn());
    expect(repo.query).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50, tipoStatus: ['Aceita'] }));
    expect(response.json).toHaveBeenCalledWith({
      success: true, data: [row], pagination: { total: 120, page: 2, pageSize: 50, pages: 3 },
    });
  });

  it('GET / answers 400 with the invalid field', async () => {
    const response = mockResponse();
    await handler(createReportRouter(() => repository()), 'get', '/')({ query: { tipoStatus: 'Nada' } } as unknown as Request,
      response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_filter', field: 'tipoStatus' }));
  });

  it('export.csv returns 422 above limit', async () => {
    const repo = repository(100_001);
    const response = mockResponse();
    await handler(createReportRouter(() => repo), 'get', '/export.csv')({ query: {} } as unknown as Request,
      response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'too_many_rows' }));
    expect(repo.stream).not.toHaveBeenCalled();
  });

  it('export.csv streams São Paulo dates and neutralized formulas', async () => {
    const repo = repository(1);
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const response = Object.assign(sink, { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() });
    await handler(createReportRouter(() => repo), 'get', '/export.csv')({ query: {} } as unknown as Request,
      response as unknown as Response, jest.fn());
    await new Promise((resolve) => sink.on('end', resolve));
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringMatching(/^attachment; filename="relatorio-mailgrid-\d{8}\.csv"$/));
    expect(csv.split('\n')[0]).toContain('data_hora,remetente,destinatario,assunto,resultado');
    expect(csv).toContain('11/11/2026 23:30:00');
    expect(csv).toContain("'=cmd()");
    expect(csv.split('\n')[0].split(',')).toContain('erro');
    expect(csv).toContain("'-550 5.1.1 no such user");
  });

  it('GET /sender-hosts lists known hosts', async () => {
    const response = mockResponse();
    await handler(createReportRouter(() => repository()), 'get', '/sender-hosts')({ query: {} } as unknown as Request,
      response as unknown as Response, jest.fn());
    expect(response.json).toHaveBeenCalledWith({ success: true, data: ['prd-crefito-8'] });
  });
});
