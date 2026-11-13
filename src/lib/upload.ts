import path from 'node:path';

import type { Request, Response } from 'express';
import multer from 'multer';

import { AppError } from './AppError';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Tipos aceitos hoje (so imagens), com a extensao usada na chave do objeto. */
export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function unsupportedMediaType(): AppError {
  return new AppError(
    'Tipo de arquivo nao permitido',
    415,
    [{ field: 'file', message: `Tipos aceitos: ${Object.keys(EXTENSIONS).join(', ')}` }],
    'UNSUPPORTED_MEDIA_TYPE',
  );
}

function createParser(maxFiles: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: maxFiles },
    fileFilter(_req, file, callback) {
      if (Object.hasOwn(EXTENSIONS, file.mimetype)) callback(null, true);
      else callback(unsupportedMediaType());
    },
  });
}

const singleParser = createParser(1).single('file');

/** Multer entrega o nome em latin1; reinterpreta como UTF-8 e descarta qualquer caminho. */
export function sanitizeFileName(originalName: string): string {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  return path.posix.basename(decoded.replaceAll('\\', '/')).slice(0, 255) || 'arquivo';
}

/** O MIME vem do cliente; confere se os primeiros bytes batem com o tipo declarado. */
function matchesSignature(mimeType: string, buffer: Buffer): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'image/png':
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

/** Traduz os erros do multer para o formato de erro da API. */
function toAppError(error: unknown, otherwise: string): unknown {
  if (!(error instanceof multer.MulterError)) return error;
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new AppError('O arquivo excede o limite de 10 MB', 413, undefined, 'FILE_TOO_LARGE');
  }
  return new AppError(otherwise, 400);
}

/** Le o `multipart/form-data` e devolve o arquivo do campo `file`. */
export function receiveFile(req: Request, res: Response): Promise<Express.Multer.File> {
  return new Promise((resolve, reject) => {
    if (!req.is('multipart/form-data')) {
      reject(new AppError('Envie o arquivo como multipart/form-data', 400));
      return;
    }
    singleParser(req, res, (error: unknown) => {
      if (error) {
        reject(toAppError(error, 'Envie um unico arquivo no campo "file"'));
        return;
      }
      const file = req.file;
      if (!file || file.size === 0) {
        reject(new AppError('Arquivo nao enviado no campo "file"', 400));
      } else if (!matchesSignature(file.mimetype, file.buffer)) {
        reject(unsupportedMediaType());
      } else {
        resolve(file);
      }
    });
  });
}

export interface MultipartForm {
  /** Campos de texto do formulario. */
  fields: Record<string, unknown>;
  files: Express.Multer.File[];
}

/**
 * Le um `multipart/form-data` com ate `maxFiles` imagens no campo `field`,
 * junto com os campos de texto. Cada imagem passa pelas mesmas checagens de
 * tipo, assinatura e tamanho do upload unico.
 */
export function receiveFiles(
  req: Request,
  res: Response,
  field: string,
  maxFiles: number,
): Promise<MultipartForm> {
  return new Promise((resolve, reject) => {
    if (!req.is('multipart/form-data')) {
      reject(new AppError('Envie os dados como multipart/form-data', 400));
      return;
    }
    createParser(maxFiles).array(field, maxFiles)(req, res, (error: unknown) => {
      if (error) {
        reject(toAppError(error, `Envie no maximo ${maxFiles} imagens no campo "${field}"`));
        return;
      }
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.some((file) => file.size === 0)) {
        reject(new AppError(`Arquivo vazio no campo "${field}"`, 400));
      } else if (files.some((file) => !matchesSignature(file.mimetype, file.buffer))) {
        reject(unsupportedMediaType());
      } else {
        resolve({ fields: { ...(req.body as Record<string, unknown> | undefined) }, files });
      }
    });
  });
}
