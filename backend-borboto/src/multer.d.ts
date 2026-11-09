declare module 'multer' {
  import type { Request, RequestHandler } from 'express';

  interface UploadedFile {
    mimetype: string;
    buffer: Buffer;
  }

  interface Upload {
    single(fieldName: string): RequestHandler;
    fields(fields: { name: string; maxCount: number }[]): RequestHandler;
  }

  interface Multer {
    (options: {
      storage: unknown;
      limits?: { fileSize: number };
      fileFilter?: (
        request: Request,
        file: UploadedFile,
        callback: (error: Error | null, accept?: boolean) => void,
      ) => void;
    }): Upload;
    memoryStorage(): unknown;
  }

  const multer: Multer;
  export default multer;
}