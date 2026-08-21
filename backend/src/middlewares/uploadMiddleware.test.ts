import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import { handleCsvUploadError, hasValidSpreadsheetSignature } from './uploadMiddleware';

describe('hasValidSpreadsheetSignature', () => {
  const files: string[] = [];

  const temporaryFile = (contents: Buffer): string => {
    const file = path.join(os.tmpdir(), `bulkmail-signature-${Date.now()}-${files.length}`);
    fs.writeFileSync(file, contents);
    files.push(file);
    return file;
  };

  afterEach(() => {
    files.splice(0).forEach((file) => fs.rmSync(file, { force: true }));
  });

  it('accepts ZIP-based XLSX files', () => {
    expect(hasValidSpreadsheetSignature(temporaryFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])))).toBe(true);
  });

  it('rejects files whose extension does not match their content', () => {
    expect(hasValidSpreadsheetSignature(temporaryFile(Buffer.from('not a spreadsheet')))).toBe(false);
  });
});

describe('handleCsvUploadError', () => {
  it('reports the 50 MB CSV limit', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new multer.MulterError('LIMIT_FILE_SIZE');

    handleCsvUploadError(
      error,
      {} as Request,
      { status } as unknown as Response,
      jest.fn() as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: 'Arquivo CSV muito grande. O limite máximo é 50 MB.',
    });
  });
});
