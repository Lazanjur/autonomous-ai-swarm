import Link from "next/link";
import { SignInForm } from "@/components/app-shell/sign-in-form";

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-12">
      <div className="grid w-full gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">Workspace Provisioning</p>
          <h1 className="font-display text-6xl leading-[0.98]">
            Create an organization-ready AI operating system.
          </h1>
          <p className="max-w-xl text-sm leading-8 text-black/[0.66]">
            This flow creates the organization, workspace, owner membership, and server-backed
            session needed to access protected app routes.
          </p>
          <p className="text-sm text-black/[0.62]">
            Already have access? <Link href="/signin" className="underline">Sign in</Link>
          </p>
        </div>
        <SignInForm mode="signup" />
      </div>
    </main>
  );
}
