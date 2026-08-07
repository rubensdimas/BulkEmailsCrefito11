import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const MAX_ROWS = 100000;

export interface XlsxParseResult {
  success: boolean;
  data: Record<string, unknown>[];
  headers: string[];
  sheetNames: string[];
  fileName: string;
  rowCount: number;
  error?: string;
}

const normalizeCellValue = (value: ExcelJS.CellValue): unknown => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('result' in value) return value.result ?? '';
  if ('text' in value) return value.text;
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  return String(value);
};

export const parseXlsx = async (filePath: string, sheetName?: string): Promise<XlsxParseResult> => {
  const emptyResult = (error: string): XlsxParseResult => ({
    success: false,
    data: [],
    headers: [],
    sheetNames: [],
    fileName: path.basename(filePath),
    rowCount: 0,
    error,
  });

  try {
    if (!fs.existsSync(filePath)) return emptyResult('File not found');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
    if (sheetNames.length === 0) return emptyResult('No sheets found in workbook');

    const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!worksheet) return emptyResult('Requested sheet was not found');

    const rowCount = Math.max(0, worksheet.actualRowCount - 1);
    if (rowCount > MAX_ROWS) {
      return { ...emptyResult(`File exceeds maximum of ${MAX_ROWS} rows (found ${rowCount})`), sheetNames, rowCount };
    }

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    for (let column = 1; column <= worksheet.actualColumnCount; column += 1) {
      const value = normalizeCellValue(headerRow.getCell(column).value);
      headers.push(String(value || `column_${column}`).trim());
    }

    const data: Record<string, unknown>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        const value = normalizeCellValue(row.getCell(index + 1).value);
        if (value !== '') hasValue = true;
        record[header] = value;
      });
      if (hasValue) data.push(record);
    });

    return {
      success: true,
      data,
      headers,
      sheetNames,
      fileName: path.basename(filePath),
      rowCount: data.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return emptyResult(`Failed to parse XLSX: ${message}`);
  }
};

export const getSheetInfo = async (
  filePath: string,
): Promise<{ sheetNames: string[]; totalRows: number[] } | null> => {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    return {
      sheetNames: workbook.worksheets.map((sheet) => sheet.name),
      totalRows: workbook.worksheets.map((sheet) => Math.max(0, sheet.actualRowCount - 1)),
    };
  } catch {
    return null;
  }
};

export const deleteFile = (filePath: string): boolean => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
};

export default { parseXlsx, getSheetInfo, deleteFile };
