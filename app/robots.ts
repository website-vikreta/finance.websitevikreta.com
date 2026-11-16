import type { MetadataRoute } from "next";

/**
 * The app itself is private: every page except /login redirects to the sign-in
 * screen without a session cookie. Crawlers are allowed in so the public login
 * page can be indexed; API routes stay off-limits.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: "https://finance.websitevikreta.com/sitemap.xml",
  };
}
