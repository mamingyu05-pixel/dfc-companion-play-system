import { BadRequestException, ConflictException } from "@nestjs/common";
import { GameCode } from "@prisma/client";
import { fixedDecimal } from "../financial-values";

type CustomerOrderInput = {
  mode: string; hours: string; companionId?: string; game?: GameCode;
  expectedTotalAmount?: string; notes?: string; voiceTrialRequested?: boolean;
};

// HTTP bodies are untrusted even when TypeScript declares their shape. Keep business limits in OrdersService.
export function validateCustomerOrderInput(body: CustomerOrderInput, requireCompanion: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("订单内容无效，请刷新后重新选择");
  if (typeof body.mode !== "string" || !body.mode.trim()) throw new BadRequestException("请选择服务模式");
  if ((requireCompanion || body.companionId !== undefined) && (typeof body.companionId !== "string" || !body.companionId.trim())) {
    throw new BadRequestException("请选择有效的陪玩");
  }
  if (body.game !== undefined && !Object.values(GameCode).includes(body.game)) throw new BadRequestException("所选游戏无效，请重新选择");
  try { fixedDecimal(body.hours, "hours"); }
  catch (error) {
    if (error instanceof BadRequestException) throw new BadRequestException("服务时长须为大于零、最多两位小数的有效数字，请重新选择");
    throw error;
  }
  if (body.expectedTotalAmount !== undefined) {
    try { fixedDecimal(body.expectedTotalAmount, "expectedTotalAmount"); }
    catch (error) {
      if (error instanceof BadRequestException) throw new BadRequestException("确认金额无效，请重新获取报价并确认");
      throw error;
    }
  }
  if (body.voiceTrialRequested !== undefined && typeof body.voiceTrialRequested !== "boolean") throw new BadRequestException("试音选项无效，请重新选择");
  if (body.notes !== undefined && typeof body.notes !== "string") throw new BadRequestException("订单备注须为文字，请重新填写");
}

export function validateGuaranteeInput(body: { packageId?: unknown; companionId?: unknown; expectedTotalAmount?: unknown; notes?: unknown }, missingPackage = "请选择保底档位") {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("订单内容无效，请刷新后重新选择");
  if (typeof body.packageId !== "string" || !body.packageId.trim()) throw new BadRequestException(missingPackage);
  if (body.companionId !== undefined && (typeof body.companionId !== "string" || !body.companionId.trim())) throw new BadRequestException("请选择有效的陪玩");
  if (body.expectedTotalAmount !== undefined) {
    try { fixedDecimal(body.expectedTotalAmount as string, "expectedTotalAmount"); }
    catch (error) {
      if (error instanceof BadRequestException) throw new BadRequestException("确认金额无效，请重新获取报价并确认");
      throw error;
    }
  }
  if (body.notes !== undefined && typeof body.notes !== "string") throw new BadRequestException("订单备注须为文字，请重新填写");
}

// Translate known user-facing failures only. Preserve status and the transaction's outcome marker.
// A database/commit/transport failure must never gain NOT_COMMITTED from this presentation boundary.
export async function customerOrderAction<T>(action: () => T | Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (!(error instanceof BadRequestException) && !(error instanceof ConflictException)) throw error;
    const translations: Record<string, string> = {
      "Customer wallet does not exist": "当前客户钱包未就绪，请核对登录账号或联系管理员",
      "Insufficient balance": "可用余额不足，请核对钱包余额或调整服务时长后重新确认",
      "Companion is not listed for selected game or does not exist": "所选陪玩暂不可接此游戏，请刷新后重新选择",
      "Calculated amount is outside the supported monetary range": "订单金额超出支持范围，请调整服务时长或联系管理员",
      "requestId is required (16-96 letters, digits, hyphens or underscores)": "申请编号无效，请刷新核对原申请，不要重复提交",
      "requestId already belongs to a different order request; restore the original request": "申请编号已用于其他订单，请刷新核对原申请，不要重复提交",
      "Order request receipt could not be completed": "订单回执未能确认，请刷新核对原申请，不要重复提交"
    };
    const maximum = /^hours cannot be greater than ([0-9.]+)$/.exec(error.message);
    const message = translations[error.message] ?? (maximum ? `服务时长不能超过 ${maximum[1]} 小时，请重新选择` : undefined);
    if (!message) throw error;
    const previous = error.getResponse();
    const response = { ...(typeof previous === "object" ? previous : {}), statusCode: error.getStatus(), message };
    throw error instanceof ConflictException ? new ConflictException(response) : new BadRequestException(response);
  }
}
