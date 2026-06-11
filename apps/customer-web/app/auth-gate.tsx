"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type AuthStatus = "checking" | "allowed";

export function CustomerAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/customer/";
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
        if (data.user?.role !== "CUSTOMER") {
          throw new Error("Forbidden");
        }
        setStatus("allowed");
      })
      .catch(() => {
        localStorage.removeItem("dfc_customer_token");
        localStorage.removeItem("dfc_customer_user");
        window.location.href = "/customer/";
      });
  }, []);

  if (status === "checking") {
    return <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在验证客户身份...</div>;
  }

  return <>{children}</>;
}
