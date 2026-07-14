import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://astrail.dev";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Astrail | Hosted MCP servers, OpenAPI to MCP, and SDK Factory",
    template: "%s | Astrail",
  },
  description:
    "Astrail turns OpenAPI specs, websites, APIs, and workflows into hosted MCP servers, AI agent tools, Code Mode runtimes, SDK bundles, docs, and runtime logs.",
  applicationName: "Astrail",
  keywords: [
    "Astrail",
    "MCP",
    "MCP server",
    "OpenAPI to MCP",
    "OpenAPI to MCP generator",
    "API docs to MCP",
    "Swagger to MCP",
    "Swagger to MCP server",
    "MCP server generator",
    "hosted MCP endpoint",
    "MCP SDK generator",
    "Website to MCP",
    "Code Mode",
    "search_docs",
    "OpenAI Agents MCP",
    "ChatGPT MCP",
    "Claude MCP",
    "Cursor MCP",
    "AI agents",
    "hosted MCP runtime",
    "agent tools",
    "workflow automation",
    "agent infrastructure",
    "Asteail",
    "Astail",
    "Astail.dev",
  ],
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "Astrail | Hosted MCP servers and SDK Factory",
    description:
      "Generate hosted MCP endpoints, Code Mode docs search, SDK exports, runtime permissions, and logs from OpenAPI specs, websites, APIs, and workflows.",
    url: siteUrl,
    siteName: "Astrail",
    images: [{ url: "/og-image.jpg", width: 1920, height: 804, alt: "Astrail preview" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Astrail | Hosted MCP servers and SDK Factory",
    description:
      "OpenAPI to MCP, website-to-MCP, Code Mode, SDK Factory, and production agent-tool runtime logs.",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Astrail",
    alternateName: ["Astrail MCP", "Astrail SDK Factory", "Astrail.dev", "Asteail", "Astail", "Astail.dev"],
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Hosted MCP runtime and SDK generation platform that turns OpenAPI specs, websites, APIs, and workflows into AI agent tools.",
    url: siteUrl,
    offers: {
      "@type": "Offer",
      category: "Hosted MCP runtime and SDK generation platform",
    },
    featureList: [
      "OpenAPI to MCP generation",
      "Website-to-MCP generation",
      "Hosted HTTP JSON-RPC MCP endpoints",
      "Code Mode with search_docs and no-eval execute",
      "SDK Factory for TypeScript, Python, CLI, docs, tests, manifests, and CI",
      "Runtime permissions, auth-required states, trace ids, and structured logs",
    ],
  };

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Astrail",
    url: siteUrl,
    logo: `${siteUrl}/brand/astrail-prism-icon.svg`,
    description:
      "Astrail builds hosted MCP runtime and SDK generation infrastructure for AI agents.",
    knowsAbout: [
      "Model Context Protocol",
      "MCP servers",
      "OpenAPI to MCP",
      "API docs to MCP",
      "Swagger to MCP",
      "AI agent tools",
      "SDK generation",
      "Runtime permissions",
    ],
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Astrail",
    alternateName: ["Astrail.dev", "Astrail MCP", "Asteail", "Astail", "Astail.dev"],
    url: siteUrl,
    description:
      "Documentation and product pages for hosted MCP endpoints, agent tools, OpenAPI generation, website-to-MCP, Code Mode, and SDK Factory.",
    publisher: {
      "@type": "Organization",
      name: "Astrail",
      logo: `${siteUrl}/brand/astrail-prism-icon.svg`,
    },
  };

  return (
    <html lang="en">
      <head />
      <body
        className={`${geistSans.variable} ${geistMono.variable}`}
      >
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </body>
    </html>
  );
}
