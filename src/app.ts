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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptionsDelegate));
app.use(loggerMiddleware);

// Local uploaded files (logo/avatar fallback when Cloudinary is unavailable)
app.use('/uploads', express.static(uploadsRoot));

// Routes
app.use('/api', router);

app.use(errorHandlerMiddleware);
