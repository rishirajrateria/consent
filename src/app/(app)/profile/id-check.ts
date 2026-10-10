/**
 * Where the profile's ID check stands, while it isn't approved. Only the owner
 * can act on it (and /onboarding shows only profiles you own), so other seats
 * get the status without a link.
 */
export function idCheckNote(status: string, name: string, isOwner: boolean): { text: string; link: string | null } {
  if (!isOwner) {
    const where =
      status === "MORE_INFO_NEEDED"
        ? "needs more information"
        : status === "REJECTED"
          ? "wasn't approved"
          : status === "DRAFT"
            ? "isn't finished yet"
            : "is in review";
    return { text: `${name}'s ID check ${where}. The profile owner gets the updates.`, link: null };
  }
  switch (status) {
    case "MORE_INFO_NEEDED":
      return { text: "Your ID check needs more information from you.", link: "Answer now" };
    case "REJECTED":
      return { text: "Your ID check wasn't approved.", link: "See why" };
    case "DRAFT":
      return { text: "Finish your ID check to ask people and be asked.", link: "Finish your ID check" };
    default:
      return {
        text: "Your ID check is in review. Once it's approved, you can ask people and people can ask you. You can set your terms now.",
        link: "See your ID check",
      };
  }
}
