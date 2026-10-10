import { redirect } from "next/navigation";

// One team per profile: it lives at /c-panel/team.
export default function OldTeamPage() {
  redirect("/c-panel/team");
}
