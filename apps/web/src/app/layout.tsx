import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Space_Grotesk } from "next/font/google";
import { QueryProvider } from "@/components/query-provider";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "ClawObs",
  description: "Hosted observability for OpenClaw.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen font-[var(--font-sans)]">
        <QueryProvider>
          <div className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 md:px-8">
            <div className="mb-8 flex items-center justify-between">
              <Link className="text-sm font-semibold uppercase tracking-[0.35em] text-primary" href="/">
                ClawObs
              </Link>
              <div className="hidden text-sm text-muted-foreground md:block">
                Hosted traces, keys, and setup for OpenClaw teams.
              </div>
            </div>
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
