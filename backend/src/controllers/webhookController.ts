import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import {
  getConfigService,
  getEmailLogRepository,
  isDatabaseReady,
} from '../services/databaseService';
import {
  isMailgridWebhookPayload,
  toMailgridWebhookUpdate,
} from '../services/mailgridWebhookService';

const tokensMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
};

export const receiveMailgridWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!isDatabaseReady()) {
      res.status(503).json({ status: 'erro', msg: 'Database not available' });
      return;
    }

    const config = await getConfigService().getMailgridConfig();
    const expectedToken = config.webhook_token || '';
    const authorization = req.get('Authorization') || '';

    if (!authorization.startsWith('Bearer ')) {
      res.status(401).json({ status: 'erro', msg: 'Token ausente' });
      return;
    }

    const providedToken = authorization.slice(7).trim();
    if (!expectedToken) {
      res.status(503).json({ status: 'erro', msg: 'Token webhook não configurado' });
      return;
    }
    if (!tokensMatch(providedToken, expectedToken)) {
      res.status(401).json({ status: 'erro', msg: 'Token inválido' });
      return;
    }

    if (!isMailgridWebhookPayload(req.body)) {
      res.status(400).json({ status: 'erro', msg: 'Payload inválido' });
      return;
    }

    const result = await getEmailLogRepository().applyMailgridWebhook(
      req.body.msgid,
      toMailgridWebhookUpdate(req.body)
    );

    if (result === 'not_found') {
      res.status(404).json({ status: 'erro', msg: 'Mensagem não encontrada', msgid: req.body.msgid });
      return;
    }

    res.status(200).json({
      status: 'ok',
      msgid: req.body.msgid,
      ...(result === 'ignored' && { ignored: true }),
    });
  } catch (error) {
    next(error);
  }
};

export default { receiveMailgridWebhook };
