import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FleetProvider } from "@/lib/store";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fleet Wise",
  description:
    "Fleet Wise — AI-powered maintenance for your vehicles. Fewer breakdowns, lower costs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <FleetProvider>
          <Nav />
          {children}
        </FleetProvider>
      </body>
    </html>
  );
}
