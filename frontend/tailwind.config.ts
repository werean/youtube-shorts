import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          0: "var(--bg-0)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          4: "var(--bg-4)",
        },
        border: {
          1: "var(--border-1)",
          2: "var(--border-2)",
          3: "var(--border-3)",
        },
        text: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
        },
        accent: "var(--accent)",
        "accent-fg": "var(--accent-fg)",
        success: "var(--success)",
        "success-bg": "var(--success-bg)",
        warning: "var(--warning)",
        "warning-bg": "var(--warning-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        label: ["10px", { lineHeight: "1.2", letterSpacing: "0.06em" }],
        caption: ["11px", { lineHeight: "1.2", letterSpacing: "0.06em" }],
        "body-sm": ["12px", { lineHeight: "1.6" }],
        body: ["13px", { lineHeight: "1.6" }],
        "body-md": ["14px", { lineHeight: "1.6" }],
        "heading-sm": ["15px", { lineHeight: "1.2" }],
        heading: ["18px", { lineHeight: "1.2" }],
        display: ["24px", { lineHeight: "1.2" }],
      },
      borderWidth: {
        0.5: "0.5px",
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "10px",
      },
      transitionDuration: {
        150: "150ms",
        300: "300ms",
      },
      transitionTimingFunction: {
        workflow: "ease",
      },
    },
  },
  plugins: [],
};

export default config;
