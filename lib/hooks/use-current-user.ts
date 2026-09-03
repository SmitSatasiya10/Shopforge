import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
}

/** Fetches the signed-in user for display (email/logout controls) — not a route guard itself;
 * middleware.ts already redirects/blocks unauthenticated requests before a page can render. */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setUser(data.user ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}
