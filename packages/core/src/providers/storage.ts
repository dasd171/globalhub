import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@globalhub/shared';

export const ALLOWED_UPLOAD_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  'text/csv': { ext: 'csv', magic: (b) => !b.subarray(0, 512).includes(0) },
};

/** Validate declared type, actual content signature and size. SVG/HTML are rejected (XSS vectors). */
export function validateUpload(buf: Buffer, declaredType: string, maxBytes: number): { ext: string } {
  const t = ALLOWED_UPLOAD_TYPES[declaredType];
  if (!t) throw new AppError('VALIDATION_FAILED', `File type ${declaredType} not allowed`);
  if (buf.length === 0) throw new AppError('VALIDATION_FAILED', 'Empty file');
  if (buf.length > maxBytes) throw new AppError('VALIDATION_FAILED', `File exceeds ${maxBytes} bytes`);
  if (!t.magic(buf)) throw new AppError('VALIDATION_FAILED', 'File content does not match its declared type');
  return { ext: t.ext };
}

export interface StorageProvider {
  readonly name: string;
  put(prefix: string, buf: Buffer, contentType: string, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z]{2,5}$/;

export class LocalStorage implements StorageProvider {
  readonly name = 'local';
  private root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  private path(key: string) {
    if (!KEY_RE.test(key)) throw new AppError('BAD_REQUEST', 'Invalid storage key');
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new AppError('BAD_REQUEST', 'Invalid storage key');
    return p;
  }
  async put(prefix: string, buf: Buffer, _ct: string, ext: string) {
    const key = `${prefix}/${randomUUID()}.${ext}`;
    await mkdir(join(this.root, prefix), { recursive: true });
    await writeFile(this.path(key), buf, { mode: 0o640 });
    return key;
  }
  async get(key: string) { return readFile(this.path(key)); }
  async delete(key: string) { await unlink(this.path(key)).catch(() => undefined); }
}

/** S3 / MinIO via the AWS SDK. */
export class S3Storage implements StorageProvider {
  readonly name = 's3';
  private clientP: Promise<{ client: unknown; mod: typeof import('@aws-sdk/client-s3') }>;
  constructor(private opts: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.clientP = import('@aws-sdk/client-s3').then((mod) => ({
      mod,
      client: new mod.S3Client({ region: opts.region, endpoint: opts.endpoint, forcePathStyle: !!opts.endpoint, credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } }),
    }));
  }
  async put(prefix: string, buf: Buffer, contentType: string, ext: string) {
    const { client, mod } = await this.clientP;
    const key = `${prefix}/${randomUUID()}.${ext}`;
    await (client as InstanceType<typeof mod.S3Client>).send(new mod.PutObjectCommand({ Bucket: this.opts.bucket, Key: key, Body: buf, ContentType: contentType }));
    return key;
  }
  async get(key: string) {
    if (!KEY_RE.test(key)) throw new AppError('BAD_REQUEST', 'Invalid storage key');
    const { client, mod } = await this.clientP;
    const r = await (client as InstanceType<typeof mod.S3Client>).send(new mod.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    const { client, mod } = await this.clientP;
    await (client as InstanceType<typeof mod.S3Client>).send(new mod.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
