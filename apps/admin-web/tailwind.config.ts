import type { Config } from "tailwindcss";
import { dfcTailwindPreset } from "../../packages/ui/tailwind-preset";

// Admin uses the light theme (direction B); the shared preset stays dark for the other apps for now.
const config: Config = {
  presets: [dfcTailwindPreset],
  content: ["./app/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
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
          gold: "#D97706",
          success: "#15A060",
          warning: "#E07B00",
          danger: "#E5484D"
        },
        brand: { DEFAULT: "#FF6A3D", soft: "#FFF1EC", ink: "#E2552A" }
      },
      boxShadow: {
        "dfc-focus": "0 0 0 3px rgba(255, 106, 61, 0.18)",
        card: "0 1px 2px rgba(20, 24, 40, 0.06), 0 8px 24px rgba(20, 24, 40, 0.06)"
      },
      fontFamily: {
        sans: ["PingFang SC", "Microsoft YaHei", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
