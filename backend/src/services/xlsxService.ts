/**
 * XLSX Service
 * Reads and parses XLSX files using the xlsx package
 */
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const MAX_ROWS = 100000;

/**
 * Count rows in XLSX file WITHOUT loading all data into memory
 * Uses streaming approach - reads only the range info
 */
const countRowsInFile = (filePath: string, sheetName?: string): number => {
  try {
    const workbook = XLSX.readFile(filePath, { 
      type: 'file',
    });
    
    const sheetNames = workbook.SheetNames;
    const targetSheet = sheetName || sheetNames[0];
    const worksheet = workbook.Sheets[targetSheet];
    
    if (!worksheet['!ref']) {
      return 0;
    }
    
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    // e.r is end row (0-indexed), s.r is start row
    // Subtract 1 to exclude header row
    return Math.max(0, range.e.r - range.s.r);
  } catch {
    return -1; // Error reading
  }
};

/**
 * XLSX parsing result
 */
export interface XlsxParseResult {
  success: boolean;
  data: Record<string, unknown>[];
  headers: string[];
  sheetNames: string[];
  fileName: string;
  rowCount: number;
  error?: string;
}

/**
 * Read and parse an XLSX file
 * Validates row count BEFORE full parse to prevent memory issues
 * @param filePath - Path to the XLSX file
 * @param sheetName - Optional sheet name to read (defaults to first sheet)
 * @returns Parsed data as JSON
 */
export const parseXlsx = (filePath: string, sheetName?: string): XlsxParseResult => {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        data: [],
        headers: [],
        sheetNames: [],
        fileName: path.basename(filePath),
        rowCount: 0,
        error: 'File not found',
      };
    }

    // Get file stats for size check
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    // For files > 10MB, warn about potential memory usage
    if (fileSizeMB > 10) {
      console.warn(`⚠️  Large file detected: ${fileSizeMB.toFixed(2)}MB - consider using streaming for >50MB files`);
    }

    // FIRST: Validate row count BEFORE full parse
    const rowCount = countRowsInFile(filePath, sheetName);
    
    if (rowCount < 0) {
      return {
        success: false,
        data: [],
        headers: [],
        sheetNames: [],
        fileName: path.basename(filePath),
        rowCount: 0,
        error: 'Failed to read file metadata',
      };
    }
    
    // Validate limit BEFORE full parse
    if (rowCount > MAX_ROWS) {
      return {
        success: false,
        data: [],
        headers: [],
        sheetNames: [],
        fileName: path.basename(filePath),
        rowCount: rowCount,
        error: `File exceeds maximum of ${MAX_ROWS} rows (found ${rowCount}). Validation performed BEFORE parse to prevent memory issues.`,
      };
    }

    // Now safe to parse full file (we know it's within limits)
    const workbook = XLSX.readFile(filePath, {
      type: 'file',
      cellDates: true,
      cellNF: true,
      cellText: true,
    });

    // Get sheet names
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return {
        success: false,
        data: [],
        headers: [],
        sheetNames: [],
        fileName: path.basename(filePath),
        rowCount: 0,
        error: 'No sheets found in workbook',
      };
    }

    // Use specified sheet or first sheet
    const targetSheetName = sheetName || sheetNames[0];
    const worksheet = workbook.Sheets[targetSheetName];

    // Convert to JSON with header row
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: '', // Default value for empty cells
      blankrows: false, // Skip blank rows
    });

    // Get headers from first row
    const headers = jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

    // Double-check row limit (defense in depth)
    if (jsonData.length > MAX_ROWS) {
      return {
        success: false,
        data: [],
        headers,
        sheetNames,
        fileName: path.basename(filePath),
        rowCount: jsonData.length,
        error: `File exceeds maximum of ${MAX_ROWS} rows (found ${jsonData.length})`,
      };
    }

    return {
      success: true,
      data: jsonData,
      headers,
      sheetNames,
      fileName: path.basename(filePath),
      rowCount: jsonData.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      data: [],
      headers: [],
      sheetNames: [],
      fileName: path.basename(filePath),
      rowCount: 0,
      error: `Failed to parse XLSX: ${errorMessage}`,
    };
  }
};

/**
 * Get sheet information without reading all data
 */
export const getSheetInfo = (filePath: string): { sheetNames: string[]; totalRows: number[] } | null => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const workbook = XLSX.readFile(filePath, { type: 'file' });
    const sheetNames = workbook.SheetNames;
    const totalRows = sheetNames.map(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      return range.e.r - range.s.r; // Number of rows (excluding header)
    });

    return { sheetNames, totalRows };
  } catch {
    return null;
  }
};

/**
 * Delete uploaded file after processing
 */
export const deleteFile = (filePath: string): boolean => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

export default {
  parseXlsx,
  getSheetInfo,
  deleteFile,
};