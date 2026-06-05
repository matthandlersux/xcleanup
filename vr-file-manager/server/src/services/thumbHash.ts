import { createHash } from 'crypto';

export function computeThumbHash(filename: string, sizeBytes: number): string {
  return createHash('sha256').update(`${filename}:${sizeBytes}`).digest('hex').slice(0, 16);
}
