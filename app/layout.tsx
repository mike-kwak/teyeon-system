import type { Metadata } from "next";
import { Rajdhani, Orbitron, Geist } from "next/font/google";
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

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
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
  alignItems: 'center',
  paddingBottom: '120px',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geist.variable} ${rajdhani.variable} ${orbitron.variable} h-full antialiased`}
      style={{ backgroundColor: '#0A0A0A', colorScheme: 'dark' }}
    >
      <body style={{ 
        backgroundColor: '#000000', 
        margin: 0, 
        padding: 0, 
        minHeight: '100dvh',
        fontFamily: 'var(--font-geist), var(--font-rajdhani), sans-serif',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start'
      }}>
        <StitchesRegistry>
          <AuthProvider>
            <ThemeProvider>
              <div style={{ 
                width: '100%', 
                maxWidth: '450px', 
                minHeight: '100dvh', 
                backgroundColor: '#121212', 
                position: 'relative',
                boxShadow: '0 0 100px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                overflowX: 'hidden',
                margin: '0 auto'
              }}>
                <GlobalHeader />
                <GlobalMain id="main-container">
                  {children}
                </GlobalMain>
                <BottomNav />
              </div>
            </ThemeProvider>
          </AuthProvider>
        </StitchesRegistry>
      </body>
    </html>
  );
}
