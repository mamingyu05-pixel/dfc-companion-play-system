type AssignmentLog = { orderId: string; toStatus: string; createdAt: Date; reason: string | null };

/** Read-only advice for the current dispatch round, never an acceptance deadline. */
export function dispatchReminder(order: { id: string; status: string; dispatchVersion: number }, log: AssignmentLog | undefined, now: Date) {
  let assignedAt: Date | null = null;
  if (order.status === "ASSIGNED" && log?.orderId === order.id && log.toStatus === "ASSIGNED") {
    try {
      const prefix = "CUSTOMER_SELECTED_DISPATCH:";
      const raw = log.reason ?? "";
      const detail = JSON.parse(raw.startsWith(prefix) ? raw.slice(prefix.length) : raw);
      if (Number.isSafeInteger(order.dispatchVersion) && detail?.dispatchVersion === order.dispatchVersion &&
          Number.isFinite(log.createdAt.getTime()) && log.createdAt.getTime() <= now.getTime()) assignedAt = log.createdAt;
    } catch { /* Legacy logs without a dispatch version have no proven start time. */ }
  }
  const dueAt = assignedAt ? new Date(assignedAt.getTime() + 10 * 60 * 1000) : null;
  return {
    dispatchVersion: order.dispatchVersion,
    assignedAt: assignedAt?.toISOString() ?? null,
    dueAt: dueAt?.toISOString() ?? null,
    due: Boolean(dueAt && now.getTime() >= dueAt.getTime()),
    checkedAt: now.toISOString()
  };
}
