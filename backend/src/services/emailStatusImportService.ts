import { stat } from 'node:fs/promises';
import { parseFile } from '@fast-csv/parse';
import type { ImportedEmailStatusUpdate } from '../models/EmailLog';
import type { EmailLogRepository } from '../repositories/emailLogRepository';

const REQUIRED_HEADERS = [
  'ID Mensagem',
  'Para',
  'Data envio',
  'Hora envio',
  'Data entrega',
  'Hora entrega',
  'Status',
] as const;

const CSV_TIMEZONE_OFFSET = process.env.CSV_STATUS_TIMEZONE_OFFSET || '-03:00';
export const STATUS_CSV_MAX_BYTES = 50 * 1024 * 1024;
export const STATUS_CSV_MAX_ROWS = 100_000;
export const INVALID_ROW_NUMBER_LIMIT = 100;

export interface EmailStatusImportSummary {
  totalRows: number;
  validRows: number;
  updated: number;
  unchanged: number;
  ignoredStale: number;
  notFound: number;
  otherCampaign: number;
  recipientMismatch: number;
  duplicateRows: number;
  invalidRows: number;
  invalidRowNumbers: number[];
  invalidRowNumbersTruncated: boolean;
}

export interface EmailStatusCsvLimits {
  maxBytes: number;
  maxRows: number;
  invalidRowNumberLimit: number;
}

export class CsvStatusImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvStatusImportError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const normalizeHeader = (value: string | null | undefined): string => String(value ?? '').trim().replace(/^\uFEFF/, '');
const textValue = (value: unknown): string => String(value ?? '').trim();

const parseDateTime = (dateValue: string, timeValue: string): Date | null => {
  if (!dateValue || !timeValue) return null;
  const dateParts = dateValue.split('/');
  const timeParts = timeValue.split(':');
  if (dateParts.length !== 3 || timeParts.length < 2) return null;

  const [day, month, year] = dateParts.map(Number);
  const [hour, minute, second = 0] = timeParts.map(Number);
  if (![day, month, year, hour, minute, second].every(Number.isFinite)) return null;
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  const parsed = new Date(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      + `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${CSV_TIMEZONE_OFFSET}`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const smtpCode = (message: string): number | null => {
  const match = message.match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
};

const isTemporaryFailure = (message: string): boolean => (
  /timed? ?out|timeout|connection refused|host lookup|retry time|try later|unexpected failure|closed connection/i.test(message)
);

const isPermanentFailure = (message: string): boolean => (
  /mailbox|recipient|account|user unknown|does not exist|disabled|rejected|no such recipient|could not deliver/i.test(message)
);

export const mapImportedStatus = (
  rawStatus: string,
): Pick<ImportedEmailStatusUpdate, 'status' | 'statusCode'> | null => {
  const message = rawStatus.trim();
  if (!message) return null;
  if (message.toLocaleLowerCase('pt-BR') === 'entregue') {
    return { status: 'delivered', statusCode: 1 };
  }

  const code = smtpCode(message);
  if (code && code >= 400 && code < 500) return { status: 'soft_bounce', statusCode: 2 };
  if (code && code >= 500) return { status: 'hard_bounce', statusCode: 0 };
  if (isTemporaryFailure(message)) return { status: 'soft_bounce', statusCode: 2 };
  if (isPermanentFailure(message)) return { status: 'hard_bounce', statusCode: 0 };
  return null;
};

const isNewerDuplicate = (
  existing: ImportedEmailStatusUpdate,
  incoming: ImportedEmailStatusUpdate,
): boolean => {
  const existingTime = existing.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const incomingTime = incoming.eventAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return incomingTime > existingTime || (incomingTime === existingTime && incoming.sourceRow > existing.sourceRow);
};

export const parseEmailStatusCsv = async (
  filePath: string,
  limits: Partial<EmailStatusCsvLimits> = {},
): Promise<{
  totalRows: number;
  updates: ImportedEmailStatusUpdate[];
  duplicateRows: number;
  invalidRows: number;
  invalidRowNumbers: number[];
  invalidRowNumbersTruncated: boolean;
}> => {
  const effectiveLimits: EmailStatusCsvLimits = {
    maxBytes: limits.maxBytes ?? STATUS_CSV_MAX_BYTES,
    maxRows: limits.maxRows ?? STATUS_CSV_MAX_ROWS,
    invalidRowNumberLimit: limits.invalidRowNumberLimit ?? INVALID_ROW_NUMBER_LIMIT,
  };
  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats) throw new CsvStatusImportError('Não foi possível ler o arquivo CSV');
  if (fileStats.size > effectiveLimits.maxBytes) {
    throw new CsvStatusImportError('O arquivo CSV excede o limite de 50 MB');
  }

  const updatesByMessageId = new Map<string, ImportedEmailStatusUpdate>();
  const invalidRowNumbers: number[] = [];
  let invalidRows = 0;
  let duplicateRows = 0;
  let totalRows = 0;

  const registerInvalidRow = (rowNumber: number): void => {
    invalidRows++;
    if (invalidRowNumbers.length < effectiveLimits.invalidRowNumberLimit) invalidRowNumbers.push(rowNumber);
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finishWithError = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof CsvStatusImportError
        ? error
        : new CsvStatusImportError('Não foi possível ler o arquivo CSV'));
    };

    const parser = parseFile<Record<string, string>, Record<string, string>>(filePath, {
      delimiter: ';',
      quote: '"',
      escape: '"',
      ignoreEmpty: true,
      trim: false,
      headers: (headers) => {
        const normalized = headers.map(normalizeHeader);
        const missingHeaders = REQUIRED_HEADERS.filter((header) => !normalized.includes(header));
        if (missingHeaders.length > 0) {
          throw new CsvStatusImportError(`Cabeçalhos obrigatórios ausentes: ${missingHeaders.join(', ')}`);
        }
        return normalized;
      },
    });

    parser.on('error', finishWithError);
    parser.on('data', (row) => {
      if (settled) return;
      totalRows++;
      if (totalRows > effectiveLimits.maxRows) {
        parser.destroy(new CsvStatusImportError('O arquivo CSV excede o limite de 100.000 linhas'));
        return;
      }

      const sourceRow = totalRows + 1;
      const messageId = textValue(row['ID Mensagem']);
      const recipient = textValue(row.Para).toLowerCase();
      const rawStatus = textValue(row.Status);
      const mappedStatus = mapImportedStatus(rawStatus);
      const sentAt = parseDateTime(textValue(row['Data envio']), textValue(row['Hora envio']));
      const eventAt = parseDateTime(textValue(row['Data entrega']), textValue(row['Hora entrega']));

      if (!messageId || !recipient || !mappedStatus || !sentAt || !eventAt) {
        registerInvalidRow(sourceRow);
        return;
      }

      const update: ImportedEmailStatusUpdate = {
        messageId,
        recipient,
        status: mappedStatus.status,
        statusCode: mappedStatus.statusCode,
        statusMessage: rawStatus,
        sentAt,
        eventAt,
        sourceRow,
      };
      const existing = updatesByMessageId.get(messageId);
      if (existing) {
        duplicateRows++;
        if (isNewerDuplicate(existing, update)) updatesByMessageId.set(messageId, update);
      } else {
        updatesByMessageId.set(messageId, update);
      }
    });
    parser.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });

  if (totalRows === 0) throw new CsvStatusImportError('O arquivo CSV não possui linhas de dados');
  return {
    totalRows,
    updates: [...updatesByMessageId.values()],
    duplicateRows,
    invalidRows,
    invalidRowNumbers,
    invalidRowNumbersTruncated: invalidRows > invalidRowNumbers.length,
  };
};

export const importEmailStatusCsv = async (
  filePath: string,
  jobId: string,
  repository: Pick<EmailLogRepository, 'applyImportedStatuses'>,
): Promise<EmailStatusImportSummary> => {
  const parsed = await parseEmailStatusCsv(filePath);
  const applied = await repository.applyImportedStatuses(jobId, parsed.updates);
  return {
    totalRows: parsed.totalRows,
    validRows: parsed.updates.length,
    ...applied,
    duplicateRows: parsed.duplicateRows,
    invalidRows: parsed.invalidRows,
    invalidRowNumbers: parsed.invalidRowNumbers,
    invalidRowNumbersTruncated: parsed.invalidRowNumbersTruncated,
  };
};
