import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        glass: {
          DEFAULT: "var(--glass-bg)",
          strong: "var(--glass-bg-strong)",
          hover: "var(--glass-item-hover)",
          active: "var(--glass-item-active)",
        },
        line: {
          DEFAULT: "var(--glass-border)",
          strong: "var(--glass-border-strong)",
        },
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
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          active: "var(--accent-active)",
          soft: "var(--accent-soft)",
          seg: "var(--accent-seg)",
          fg: "var(--accent-fg)",
        },
        success: "var(--success)",
        "success-bg": "var(--success-bg)",
        warning: "var(--warning)",
        "warning-bg": "var(--warning-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          "Geist",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        xs: ["11px", "1.3"],
        sm: ["12px", "1.4"],
        base: ["13px", "1.5"],
        md: ["15px", "1.4"],
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
        panel: "var(--radius-panel)",
        card: "var(--radius-card)",
        item: "var(--radius-item)",
        thumb: "var(--radius-thumb)",
        pill: "var(--radius-pill)",
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "10px",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "220ms",
        slow: "320ms",
        150: "150ms",
        300: "300ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.32, 0.72, 0, 1)",
        workflow: "ease",
      },
      backdropBlur: {
        glass: "28px",
      },
      zIndex: {
        dock: "20",
        edge: "30",
        sidebar: "40",
        chrome: "50",
        popover: "60",
        modal: "80",
      },
    },
  },
  plugins: [],
};

export default config;
