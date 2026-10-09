import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-xl font-semibold tracking-tight">
        consent<span className="text-ink-faint">.</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs text-ink-faint">
        Documented, verifiable permission for names, images, voices and likenesses.
      </p>
    </div>
  );
}
