"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "@/lib/auth-actions";

const initialState: SignInState = { error: null };

const FIELD =
  "rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-text outline-none focus:border-transparent focus:outline-2 focus:outline-offset-1 focus:outline-accent";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl px-5 py-3 text-[15px] font-semibold hover:brightness-110 disabled:opacity-50"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-[380px] flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="font-serif text-[28px] font-medium tracking-[-0.015em]">
          IELTS Daily
        </h1>
        <p className="eyebrow mt-1.5">Sign in to continue</p>
      </div>

      <form
        action={formAction}
        className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-6"
        style={{ boxShadow: "var(--shadow)" }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-dim">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-dim">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={FIELD}
          />
        </label>

        <div className="mt-1">
          <SubmitButton />
        </div>

        {state.error ? (
          <p
            role="alert"
            className="text-[13px]"
            style={{ color: "var(--sk-speaking)" }}
          >
            {state.error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
