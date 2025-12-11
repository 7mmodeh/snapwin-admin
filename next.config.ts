import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ...anything else you already have here

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "eqnuoaqluisaiiersxkf.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // or simpler:
    // domains: ["eqnuoaqluisaiiersxkf.supabase.co"],
  },
};

export default nextConfig;
