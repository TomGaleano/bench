"use client";

import { useSearchParams } from "next/navigation";

/**
 * Returns true when the v2 design layout should be shown.
 * Sources, in order:
 *   1. `?v2=1` or `?v2=0` query param (overrides everything)
 *   2. `pilab.v2` cookie set to "1" / "0"
 *   3. `NEXT_PUBLIC_DESIGN_V2` env var ("true" enables)
 *   4. Default: true (v2 is the target — the flag is for safe fallback during rollout)
 */
export function useV2(): boolean {
  const params = useSearchParams();
  const queryValue = params?.get("v2");
  if (queryValue === "1" || queryValue === "true") return true;
  if (queryValue === "0" || queryValue === "false") return false;

  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|; )pilab\.v2=([^;]+)/);
    if (match) {
      if (match[1] === "1") return true;
      if (match[1] === "0") return false;
    }
  }

  if (process.env.NEXT_PUBLIC_DESIGN_V2 === "false") return false;
  return true;
}
