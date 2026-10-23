export type GuaranteePackage = { id: string; platform: "PC" | "MOBILE"; targetWan: number; price: string; label: string; isActive?: boolean; sortOrder?: number };
export type EvidenceKind = "VAULT_START" | "VAULT_END" | "RECORDING" | "OTHER" | "BLOWN_RUN";
export type GuaranteeProgress = { startWan: number | null; endWan: number | null; gainWan: number | null; reached: boolean; targetWan?: number; blownRuns?: number };
export type OrderEvidenceView = {
  orderId: string; serviceKind: string; targetWan: number | null; baseTargetWan?: number | null; blownBonusWan?: number | null; progress: GuaranteeProgress | null;
  evidence: Array<{ id: string; kind: EvidenceKind; hasImage: boolean; linkUrl: string | null; vaultValueWan: number | null; note: string | null; createdAt: string; uploader: string }>;
};

export const EVIDENCE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const evidenceKindLabel: Record<EvidenceKind, string> = {
  VAULT_START: "开局仓库", VAULT_END: "结束仓库", RECORDING: "录屏", OTHER: "其他凭证", BLOWN_RUN: "炸单"
};
export const platformLabel = (platform: string) => (platform === "MOBILE" ? "手游" : "端游");

// Mirrors the server: vault screenshots only between acceptance and the completion report.
export const canUploadVault = (status: string) => ["ACCEPTED", "IN_PROGRESS"].includes(status);
export const canUploadEvidence = (status: string) => ["ACCEPTED", "IN_PROGRESS", "AWAITING_ACCEPTANCE", "DISPUTED"].includes(status);

export function guaranteeProgressText(targetWan: number | null, progress: GuaranteeProgress | null) {
  if (!targetWan || !progress) return "";
  // Blown runs raise the target; say so, so the higher number never looks like a mistake.
  const blown = progress.blownRuns ? `（含炸单补 ${progress.blownRuns} 次）` : "";
  targetWan = progress.targetWan ?? targetWan;
  if (progress.gainWan === null)
    return `目标净增 ${targetWan} 万${blown}：${progress.startWan === null ? "待上传开局仓库" : `开局 ${progress.startWan} 万`}，${progress.endWan === null ? "待上传结束仓库" : `结束 ${progress.endWan} 万`}`;
  return `开局 ${progress.startWan} 万 → 结束 ${progress.endWan} 万，净增 ${progress.gainWan} / ${targetWan} 万${blown} · ${progress.reached ? "已达标" : "未达标"}`;
}

/** Reads a picked image as a data URL after a client-side size check; the server re-validates it. */
export function readEvidenceImage(file: { size: number; type: string }, read: () => Promise<string>) {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return Promise.reject(new Error("凭证仅支持PNG、JPEG、WebP、GIF图片。"));
  if (file.size > EVIDENCE_IMAGE_MAX_BYTES) return Promise.reject(new Error("凭证图片不能超过2MiB，请压缩后重试。"));
  return read();
}

export function parseVaultWan(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export const GUARANTEE_RULES = [
  "按仓库净增结算：开局、结束各上传一张仓库总价值截图，净增达到档位才报完成",
  "没达标不结算给陪玩：可继续服务，或在验收前提交投诉，由客服裁决退回或结算",
  "炸单补保底：每次炸单由陪玩上传截图记录，保底目标自动增加，可累计",
  "纯手动护航：不交号、不转移物资、不代充三角币、不买卖哈夫币",
  "正常对局仍有风险，平台不承诺零封号；开局后请勿出售或转移仓库物资"
];
