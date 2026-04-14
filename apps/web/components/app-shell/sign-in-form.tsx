"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Mode = "signin" | "signup";

export function SignInForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demoEmail = process.env.NEXT_PUBLIC_DEMO_USER_EMAIL ?? "demo@swarm.dev";
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_USER_PASSWORD ?? "DemoPass123!";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload =
      mode === "signin"
        ? {
            email: form.get("email"),
            password: form.get("password")
          }
        : {
            email: form.get("email"),
            password: form.get("password"),
            full_name: form.get("full_name"),
            organization_name: form.get("organization_name"),
            workspace_name: form.get("workspace_name")
          };

    const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Unable to sign in." }));
        setError(data.detail ?? "Unable to authenticate.");
        setLoading(false);
        return;
      }

      router.push("/app");
      router.refresh();
    } catch {
      setError("Authentication service is unavailable.");
      setLoading(false);
    }
  }

  return (
    <div className="panel mx-auto w-full max-w-xl p-8">
      <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">
        {mode === "signin" ? "Secure Sign In" : "Create Workspace"}
      </p>
      <h1 className="mt-4 font-display text-5xl">
        {mode === "signin" ? "Enter your swarm workspace." : "Launch a new autonomous workspace."}
      </h1>
      <p className="mt-4 text-sm leading-8 text-black/[0.66]">
        {mode === "signin"
          ? "Authenticate with a session-backed account to access chats, knowledge, automations, and monitoring."
          : "Registration creates an organization, primary workspace, and owner session in one flow."}
      </p>

      <form className="mt-8 space-y-4" onSubmit={onSubmit}>
        {mode === "signup" && (
          <>
            <input
              className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
              name="full_name"
              placeholder="Full name"
              required
            />
            <input
              className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
              name="organization_name"
              placeholder="Organization name"
            />
            <input
              className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
              name="workspace_name"
              placeholder="Workspace name"
            />
          </>
        )}
        <input
          className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
          name="email"
          placeholder="Email"
          defaultValue={mode === "signin" ? demoEmail : ""}
          required
          type="email"
        />
        <input
          className="w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm outline-none"
          name="password"
          placeholder="Password"
          defaultValue={mode === "signin" ? demoPassword : ""}
          required
          type="password"
        />

        {error && <p className="text-sm text-red-700">{error}</p>}

        <Button className="w-full">{loading ? "Working..." : mode === "signin" ? "Sign In" : "Create Account"}</Button>
      </form>
    </div>
  );
}
