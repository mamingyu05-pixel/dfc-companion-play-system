"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type AuthStatus = "checking" | "allowed";

export function AdminAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) {
      window.location.href = "/admin/";
      return;
    }

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unauthorized");
        }
        const data = (await response.json()) as { user?: { role?: string } };
        if (data.user?.role !== "ADMIN" && data.user?.role !== "SUPER_ADMIN") {
          throw new Error("Forbidden");
        }
        setStatus("allowed");
      })
      .catch(() => {
        localStorage.removeItem("dfc_admin_token");
        localStorage.removeItem("dfc_admin_user");
        window.location.href = "/admin/";
      });
  }, []);

  if (status === "checking") {
    return <div className="admin-panel p-4 text-sm text-dfc-subtext">正在验证管理员身份...</div>;
  }

  return <>{children}</>;
}
