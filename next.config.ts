import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "bcryptjs"],
};

export default nextConfig;
