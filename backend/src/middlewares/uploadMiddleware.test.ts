import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasValidSpreadsheetSignature } from './uploadMiddleware';

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
