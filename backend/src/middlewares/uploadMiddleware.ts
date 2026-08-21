import multer, { FileFilterCallback, StorageEngine } from 'multer';
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure storage
const storage: StorageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext.toLowerCase()}`);
  },
});

// File filter for XLSX files only
const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  // Also allow files with .xlsx extension even if MIME type is different
  const allowedExtensions = ['.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only XLSX files are allowed'));
  }
};

const csvFileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === '.csv') {
    cb(null, true);
  } else {
    cb(new Error('Somente arquivos com extensão .csv são permitidos'));
  }
};

// Create multer upload instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Export middleware for single file upload
export const uploadXlsx = upload.single('file');

export const uploadCsv = multer({
  storage,
  fileFilter: csvFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
}).single('file');

export const hasValidSpreadsheetSignature = (filePath: string): boolean => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const signature = Buffer.alloc(8);
    fs.readSync(descriptor, signature, 0, signature.length, 0);
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
    return isZip;
  } finally {
    fs.closeSync(descriptor);
  }
};

// Error handler for multer errors
export const handleUploadError = (err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 100MB.',
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  next();
};

export const handleCsvUploadError = (err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'Arquivo CSV muito grande. O limite máximo é 50 MB.',
    });
  }
  return handleUploadError(err, _req, res, next);
};
