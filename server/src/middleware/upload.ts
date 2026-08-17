import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { AppError } from './errorHandler';
import { getUploadsDir } from '../data/db';

const ALLOWED = ['image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;

export function gameUploadsDir(gameId: string): string {
  return path.join(getUploadsDir(), gameId);
}

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

const MAP_ALLOWED_EXT = ['.kml', '.kmz'];
const MAP_MAX_BYTES = 20 * 1024 * 1024;

export const mapUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAP_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (MAP_ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new AppError(400, 'Only KML or KMZ files are allowed') as unknown as Error);
  },
});
