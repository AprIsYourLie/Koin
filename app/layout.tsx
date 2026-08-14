import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "Koin",
    description: "看清每个月的钱花在哪里。本机优先的个人消费账本。",
    manifest: "/manifest.webmanifest",
    openGraph: { title: "Koin", description: "看清每个月的钱花在哪里", images: [{ url: image, width: 1536, height: 1024 }] },
    twitter: { card: "summary_large_image", title: "Koin", description: "看清每个月的钱花在哪里", images: [image] },
  };
}

export const viewport: Viewport = {
  themeColor: "#f4f1ea",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
