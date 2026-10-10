import { redirect } from "next/navigation";

// One ID check for everyone: the old per-side onboarding lives at /onboarding.
export default function OldOnboarding() {
  redirect("/onboarding");
}
