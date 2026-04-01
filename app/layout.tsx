import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import GlobalHeader from "@/components/GlobalHeader";
import BottomNav from "@/components/BottomNav";
import StitchesRegistry from "./registry";
import ThemeProvider from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "테연 테니스 | Premium Black & Gold",
  description: "테연 테니스 클럽 매치 관리 시스템 (Stitches Edition)",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "테연",
  },
};

export const viewport = {
  themeColor: "#000000",
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
      <body className="min-h-full flex flex-col bg-black pb-20">
        <StitchesRegistry>
          <AuthProvider>
            <ThemeProvider>
              <GlobalHeader />
              <main className="flex-1 overflow-x-hidden">
                {children}
              </main>
              <BottomNav />
            </ThemeProvider>
          </AuthProvider>
        </StitchesRegistry>
      </body>
    </html>
  );
}
