import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { AppError } from './errorHandler';

const ALLOWED = ['image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;

export function gameUploadsDir(gameId: string): string {
  return path.join(process.cwd(), 'uploads', gameId);
}

export const uploadsRootDir = path.join(process.cwd(), 'uploads');

export const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const gameId = (req.params as { id?: string }).id ?? 'unknown';
      const dir = gameUploadsDir(gameId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new AppError(400, 'Only JPEG or PNG images are allowed') as unknown as Error);
  },
});
