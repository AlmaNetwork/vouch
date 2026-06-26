import { style } from "@vanilla-extract/css";
import { vars } from "./theme.css";

export const page = style({
  maxWidth: "820px",
  margin: "0 auto",
  padding: `${vars.space.xl} ${vars.space.lg} 3rem`,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xl,
});

export const title = style({ fontSize: "3.5rem", margin: 0, letterSpacing: "-0.03em" });

export const tagline = style({
  fontSize: "1.15rem",
  lineHeight: 1.6,
  color: vars.color.muted,
  maxWidth: "62ch",
});

export const cta = style({
  display: "inline-block",
  marginTop: vars.space.md,
  padding: "0.75rem 1.25rem",
  borderRadius: vars.radius.md,
  background: `linear-gradient(135deg, ${vars.color.accent}, ${vars.color.accent2})`,
  color: "#06121f",
  fontWeight: 700,
  textDecoration: "none",
  selectors: { "&[data-hovered]": { filter: "brightness(1.08)" } },
});

export const panel = style({
  padding: vars.space.lg,
  background: vars.color.panel,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
});

export const panelHead = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
});

export const h2 = style({ margin: 0, fontSize: "1.2rem" });

export const button = style({
  padding: "0.45rem 0.9rem",
  borderRadius: vars.radius.sm,
  border: "none",
  background: vars.color.accent,
  color: "#06121f",
  fontWeight: 700,
  cursor: "pointer",
  selectors: {
    "&[data-pressed]": { transform: "translateY(1px)" },
    "&[data-focus-visible]": { outline: `2px solid ${vars.color.accent2}`, outlineOffset: "2px" },
  },
});

export const stats = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.md,
  marginTop: vars.space.lg,
});

export const stat = style({
  display: "flex",
  flexDirection: "column",
  padding: "0.5rem 0.85rem",
  background: vars.color.panel2,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.sm,
});

export const statLabel = style({
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: vars.color.muted,
});

export const statValue = style({ fontFamily: vars.font.mono, fontSize: "0.95rem" });

export const error = style({ color: vars.color.error, fontSize: "0.9rem", lineHeight: 1.5 });

export const table = style({
  width: "100%",
  marginTop: vars.space.md,
  borderCollapse: "collapse",
  fontSize: "0.9rem",
});

export const th = style({
  textAlign: "left",
  padding: "0.4rem 0.6rem",
  color: vars.color.muted,
  fontWeight: 600,
  borderBottom: `1px solid ${vars.color.border}`,
});

export const tr = style({
  selectors: { "&[data-hovered]": { background: vars.color.panel2 } },
});

export const td = style({
  padding: "0.4rem 0.6rem",
  fontFamily: vars.font.mono,
  borderBottom: `1px solid ${vars.color.border}`,
});

export const footer = style({
  display: "flex",
  gap: vars.space.lg,
  fontSize: "0.9rem",
  color: vars.color.muted,
});
