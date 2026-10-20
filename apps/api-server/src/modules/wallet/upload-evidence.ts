import { BadRequestException } from "@nestjs/common";

export const RECHARGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const RECHARGE_DATA_URL_MAX_CHARS = 4 * Math.ceil(RECHARGE_IMAGE_MAX_BYTES / 3) + 32;
export const RECHARGE_JSON_MAX_BYTES = RECHARGE_DATA_URL_MAX_CHARS + 16 * 1024;
export const RECHARGE_IMAGE_SIZE_MESSAGE = "充值凭证图片不能超过2MiB，请压缩或更换图片后重试，也可不附图片提交人工核对。";
export const RECHARGE_IMAGE_FORMAT_MESSAGE = "充值凭证仅支持PNG、JPEG、WebP、GIF图片，请重新选择文件。";

export function validateRechargeScreenshot(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestException(RECHARGE_IMAGE_FORMAT_MESSAGE);
  if (value.length > RECHARGE_DATA_URL_MAX_CHARS) throw new BadRequestException(RECHARGE_IMAGE_SIZE_MESSAGE);
  const screenshot = value.trim();
  if (!screenshot) return undefined;
  if (!screenshot.startsWith("data:")) {
    // Preserve existing externally hosted evidence without fetching it on the server.
    try {
      const url = new URL(screenshot);
      if (screenshot.length <= 2048 && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return screenshot;
    } catch { /* handled by the common format error below */ }
    throw new BadRequestException(RECHARGE_IMAGE_FORMAT_MESSAGE);
  }
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(screenshot);
  if (!match || match[2].length % 4 !== 0) throw new BadRequestException(RECHARGE_IMAGE_FORMAT_MESSAGE);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > RECHARGE_IMAGE_MAX_BYTES) throw new BadRequestException(RECHARGE_IMAGE_SIZE_MESSAGE);
  if (!bytes.length || bytes.toString("base64") !== match[2]) throw new BadRequestException(RECHARGE_IMAGE_FORMAT_MESSAGE);
  const mime = match[1];
  const signatureMatches =
    (mime === "png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "jpeg" && bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mime === "gif" && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) ||
    (mime === "webp" && bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP");
  // Header/MIME consistency only; this is not a full image decoder or content scan.
  if (!signatureMatches) throw new BadRequestException(RECHARGE_IMAGE_FORMAT_MESSAGE);
  return screenshot;
}
