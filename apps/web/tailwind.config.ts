import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
      },
      boxShadow: {
        panel: "0 24px 80px rgba(6, 24, 24, 0.14)",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(circle at top left, rgba(158,255,220,0.32), transparent 38%), radial-gradient(circle at 85% 15%, rgba(255,184,107,0.2), transparent 22%), linear-gradient(180deg, rgba(255,252,245,1) 0%, rgba(242,248,246,1) 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
