import { getCurrentUser } from "@/lib/auth";
import { signOutAction } from "@/lib/auth-actions";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-xl font-semibold">IELTS Daily — Phase 1 pending</h1>
      <p className="text-sm">Signed in as {user?.email ?? "unknown"}</p>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded border border-black/20 px-3 py-2"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
