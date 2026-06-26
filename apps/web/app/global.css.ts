import { globalStyle } from "@vanilla-extract/css";
import { vars } from "./theme.css";

globalStyle("*", { boxSizing: "border-box" });

globalStyle("html, body", {
  margin: 0,
  padding: 0,
  background: vars.color.bg,
  color: vars.color.text,
  fontFamily: vars.font.body,
  colorScheme: "dark",
});

globalStyle("a", { color: vars.color.accent });
