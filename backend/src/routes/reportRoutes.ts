import { pipeline } from 'stream/promises';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { format } from '@fast-csv/format';
import type { MailgridReportRepository } from '../repositories/mailgridReportRepository';
import type { MailgridReportEntry } from '../models/MailgridReport';
import { getMailgridReportRepository } from '../services/databaseService';
import { REPORT_CSV_MAX_ROWS, ReportQueryError, csvSafe, formatSaoPaulo, parseReportQuery } from '../services/reportQuery';

type ReportRepository = Pick<MailgridReportRepository, 'query' | 'count' | 'stream' | 'listSenderHosts'>;

const handle = (operation: (request: Request, response: Response) => Promise<void>) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try { await operation(request, response); }
    catch (error) {
      if (error instanceof ReportQueryError) {
        response.status(400).json({ success: false, error: error.code, field: error.field, message: error.message });
        return;
      }
      next(error);
    }
  };

const csvDate = (date: Date): string => formatSaoPaulo(date).slice(0, 10).split('/').reverse().join('');

export const createReportRouter = (repository: () => ReportRepository = getMailgridReportRepository): Router => {
  const router = Router();

  router.get('/', handle(async (request, response) => {
    const query = parseReportQuery(request.query as Record<string, unknown>, new Date());
    const { rows, total } = await repository().query(query);
    response.json({
      success: true, data: rows,
      pagination: { total, page: query.page, pageSize: query.pageSize, pages: Math.ceil(total / query.pageSize) },
    });
  }));

  router.get('/sender-hosts', handle(async (_request, response) => {
    response.json({ success: true, data: await repository().listSenderHosts() });
  }));

  router.get('/export.csv', handle(async (request, response) => {
    // Paging fields are ignored by count/stream; the export covers every row the filters match.
    const filters = parseReportQuery(request.query as Record<string, unknown>, new Date());
    const repo = repository();
    const total = await repo.count(filters);
    if (total > REPORT_CSV_MAX_ROWS) {
      response.status(422).json({
        success: false, error: 'too_many_rows',
        message: `A exportação está limitada a ${REPORT_CSV_MAX_ROWS.toLocaleString('pt-BR')} linhas. Refine os filtros.`,
      });
      return;
    }
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="relatorio-mailgrid-${csvDate(new Date())}.csv"`);
    const toCsvRows = async function* (rows: AsyncIterable<MailgridReportEntry>) {
      for await (const row of rows) {
        yield {
          data_hora: formatSaoPaulo(row.event_at), remetente: csvSafe(row.email_de), destinatario: csvSafe(row.email_para),
          assunto: csvSafe(row.assunto), resultado: csvSafe(row.tipo_status), status: csvSafe(row.status),
          servidor_origem: csvSafe(row.sender_host), ip_origem: csvSafe(row.sender_ip),
          servidor_destino: csvSafe(row.delivery_host), ip_destino: csvSafe(row.delivery_ip), tamanho: csvSafe(row.size),
          msgid: csvSafe(row.msgid), message_id: csvSafe(row.message_id), erro: csvSafe(row.erro),
        };
      }
    };
    try {
      // pipeline handles backpressure and, on client abort or failure, closes the DB stream so the pool connection is freed.
      await pipeline(repo.stream(filters, REPORT_CSV_MAX_ROWS), toCsvRows, format({ headers: true }), response);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return; // client cancelled the download
      // Headers are already sent: a JSON error is impossible, so cut the download instead of handing it to next().
      console.error('Error in report CSV export:', error);
      response.destroy(error as Error);
    }
  }));

  return router;
};

export default createReportRouter();
