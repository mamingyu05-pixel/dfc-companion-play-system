import type { ReactNode } from "react";
import "../styles.css";
// Shared premium look and motion; imported last so it refines the app styles above.
import "@dfc/ui/premium.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
