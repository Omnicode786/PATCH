import { desktopCapturer, nativeImage, screen, type NativeImage } from "electron";
import type { ImageReference, Rectangle } from "@patch/schemas";
import { PatchError } from "@patch/shared";

export type CaptureSession = Readonly<{
  id: string;
  image: ImageReference;
  displayBounds: Rectangle;
}>;

type StoredCapture = Readonly<{ image: NativeImage; displayBounds: Rectangle; scaleFactor: number; createdAt: number }>;
const MAX_RETAINED_CAPTURES = 12;
const RETAINED_CAPTURE_TTL_MS = 15 * 60 * 1000;

export class ScreenCaptureService {
  readonly #captures = new Map<string, StoredCapture>();
  readonly #releaseTimers = new Map<string, NodeJS.Timeout>();

  #prune(): void {
    const expiredBefore = Date.now() - RETAINED_CAPTURE_TTL_MS;
    for (const [id, capture] of this.#captures) if (capture.createdAt < expiredBefore) this.release(id);
    while (this.#captures.size >= MAX_RETAINED_CAPTURES) {
      const oldest = this.#captures.keys().next().value as string | undefined;
      if (!oldest) break;
      this.release(oldest);
    }
  }

  async capture(displayBoundsHint?: Rectangle): Promise<CaptureSession> {
    try {
      this.#prune();
      const point = displayBoundsHint
        ? { x: Math.round(displayBoundsHint.x + displayBoundsHint.width / 2), y: Math.round(displayBoundsHint.y + displayBoundsHint.height / 2) }
        : screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      const targetWidth = Math.max(1, Math.round(display.size.width * display.scaleFactor));
      const targetHeight = Math.max(1, Math.round(display.size.height * display.scaleFactor));
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: targetWidth, height: targetHeight } });
      const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
      if (!source) throw new PatchError("SCREEN_CAPTURE_DENIED", "No capturable display was returned by Windows.");
      const png = source.thumbnail.toPNG();
      const size = source.thumbnail.getSize();
      const id = crypto.randomUUID();
      const displayBounds = { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height };
      this.#captures.set(id, { image: source.thumbnail, displayBounds, scaleFactor: display.scaleFactor, createdAt: Date.now() });
      return {
        id,
        displayBounds,
        image: { mimeType: "image/png", dataBase64: png.toString("base64"), width: size.width, height: size.height, scaleFactor: display.scaleFactor }
      };
    } catch (error: unknown) {
      if (error instanceof PatchError) throw error;
      throw new PatchError("SCREEN_CAPTURE_DENIED", error instanceof Error ? error.message : "Screen capture failed.");
    }
  }

  crop(captureId: string, logicalBounds: Rectangle): ImageReference | undefined {
    const capture = this.#captures.get(captureId);
    if (!capture) return undefined;
    const relative = {
      x: Math.max(0, Math.round((logicalBounds.x - capture.displayBounds.x) * capture.scaleFactor)),
      y: Math.max(0, Math.round((logicalBounds.y - capture.displayBounds.y) * capture.scaleFactor)),
      width: Math.max(1, Math.round(logicalBounds.width * capture.scaleFactor)),
      height: Math.max(1, Math.round(logicalBounds.height * capture.scaleFactor))
    };
    const size = capture.image.getSize();
    relative.width = Math.min(relative.width, Math.max(1, size.width - relative.x));
    relative.height = Math.min(relative.height, Math.max(1, size.height - relative.y));
    const cropped = capture.image.crop(relative);
    const cropSize = cropped.getSize();
    return { mimeType: "image/png", dataBase64: cropped.toPNG().toString("base64"), width: cropSize.width, height: cropSize.height, scaleFactor: capture.scaleFactor };
  }

  get(captureId: string): ImageReference | undefined {
    const capture = this.#captures.get(captureId);
    if (!capture) return undefined;
    const png = capture.image.toPNG();
    const size = capture.image.getSize();
    return { mimeType: "image/png", dataBase64: png.toString("base64"), width: size.width, height: size.height, scaleFactor: capture.scaleFactor };
  }

  release(captureId: string): void {
    const timer = this.#releaseTimers.get(captureId);
    if (timer) clearTimeout(timer);
    this.#releaseTimers.delete(captureId);
    this.#captures.delete(captureId);
  }

  releaseLater(captureId: string, delayMs = RETAINED_CAPTURE_TTL_MS): void {
    const existing = this.#releaseTimers.get(captureId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.release(captureId), Math.max(1, delayMs));
    timer.unref?.();
    this.#releaseTimers.set(captureId, timer);
  }

  clear(): void {
    for (const timer of this.#releaseTimers.values()) clearTimeout(timer);
    this.#releaseTimers.clear();
    this.#captures.clear();
  }
}
