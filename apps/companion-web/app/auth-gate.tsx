"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type AuthStatus = "checking" | "allowed";

export function CompanionAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
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
        if (data.user?.role !== "COMPANION") {
          throw new Error("Forbidden");
        }
        setStatus("allowed");
      })
      .catch(() => {
        localStorage.removeItem("dfc_companion_token");
        localStorage.removeItem("dfc_companion_user");
        window.location.href = "/companion/";
      });
  }, []);

  if (status === "checking") {
    return <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在验证陪玩身份...</div>;
  }

  return <>{children}</>;
}
