import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const MONEY_MAX = new Prisma.Decimal("9999999999.99");

// Reject precision that PostgreSQL would otherwise silently round per column.
export function fixedDecimal(
  value: string,
  field: string,
  options: { scale?: number; zero?: boolean; max?: string } = {},
) {
  const scale = options.scale ?? 2;
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^\d+(\.\d+)?$/.test(value)
  ) {
    throw new BadRequestException(`${field} must be a finite decimal string`);
  }
  const result = new Prisma.Decimal(value);
  const max = new Prisma.Decimal(options.max ?? MONEY_MAX);
  if (
    !result.isFinite() ||
    result.decimalPlaces() > scale ||
    result.gt(max) ||
    (options.zero ? result.lt(0) : result.lte(0))
  ) {
    throw new BadRequestException(
      `${field} must ${options.zero ? "be nonnegative" : "be positive"}, have at most ${scale} decimal places and not exceed ${max}`,
    );
  }
  return result;
}

export function money(value: Prisma.Decimal, positive = false) {
  const rounded = value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (
    !rounded.isFinite() ||
    rounded.gt(MONEY_MAX) ||
    (positive ? rounded.lte(0) : rounded.lt(0))
  ) {
    throw new BadRequestException(
      "Calculated amount is outside the supported monetary range",
    );
  }
  return rounded;
}

export function commissionSplit(
  total: Prisma.Decimal,
  rawRate: Prisma.Decimal,
) {
  const rate = fixedDecimal(rawRate.toString(), "commissionRate", {
    scale: 4,
    zero: true,
    max: "1",
  });
  const platformFee = money(total.mul(rate));
  return { platformFee, companionIncome: total.sub(platformFee) };
}
