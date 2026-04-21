/**
 * Upload Controller
 * Handles file upload and XLSX processing
 */
import { Request, Response } from 'express';
import xlsxService from '../services/xlsxService';
import emailExtractor from '../services/emailExtractor';
import emailValidator from '../services/emailValidator';

/**
 * Upload response interface
 */
export interface UploadResponse {
  success: boolean;
  message?: string;
  data?: {
    fileName: string;
    totalRows: number;
    headers: string[];
    emailColumnDetected: string;
    totalEmails: number;
    validEmails: number;
    invalidEmails: number;
  };
  emails?: {
    valid: string[];
    invalid: { email: string; error: string }[];
  };
  error?: string;
}

/**
 * Handle XLSX file upload
 * POST /api/upload
 */
export const uploadFile = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded',
      } as UploadResponse);
      return;
    }

    const filePath = req.file.path;

    // Parse XLSX file
    const parseResult = xlsxService.parseXlsx(filePath);

    if (!parseResult.success || parseResult.data.length === 0) {
      // Clean up file on error
      xlsxService.deleteFile(filePath);

      res.status(400).json({
        success: false,
        error: parseResult.error || 'Failed to parse XLSX file',
      } as UploadResponse);
      return;
    }

    // Extract emails from data
    const emails = emailExtractor.extractEmails(parseResult.data, parseResult.headers);

    if (emails.length === 0) {
      // Clean up file
      xlsxService.deleteFile(filePath);

      res.status(400).json({
        success: false,
        error: 'No emails found in the file',
      } as UploadResponse);
      return;
    }

    // Validate and deduplicate emails
    const { valid, invalid } = emailValidator.validateAndDeduplicate(emails);

    // Detect email column
    const emailColumnIndex = emailExtractor.findEmailColumn(parseResult.headers);
    const emailColumnDetected = emailColumnIndex !== -1
      ? parseResult.headers[emailColumnIndex]
      : parseResult.headers[0] || 'unknown';

    // Build response
    const response: UploadResponse = {
      success: true,
      message: 'File processed successfully',
      data: {
        fileName: req.file.originalname,
        totalRows: parseResult.rowCount,
        headers: parseResult.headers,
        emailColumnDetected,
        totalEmails: emails.length,
        validEmails: valid.length,
        invalidEmails: invalid.length,
      },
      emails: {
        valid,
        invalid: invalid.map(v => ({ email: v.email, error: v.error || 'Invalid email format' })),
      },
    };

    // Clean up uploaded file after processing
    xlsxService.deleteFile(filePath);

    res.status(200).json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(500).json({
      success: false,
      error: `Internal server error: ${errorMessage}`,
    } as UploadResponse);
  }
};

export default {
  uploadFile,
};