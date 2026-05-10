/**
 * Upload Routes
 * Defines upload API endpoints
 */
import { Router, Request, Response } from 'express';
import uploadController from '../controllers/uploadController';
import { uploadXlsx, handleUploadError } from '../middlewares/uploadMiddleware';

const router = Router();

/**
 * POST /api/upload
 * Upload XLSX file and process emails
 */
router.post(
  '/',
  (req: Request, res: Response, next) => {
    uploadXlsx(req, res, (err) => {
      if (err) {
        handleUploadError(err, req, res, next);
      } else {
        next();
      }
    });
  },
  uploadController.uploadFile
);

export default router;