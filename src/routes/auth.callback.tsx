import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Conectando…" }] }),
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // Capture provider_token from URL hash before Supabase strips it
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : "";
      const params = new URLSearchParams(hash);
      const providerToken = params.get("provider_token");
      if (providerToken) {
        try {
          localStorage.setItem("google_provider_token", providerToken);
          localStorage.setItem("google_provider_token_at", String(Date.now()));
        } catch {
          /* ignore */
        }
      }

      // Ensure session is hydrated
      await supabase.auth.getSession();

      const dest = localStorage.getItem("post_auth_redirect") || "/agendamentos";
      localStorage.removeItem("post_auth_redirect");
      navigate({ to: dest, replace: true });
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Conectando sua conta Google…
    </div>
  );
}
