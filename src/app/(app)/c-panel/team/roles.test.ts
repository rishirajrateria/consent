import { describe, expect, it } from "vitest";
import { NO_PERMS, canManageTeam, canSendAs, grantProblem, readInvite, seatPerms } from "./roles";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("readInvite", () => {
  it("reads a manager with the ticked permissions", () => {
    expect(readInvite(form({ email: " Sam@Agency.com ", role: "MANAGER", canApprove: "on", canExport: "on" }))).toEqual({
      ok: true,
      invite: {
        to: "sam@agency.com",
        role: "MANAGER",
        flags: { canApprove: true, canEditRules: false, canExport: true, canManageTeam: false },
      },
    });
  });

  it("never gives a viewer a permission", () => {
    const r = readInvite(form({ email: "v@x.com", role: "VIEWER", canApprove: "on", canManageTeam: "on" }));
    expect(r.ok && r.invite.flags).toEqual({ canApprove: false, canEditRules: false, canExport: false, canManageTeam: false });
  });

  it("only invites managers and viewers, by email", () => {
    expect(readInvite(form({ email: "x@y.com", role: "OWNER" })).ok).toBe(false);
    expect(readInvite(form({ email: "x@y.com", role: "LEGAL" })).ok).toBe(false);
    expect(readInvite(form({ email: "not-an-email", role: "MANAGER" })).ok).toBe(false);
  });
});

describe("canSendAs", () => {
  it("lets owners and managers send, not viewers", () => {
    expect(canSendAs("OWNER")).toBe(true);
    expect(canSendAs("MANAGER")).toBe(true);
    expect(canSendAs("EDITOR")).toBe(true);
    expect(canSendAs("VIEWER")).toBe(false);
  });
});

describe("seat permissions", () => {
  const all = { canApprove: true, canEditRules: true, canExport: true, canManageTeam: true };
  it("never lets a viewer act, even with stored permissions", () => {
    expect(seatPerms({ role: "VIEWER", ...all })).toEqual(NO_PERMS);
    expect(canManageTeam({ role: "VIEWER", ...all })).toBe(false);
  });
  it("gives the owner everything and a manager only their flags", () => {
    expect(seatPerms({ role: "OWNER", ...NO_PERMS })).toEqual(all);
    expect(canManageTeam({ role: "MANAGER", ...NO_PERMS, canManageTeam: true })).toBe(true);
    expect(canManageTeam({ role: "MANAGER", ...NO_PERMS })).toBe(false);
  });
});

describe("grantProblem", () => {
  const teamOnly = { role: "MANAGER" as const, ...NO_PERMS, canManageTeam: true };
  it("stops a manager giving a permission they don't hold", () => {
    expect(grantProblem(teamOnly, { ...NO_PERMS, canApprove: true })).toBe("You can only give permissions you have.");
    expect(grantProblem(teamOnly, { ...NO_PERMS, canManageTeam: true })).toBeNull();
    expect(grantProblem(teamOnly, NO_PERMS)).toBeNull();
  });
  it("lets the owner give anything", () => {
    expect(grantProblem({ role: "OWNER", ...NO_PERMS }, { canApprove: true, canEditRules: true, canExport: true, canManageTeam: true })).toBeNull();
  });
});
