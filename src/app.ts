import express, { Request } from 'express';
import path from 'path';
import { config, loggerMiddleware, uploadsRoot } from './utils';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import cors, { CorsOptionsDelegate } from 'cors';
import { router } from './routes';

const allowedOrigins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim());
const allowAnyOrigin = allowedOrigins.includes('*');
const isLocalDevOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const requestOrigin = req.header('Origin') || '';
  const isAllowed =
    !requestOrigin ||
    allowAnyOrigin ||
    allowedOrigins.includes(requestOrigin) ||
    (config.NODE_ENV === 'development' && isLocalDevOrigin(requestOrigin));

  callback(null, {
    // With credentials: true the browser needs the exact Origin echoed back (not "*")
    origin: isAllowed ? requestOrigin || true : false,
    credentials: true,
  });
};

export const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptionsDelegate));
app.use(loggerMiddleware);

// Local uploaded files (materials / avatars). Allow embedding PDFs in the teacher UI.
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Help browsers show PDF inline instead of forcing opaque download-only frames
    if (req.path.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
    }
    next();
  },
  express.static(uploadsRoot, {
    setHeaders(res, filePath) {
      if (filePath.toLowerCase().endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
      }
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

// Routes — JSON with UTF-8 so Arabic titles never get mislabeled
app.use('/api', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
});
app.use('/api', router);

app.use(errorHandlerMiddleware);
