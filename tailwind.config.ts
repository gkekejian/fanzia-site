import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          black: "#000000",
          ink: "#0a0a0a",
          coal: "#141414",
          smoke: "#1f1f1f",
          red: "#F13737",
          rose: "#BF1313",
          cream: "#f5f5f5",
          chalk: "#e9e9e9",
        },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-anton)", "Impact", "Arial Black", "sans-serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      container: {
        center: true,
        padding: {
          DEFAULT: "1.25rem",
          md: "2rem",
          lg: "2.5rem",
        },
        screens: {
          sm: "640px",
          md: "768px",
          lg: "1024px",
          xl: "1280px",
          "2xl": "1440px",
        },
      },
      animation: {
        marquee: "marquee 40s linear infinite",
        "marquee-slow": "marquee 60s linear infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
