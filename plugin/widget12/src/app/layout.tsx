import type { Metadata } from "next";
import "./globals.css";
import { withBasePath } from "@/lib/basePath";

export const metadata: Metadata = {
  title: "El Niño Story",
  description: "El Niño map explorer",
  icons: {
    icon: [
      { url: withBasePath("/favicon.ico"), sizes: "48x48" },
      { url: withBasePath("/icon.png"), type: "image/png", sizes: "512x512" },
    ],
    apple: withBasePath("/apple-icon.png"),
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
