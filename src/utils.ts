import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { NextFunction, RequestHandler, Request, Response } from 'express';
import { User } from './db/types';
import { Pool } from 'pg';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'node:fs';
import util from 'node:util';
import path from 'node:path';
import { config } from './config/env';

export { config };

// Utils functions
export const asyncWrapper = (fn: RequestHandler) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Logger
export const logger = pino({
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export const loggerMiddleware = pinoHttp({
  logger: logger.child({ category: 'HttpEvent' }),
  genReqId: function (req, res) {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  quietReqLogger: true,
});

export class HttpError extends Error {
  readonly status: number;
  readonly message: string;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.message = message;
  }
}

// Security
export async function generateToken(user: User, pool: Pool): Promise<string> {
  const jti = crypto.randomUUID();

  if (user.role === 'student') {
    await pool.query('UPDATE users SET jti = $1 WHERE id = $2', [jti, user.id]);
  }

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    school_id: user.school_id ?? null,
    jti,
  };

  return jwt.sign(payload, config.SECRET_KEY, {
    expiresIn: '7d',
  });
}

export const verifyToken = (token: string) => jwt.verify(token, config.SECRET_KEY);

// Emails
const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  auth: {
    user: config.SMTP_USER,
    pass: config.SMTP_PASSWORD,
  },
});

export async function sendEmail(to: string, subject: string, html: string) {
  await transporter.sendMail({
    from: 'EM Online Academy',
    to,
    subject,
    html,
  });
}

// Upload
export const uploadsRoot = path.join(process.cwd(), 'uploads');
const avatarsDir = path.join(uploadsRoot, 'avatars');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(avatarsDir, { recursive: true });
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${Date.now()}-${safeName}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req: any, file: any, cb: any) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

const unlinkFile = util.promisify(fs.unlink);

cloudinary.config();

function localUploadUrl(filePath: string) {
  const filename = path.basename(filePath);
  const relDir = path.relative(uploadsRoot, path.dirname(filePath)).replace(/\\/g, '/');
  const folder =
    relDir && !relDir.startsWith('..') && relDir !== '.' ? relDir : 'avatars';
  const apiBase = config.PUBLIC_API_URL.replace(/\/$/, '');
  return `${apiBase}/uploads/${folder}/${filename}`;
}

/**
 * Upload media to Cloudinary. If Cloudinary is unavailable/disabled,
 * keep the local file and return a locally served URL under the same
 * uploads subfolder (avatars/, materials/, …).
 */
export const uploadToCloudinary = async (filePath: string) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'media',
      resource_type: 'auto',
    });
    await unlinkFile(filePath);
    return result;
  } catch (error) {
    logger.warn(
      { err: error, filePath },
      'Cloudinary upload failed; falling back to local storage',
    );
    const local = localUploadUrl(filePath);
    return {
      secure_url: local,
      url: local,
    };
  }
};
