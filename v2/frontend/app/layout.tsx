import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vortex v2",
  description: "Vortex Messenger — rebuilt on PHP + Next.js",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
