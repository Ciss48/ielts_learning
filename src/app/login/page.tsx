"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "@/lib/auth-actions";

const initialState: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded border border-black/20 px-3 py-2 disabled:opacity-50"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">IELTS Daily</h1>

      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="rounded border border-black/20 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border border-black/20 px-3 py-2"
          />
        </label>

        <SubmitButton />

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
