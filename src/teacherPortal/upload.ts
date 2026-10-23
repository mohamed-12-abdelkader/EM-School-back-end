import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { HttpError, uploadsRoot, uploadToCloudinary } from '../utils';

const materialsDir = path.join(uploadsRoot, 'materials');

const materialStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(materialsDir, { recursive: true });
    cb(null, materialsDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

export const materialUpload = multer({
  storage: materialStorage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/');
    if (ok) cb(null, true);
    else cb(new Error('Only PDF, video, or image files are allowed'));
  },
});

async function localMaterialUrl(filePath: string) {
  const filename = path.basename(filePath);
  const apiBase = (process.env.PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
  return `${apiBase}/uploads/materials/${filename}`;
}

export async function resolveUploadUrl(
  file?: Express.Multer.File | null,
  fallbackUrl?: string,
) {
  if (file) {
    const uploaded = await uploadToCloudinary(file.path);
    let url = uploaded.secure_url || uploaded.url;
    if (
      typeof url === 'string' &&
      url.includes('/uploads/avatars/') &&
      file.path.includes(`${path.sep}materials${path.sep}`)
    ) {
      url = await localMaterialUrl(file.path);
    }
    return { url, filename: file.originalname };
  }
  if (fallbackUrl) return { url: fallbackUrl, filename: null as string | null };
  throw new HttpError(400, 'file or file_url is required');
}

export function inferAttachmentKind(
  file: Express.Multer.File | undefined,
  requested: 'video' | 'pdf',
  fileUrl?: string,
): 'video' | 'pdf' {
  let kind = requested;
  if (file) {
    const isPdf =
      file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    const isVideo = file.mimetype.startsWith('video/');
    if (isPdf) kind = 'pdf';
    else if (isVideo) kind = 'video';
    else if (requested === 'pdf' && !isPdf) {
      throw new HttpError(400, 'File must be a PDF');
    } else if (requested === 'video' && !isVideo) {
      throw new HttpError(400, 'File must be a video');
    }
  } else if (fileUrl && /\.pdf(\?|$)/i.test(fileUrl)) {
    kind = 'pdf';
  }
  return kind;
}
