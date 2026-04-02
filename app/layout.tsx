import type { Metadata } from "next";
import { Rajdhani, Orbitron } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import GlobalHeader from "@/components/GlobalHeader";
import BottomNav from "@/components/BottomNav";
import StitchesRegistry from "./registry";
import ThemeProvider from "@/components/ThemeProvider";
import { styled } from "@/stitches.config";

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "TEYEON | Elite Circuit",
  description: "The Ultimate Tennis Match Management System",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TEYEON",
  },
};

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const GlobalMain = styled('main', {
  flex: 1,
  backgroundColor: '#121212',
  minHeight: '100dvh',
  position: 'relative',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${rajdhani.variable} ${orbitron.variable} h-full antialiased`}
      style={{ backgroundColor: '#121212', colorScheme: 'dark' }}
    >
      <body style={{ 
        backgroundColor: '#121212', 
        margin: 0, 
        padding: 0, 
        minHeight: '100dvh',
        fontFamily: 'var(--font-rajdhani), sans-serif'
      }}>
        <StitchesRegistry>
          <AuthProvider>
            <ThemeProvider>
              <GlobalHeader />
              <GlobalMain id="main-container">
                {children}
              </GlobalMain>
              <BottomNav />
            </ThemeProvider>
          </AuthProvider>
        </StitchesRegistry>
      </body>
    </html>
  );
}
