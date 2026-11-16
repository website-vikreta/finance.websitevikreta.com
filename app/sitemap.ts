import type { MetadataRoute } from "next";

/** Only /login is reachable without a session; every other page redirects there. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://finance.websitevikreta.com/login",
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
