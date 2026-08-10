import { Express, RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const isProduction = process.env.NODE_ENV === 'production';

export const configureSecurity = (app: Express): void => {
  app.disable('x-powered-by');
  if (isProduction) app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: false,
  }));

  const allowedOrigin = process.env.APP_ORIGIN;
  app.use(cors({
    origin: allowedOrigin || (isProduction ? false : true),
    credentials: Boolean(allowedOrigin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }));

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }));
};

const limiter = (limit: number): RequestHandler => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

export const uploadLimiter = limiter(20);
export const sendLimiter = limiter(30);
export const configLimiter = limiter(30);
export const webhookLimiter = limiter(600);
