import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AccessError } from "@/modules/access/permissions";
import { detectMediaType } from "@/modules/media/file-validation";
import type { VisualAspect } from "@/modules/ai/visual";

const ENCODE_TIMEOUT_MS = 60_000;

export function videoPixels(aspect: VisualAspect) {
  return aspect === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

function ffmpegBin() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AccessError(400, "Сборка ролика заняла слишком долго."));
    }, ENCODE_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new AccessError(400, "На сервере нет ffmpeg, ролик собрать нельзя."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new AccessError(400, "ffmpeg не собрал MP4 из кадров ChatGPT."));
    });
  });
}

function extensionForFrame(bytes: Uint8Array) {
  const mime = detectMediaType(bytes);
  if (mime === "image/jpeg") {
    return "jpg";
  }
  if (mime === "image/webp") {
    return "webp";
  }
  if (mime === "image/gif") {
    return "gif";
  }
  return "png";
}

export async function encodeSlideshowMp4(input: {
  frames: Uint8Array[];
  seconds: number;
  aspect: VisualAspect;
}): Promise<Uint8Array> {
  if (input.frames.length < 1) {
    throw new AccessError(400, "Для ролика нужен хотя бы один кадр.");
  }
  const { width, height } = videoPixels(input.aspect);
  const duration = Math.max(0.5, input.seconds / input.frames.length);
  const dir = await mkdtemp(join(tmpdir(), "polka-video-"));
  const output = join(dir, "clip.mp4");
  const listPath = join(dir, "list.txt");
  try {
    const lines: string[] = [];
    let lastFile = "";
    for (const [index, frame] of input.frames.entries()) {
      const file = join(dir, `frame-${index}.${extensionForFrame(frame)}`);
      await writeFile(file, frame);
      lastFile = file;
      lines.push(`file '${file.replaceAll("'", "'\\''")}'`);
      lines.push(`duration ${duration.toFixed(3)}`);
    }
    lines.push(`file '${lastFile.replaceAll("'", "'\\''")}'`);
    await writeFile(listPath, `${lines.join("\n")}\n`);
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xF3EEE5,fps=30,format=yuv420p`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      output,
    ]);
    const bytes = await readFile(output);
    if (bytes.byteLength < 32) {
      throw new AccessError(400, "ffmpeg вернул пустой MP4.");
    }
    return new Uint8Array(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
