import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { lockOrder } from "./order-lock";

@Injectable()
export class OrderReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orderId: string, customerId: string, body: { stars?: unknown; comment?: unknown }) {
    if (!Number.isInteger(body.stars) || Number(body.stars) < 1 || Number(body.stars) > 5) {
      throw new BadRequestException("请选择1至5整数星级");
    }
    if (body.comment !== undefined && typeof body.comment !== "string") throw new BadRequestException("评语必须是文字");
    const comment = (body.comment as string | undefined) ?? "";
    if ([...comment].length > 200) throw new BadRequestException("评语不能超过200字");
    try {
      return await this.prisma.$transaction(async tx => {
        await lockOrder(tx, orderId);
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || order.customerId !== customerId || order.status !== "COMPLETED" || !order.verifiedAt || !order.companionId) {
          throw new BadRequestException("仅本单客户可在验收后评价");
        }
        if (await tx.orderReview.findUnique({ where: { orderId } })) throw new BadRequestException("该订单已经评价");
        return tx.orderReview.create({ data: { orderId, stars: Number(body.stars), comment: comment.trim() } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BadRequestException("该订单已经评价");
      throw error;
    }
  }

  list() {
    return this.prisma.orderReview.findMany({ orderBy: { createdAt: "desc" }, include: {
      order: { select: { orderNo: true, customer: { select: { displayName: true } }, companion: { select: { displayName: true } } } }
    } });
  }

  async hide(id: string, actorId: string) {
    return this.prisma.$transaction(async tx => {
      const review = await tx.orderReview.update({ where: { id }, data: { hidden: true } });
      await tx.adminLog.create({ data: { actorId, action: "HIDE_ORDER_REVIEW", entityType: "ORDER_REVIEW", entityId: id, detail: { orderId: review.orderId } } });
      return review;
    });
  }
}
