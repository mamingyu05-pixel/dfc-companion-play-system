export const AUTO_ACCEPTANCE_HOURS = "ORDER_AUTO_ACCEPTANCE_HOURS";

export function acceptanceHours(value?: string | null): number {
  const hours = Number(value);
  return value?.trim() && hours > 0 && Number.isFinite(new Date(Date.now() + hours * 3_600_000).getTime()) ? hours : 48;
}

export function acceptanceDueAt(reportedCompletedAt: Date | null, hours: number): Date | null {
  return reportedCompletedAt ? new Date(reportedCompletedAt.getTime() + hours * 3_600_000) : null;
}
