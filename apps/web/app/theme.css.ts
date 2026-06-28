import { createGlobalTheme } from "@vanilla-extract/css";

// Zero-runtime design tokens (vanilla-extract). Referenced as `vars.color.accent`, etc.
export const vars = createGlobalTheme(":root", {
  color: {
    bg: "#0b1020",
    panel: "#121a2e",
    panel2: "#0c1426",
    border: "#243049",
    text: "#e6ecf5",
    muted: "#94a3b8",
    accent: "#5eead4",
    accent2: "#3b82f6",
    error: "#fca5a5",
  },
  font: {
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },
  radius: { sm: "8px", md: "10px", lg: "14px" },
  space: { xs: "0.25rem", sm: "0.5rem", md: "0.75rem", lg: "1.25rem", xl: "2rem" },
});
