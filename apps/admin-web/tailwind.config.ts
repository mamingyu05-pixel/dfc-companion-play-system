import type { Config } from "tailwindcss";
import { dfcTailwindPreset } from "../../packages/ui/tailwind-preset";

const config: Config = {
  presets: [dfcTailwindPreset],
  content: ["./app/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  plugins: []
};

export default config;
