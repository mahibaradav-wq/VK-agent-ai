import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectMediaType, isVideoMime } from "@/modules/media/file-validation";

const JPEG_TIMEOUT_MS = 20_000;

function ffmpegBin() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function extensionForStill(bytes: Uint8Array) {
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

export async function encodeJpegStill(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg" }> {
  if (detectMediaType(bytes) === "image/jpeg") {
    return { bytes, mimeType: "image/jpeg" };
  }
  const dir = await mkdtemp(join(tmpdir(), "polka-jpeg-"));
  const input = join(dir, `in.${extensionForStill(bytes)}`);
  const output = join(dir, "out.jpg");
  try {
    await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegBin(), ["-y", "-i", input, "-frames:v", "1", "-q:v", "3", output], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("jpeg timeout"));
      }, JPEG_TIMEOUT_MS);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("ffmpeg missing"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error("ffmpeg jpeg failed"));
      });
    });
    const jpeg = await readFile(output);
    if (jpeg.byteLength < 32 || detectMediaType(jpeg) !== "image/jpeg") {
      throw new Error("empty jpeg");
    }
    return { bytes: new Uint8Array(jpeg), mimeType: "image/jpeg" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function jpegForVkWall(file: { bytes: Uint8Array; mimeType: string }) {
  if (isVideoMime(file.mimeType) || file.mimeType === "image/jpeg") {
    return file;
  }
  try {
    return await encodeJpegStill(file.bytes);
  } catch {
    return file;
  }
}
