import type { Config } from "tailwindcss";

// Light theme (direction B) shared by the customer, companion and admin sites.
export const dfcTailwindPreset = {
  content: [],
  theme: {
    extend: {
      colors: {
        dfc: {
          bg: "#F5F6FA",
          surface: "#FFFFFF",
          elevated: "#F8F9FC",
          border: "#E6E8EF",
          text: "#1D2233",
          subtext: "#4B5266",
          muted: "#7A8197",
          blue: "#3B82F6",
          violet: "#7C5CFF",
          gold: "#D97706",
          success: "#15A060",
          warning: "#E07B00",
          danger: "#E5484D"
        },
        brand: { DEFAULT: "#FF6A3D", soft: "#FFF1EC", ink: "#E2552A" }
      },
      borderRadius: {
        dfc: "14px",
        "dfc-control": "10px"
      },
      boxShadow: {
        "dfc-focus": "0 0 0 3px rgba(255, 106, 61, 0.18)",
        "dfc-glow": "0 8px 24px rgba(255, 106, 61, 0.18)",
        card: "0 1px 2px rgba(20, 24, 40, 0.06), 0 8px 24px rgba(20, 24, 40, 0.06)"
      },
      fontFamily: {
        sans: ["PingFang SC", "Microsoft YaHei", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
