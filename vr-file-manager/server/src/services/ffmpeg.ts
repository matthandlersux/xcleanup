import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface VideoMeta {
  duration: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  size: number;
}

export async function probeVideo(filePath: string): Promise<VideoMeta> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
  return {
    duration: parseFloat(data.format?.duration ?? '0'),
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    codec: videoStream?.codec_name ?? null,
    size: parseInt(data.format?.size ?? '0'),
  };
}

export async function generateThumbnail(
  inputPath: string,
  timestampSecs: number,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-ss', String(timestampSecs),
    '-i', inputPath,
    '-vframes', '1',
    '-vf', 'scale=-1:1080',
    '-y',
    outputPath,
  ]);
}
