import Link from "next/link";
import { SignInForm } from "@/components/app-shell/sign-in-form";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-12">
      <div className="grid w-full gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Autonomous AI Swarm</p>
          <h1 className="font-display text-6xl leading-[0.98]">
            Secure access for long-running multi-agent work.
          </h1>
          <p className="max-w-xl text-sm leading-8 text-black/[0.66]">
            Sign in with the seeded demo account or create a new workspace. Sessions are issued by
            the FastAPI backend and bridged into the web app with HTTP-only cookies.
          </p>
          <p className="text-sm text-black/[0.62]">
            Need a new workspace? <Link href="/signup" className="underline">Create an account</Link>
          </p>
        </div>
        <SignInForm mode="signin" />
      </div>
    </main>
  );
}
