"use client";

import { useEffect, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type WalletTransaction = {
  id: string;
  type: string;
  direction: string;
  amount: string;
  balanceAfter: string;
  note?: string | null;
  createdAt: string;
  user: {
    email: string;
    displayName: string;
    role: string;
  };
  operator?: {
    email: string;
    displayName: string;
  } | null;
};

export default function FinancePage() {
  const [rows, setRows] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    void fetch("/api/admin/wallet-transactions", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载财务流水");
        setRows((await response.json()) as WalletTransaction[]);
      })
      .catch(() => setError("无法加载真实财务流水，请确认管理员已登录"));
  }, []);

  return (
    <AdminShell>
      <SectionHeader title="财务流水" desc="真实读取 wallet_transactions，查看充值入账、订单支付、订单结算、提现和管理员调账。" />
      {error ? <div className="mb-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      <DataTable
        columns={["编号", "类型", "对象", "金额", "余额", "操作人", "时间", "状态"]}
        rows={rows.map((item) => [
          item.id,
          item.type,
          <div key={`${item.id}-user`}>
            <div className="font-medium text-dfc-text">{item.user.displayName}</div>
            <div className="mt-1 text-xs text-dfc-subtext">{item.user.email}</div>
          </div>,
          `${item.direction === "CREDIT" ? "+" : "-"}¥${formatMoney(item.amount)}`,
          `¥${formatMoney(item.balanceAfter)}`,
          item.operator?.displayName ?? "系统",
          new Date(item.createdAt).toLocaleString("zh-CN"),
          <StatusBadge key={`${item.id}-status`} tone="success">已记录</StatusBadge>
        ])}
      />
    </AdminShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
