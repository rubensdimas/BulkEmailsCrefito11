import { Router } from 'express';
import { receiveMailgridWebhook } from '../controllers/webhookController';

const router = Router();

router.post('/mailgrid', receiveMailgridWebhook);

export default router;
