import type { Config } from "tailwindcss";

export const dfcTailwindPreset = {
  theme: {
    extend: {
      colors: {
        dfc: {
          bg: "#080A0F",
          surface: "#11141C",
          elevated: "#181C26",
          border: "#2A3040",
          text: "#F4F7FB",
          subtext: "#AAB3C5",
          muted: "#6E778A",
          blue: "#38BDF8",
          violet: "#8B5CF6",
          gold: "#F5C451",
          success: "#22C55E",
          warning: "#F59E0B",
          danger: "#EF4444"
        }
      },
      borderRadius: {
        dfc: "8px",
        "dfc-control": "6px"
      },
      boxShadow: {
        "dfc-focus": "0 0 0 3px rgba(56, 189, 248, 0.24)",
        "dfc-glow": "0 0 24px rgba(139, 92, 246, 0.22)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  }
} satisfies Config;
