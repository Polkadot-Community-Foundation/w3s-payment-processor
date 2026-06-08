import type { ReactNode } from "react";

/**
 * Render `children` only when `condition` is truthy. Project convention — used
 * instead of inline `{cond && <X/>}` so a falsy non-boolean (0, "") can never
 * leak into the tree as stray text.
 */
export function DisplayIf({ condition, children }: { condition: unknown; children: ReactNode }) {
  return condition ? <>{children}</> : null;
}
