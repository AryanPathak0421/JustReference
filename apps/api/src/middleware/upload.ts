import multer from 'multer';
import sharp from 'sharp';
import { AppError, badRequest } from '../core/errors';

const MB = 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * MB;
export const DOCUMENT_MAX_BYTES = 8 * MB;

/** Single-file upload held in memory (files are small and are re-encoded before storage). */
export const singleFile = (field: string, maxBytes: number) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5 } }).single(field);

/** Identify a file from its first bytes — never trust the extension or the browser's Content-Type. */
export function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | 'pdf' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  return null;
}

/**
 * Decode and re-encode an image to WebP: strips EXIF (GPS, device data), defeats polyglot files,
 * bounds the size, and normalises orientation.
 */
export async function processImage(buf: Buffer, maxSide = 1600): Promise<Buffer> {
  try {
    return await sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw badRequest('That image could not be read. Upload a JPG, PNG or WebP file.', { file: 'Image is damaged or not supported' });
  }
}

export function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw badRequest('Choose a file to upload', { file: 'Choose a file to upload' });
  return file;
}

/** Map multer's errors (e.g. file too large) to friendly API errors. Used by the global error handler. */
export function fromMulterError(err: unknown): AppError | null {
  if (!(err instanceof multer.MulterError)) return null;
  if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'FILE_TOO_LARGE', 'That file is too large', { file: 'That file is too large' });
  return new AppError(400, 'BAD_UPLOAD', 'Upload failed. Send one file in the “file” field.', { file: err.message });
}
