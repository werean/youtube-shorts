export type ClassNameToken = string | false | null | undefined;

export function cn(...tokens: ClassNameToken[]): string {
  return tokens.filter(Boolean).join(" ");
}
