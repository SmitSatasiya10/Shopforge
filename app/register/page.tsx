"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create your account");
      router.push(searchParams.get("from") ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#09090B] px-4 py-12 text-white">
      <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-6 shadow-2xl ring-1 ring-white/10">
        <p className="text-lg font-semibold">Create your account</p>
        <p className="mt-1 text-[13px] text-neutral-400">Start building your storefront.</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label htmlFor="email" className="text-[11px] text-neutral-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-[11px] text-neutral-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="text-[11px] text-neutral-400">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-neutral-800 px-2.5 py-1.5 text-xs text-white"
            />
          </div>

          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting || !email || !password || !confirmPassword}
            className="mt-2 w-full rounded-full bg-[#8B5CF6] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#7C3AED] disabled:opacity-50"
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-neutral-400">
          Already have an account?{" "}
          <a href="/login" className="text-neutral-200 hover:text-white hover:underline">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
