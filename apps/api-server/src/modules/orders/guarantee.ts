import { BadRequestException } from "@nestjs/common";
import { GamePlatform, OrderEvidenceKind } from "@prisma/client";
import { RECHARGE_IMAGE_SIZE_MESSAGE, validateRechargeScreenshot } from "../wallet/upload-evidence";

export const MAX_EVIDENCE_PER_ORDER = 30;
const MAX_VAULT_WAN = 100_000_000;
const PLATFORM_LABEL: Record<GamePlatform, string> = { PC: "端游", MOBILE: "手游" };

export const guaranteeModeLabel = (platform: GamePlatform, targetWan: number) =>
  `保底护航 ${targetWan}W · ${PLATFORM_LABEL[platform]}`;

export type EvidenceInput = {
  kind: OrderEvidenceKind;
  imageUrl?: string;
  linkUrl?: string;
  vaultValueWan?: number;
  note?: string;
};

// Request bodies are untrusted; vault values are whole 万 (10k Haff coin) units as players read them in game.
export function parseEvidenceInput(body: unknown): EvidenceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("凭证内容无效");
  const raw = body as Record<string, unknown>;
  if (typeof raw.kind !== "string" || !Object.values(OrderEvidenceKind).includes(raw.kind as OrderEvidenceKind))
    throw new BadRequestException("请选择凭证类型");
  const kind = raw.kind as OrderEvidenceKind;
  const vault = kind === OrderEvidenceKind.VAULT_START || kind === OrderEvidenceKind.VAULT_END;
  let vaultValueWan: number | undefined;
  if (vault) {
    if (typeof raw.vaultValueWan !== "number" || !Number.isSafeInteger(raw.vaultValueWan) || raw.vaultValueWan < 0 || raw.vaultValueWan > MAX_VAULT_WAN)
      throw new BadRequestException("请填写仓库总价值（万，整数）");
    vaultValueWan = raw.vaultValueWan;
  } else if (raw.vaultValueWan !== undefined && raw.vaultValueWan !== null) {
    throw new BadRequestException("只有仓库截图可以填写仓库价值");
  }
  let imageUrl: string | undefined;
  try { imageUrl = validateRechargeScreenshot(raw.image); }
  catch (error) {
    // Same checks as recharge screenshots; only the user-facing wording differs.
    if (!(error instanceof BadRequestException)) throw error;
    throw new BadRequestException(error.message === RECHARGE_IMAGE_SIZE_MESSAGE ? "凭证图片不能超过2MiB，请压缩后重试。" : "凭证仅支持PNG、JPEG、WebP、GIF图片。");
  }
  let linkUrl: string | undefined;
  if (raw.linkUrl !== undefined && raw.linkUrl !== null && raw.linkUrl !== "") {
    if (typeof raw.linkUrl !== "string" || raw.linkUrl.length > 2048) throw new BadRequestException("录屏链接无效");
    let url: URL;
    try { url = new URL(raw.linkUrl.trim()); } catch { throw new BadRequestException("录屏链接无效"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new BadRequestException("录屏链接无效");
    linkUrl = url.toString();
  }
  if (vault && !imageUrl) throw new BadRequestException("仓库凭证必须附截图");
  if (!imageUrl && !linkUrl) throw new BadRequestException("请附截图或录屏链接");
  if (raw.note !== undefined && raw.note !== null && (typeof raw.note !== "string" || raw.note.length > 200))
    throw new BadRequestException("备注最多200字");
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined;
  return { kind, imageUrl, linkUrl, vaultValueWan, note };
}

export type GuaranteeProgress = { startWan: number | null; endWan: number | null; gainWan: number | null; reached: boolean };

/** Earliest start snapshot against the latest end snapshot; re-uploading the start cannot lower the baseline. */
export function guaranteeProgress(
  targetWan: number,
  evidence: Array<{ kind: OrderEvidenceKind | string; vaultValueWan: number | null; createdAt: Date }>,
): GuaranteeProgress {
  const ordered = [...evidence].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const start = ordered.find(e => e.kind === OrderEvidenceKind.VAULT_START && e.vaultValueWan !== null);
  const end = [...ordered].reverse().find(e => e.kind === OrderEvidenceKind.VAULT_END && e.vaultValueWan !== null);
  if (!start || !end) return { startWan: start?.vaultValueWan ?? null, endWan: end?.vaultValueWan ?? null, gainWan: null, reached: false };
  const gainWan = end.vaultValueWan! - start.vaultValueWan!;
  return { startWan: start.vaultValueWan, endWan: end.vaultValueWan, gainWan, reached: gainWan >= targetWan };
}
