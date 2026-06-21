// 第1層 信頼コア — identifier syntax: `name@region`.
//
// The core only checks SYNTAX. It does not know what a region is, who owns it,
// or whether it is trustworthy (§2-1, §2-2). It just generates and validates the
// shape of an identifier string.
//
//   name   : starts with a letter, then alphanumerics  ([A-Za-z][A-Za-z0-9]*)
//   region : lowercase alphanumerics                    ([a-z0-9]+)

const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const REGION_RE = /^[a-z0-9]+$/;

export interface Identifier {
  readonly name: string;
  readonly region: string;
}

export function isValidName(name: string): boolean {
  return typeof name === "string" && NAME_RE.test(name);
}

export function isValidRegion(region: string): boolean {
  return typeof region === "string" && REGION_RE.test(region);
}

export function isValidIdentifier(id: unknown): id is string {
  return typeof id === "string" && parseIdentifier(id) !== undefined;
}

/** Parse `name@region` into parts, or `undefined` if it is malformed. */
export function parseIdentifier(id: string): Identifier | undefined {
  if (typeof id !== "string") return undefined;
  const at = id.indexOf("@");
  if (at < 0) return undefined;
  if (id.indexOf("@", at + 1) !== -1) return undefined; // exactly one '@'
  const name = id.slice(0, at);
  const region = id.slice(at + 1);
  if (!isValidName(name) || !isValidRegion(region)) return undefined;
  return { name, region };
}

export function formatIdentifier(id: Identifier): string {
  return `${id.name}@${id.region}`;
}
