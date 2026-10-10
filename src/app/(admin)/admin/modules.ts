/** Every admin module, grouped. Shared by the desktop sidebar and the mobile "More" page. */
export const ADMIN_MODULES: { group: string; links: [string, string][] }[] = [
  {
    group: "Queues",
    links: [
      ["/admin/requesters", "Requester applications"],
      ["/admin/consenters", "Consenter verification"],
      ["/admin/reports", "Reports & disputes"],
      ["/admin/takedowns", "Takedowns"],
    ],
  },
  {
    group: "Operations",
    links: [
      ["/admin/users", "Users & profiles"],
      ["/admin/requests", "Requests & grants"],
      ["/admin/payments", "Payments & invoices"],
      ["/admin/scores", "Consent Score"],
    ],
  },
  {
    group: "Configuration",
    links: [
      ["/admin/catalog", "Platforms & catalog"],
      ["/admin/pricing", "Pricing & coupons"],
      ["/admin/templates", "Agreement templates"],
      ["/admin/cms", "CMS pages"],
      ["/admin/settings", "System settings"],
      ["/admin/roles", "Admin roles"],
    ],
  },
  {
    group: "Insight",
    links: [
      ["/admin/analytics", "Analytics"],
      ["/admin/audit", "Audit log"],
    ],
  },
];
