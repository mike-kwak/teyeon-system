import type { Metadata } from "next";
import { Rajdhani, Orbitron, Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import RootShell from "@/components/RootShell";
import StitchesRegistry from "./registry";
import ThemeProvider from "@/components/ThemeProvider";
import { LoadingProvider } from "@/context/LoadingContext";

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
  title: "TEYEON v1.20.5",
  description: "The Ultimate Tournament Database v1.20.5",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico",       sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32",  type: "image/png" },
      { url: "/favicon.png",       sizes: "96x96",   type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TEYEON v1.20.5",
  },
};

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geist.variable} ${rajdhani.variable} ${orbitron.variable} h-full antialiased`}
      style={{ backgroundColor: '#0A0A0A', colorScheme: 'light' }}
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var cleanupKey = 'teyeon_sw_cleanup_v2';
                var reloadKey = 'teyeon_sw_cleanup_reload_v2';
                var shouldLog = false;

                try {
                  shouldLog = !sessionStorage.getItem(cleanupKey);
                } catch (error) {
                  shouldLog = true;
                }

                function markCleanupDone() {
                  try {
                    sessionStorage.setItem(cleanupKey, 'done');
                  } catch (error) {}
                }

                function hasReloaded() {
                  try {
                    return sessionStorage.getItem(reloadKey) === 'done';
                  } catch (error) {
                    return true;
                  }
                }

                function markReloaded() {
                  try {
                    sessionStorage.setItem(reloadKey, 'done');
                  } catch (error) {}
                }

                var serviceWorkerCleanup = Promise.resolve(0);
                var cacheCleanup = Promise.resolve(0);

                if ('serviceWorker' in navigator) {
                  serviceWorkerCleanup = navigator.serviceWorker.getRegistrations()
                    .then(function(registrations) {
                      return Promise.all(registrations.map(function(registration) {
                        return registration.unregister();
                      })).then(function() {
                        return registrations.length;
                      });
                    });
                }

                if ('caches' in window) {
                  cacheCleanup = caches.keys()
                    .then(function(keys) {
                      return Promise.all(keys.map(function(key) {
                        return caches.delete(key);
                      })).then(function() {
                        return keys.length;
                      });
                    });
                }

                Promise.all([serviceWorkerCleanup, cacheCleanup])
                  .then(function(results) {
                    var registrationCount = results[0];
                    var cacheCount = results[1];
                    var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);

                    if (shouldLog && (registrationCount > 0 || cacheCount > 0 || hadController)) {
                      console.info('[PWA Cleanup] Service Worker cleanup requested');
                      if (registrationCount > 0) console.info('[PWA Cleanup] Service Worker unregistered', registrationCount);
                      if (cacheCount > 0) console.info('[PWA Cleanup] Cache storage cleared', cacheCount);
                    }

                    markCleanupDone();

                    if ((registrationCount > 0 || cacheCount > 0 || hadController) && !hasReloaded()) {
                      markReloaded();
                      window.location.reload();
                    }
                  })
                  .catch(function(error) {
                    console.warn('[PWA Cleanup] Cleanup failed:', error);
                    markCleanupDone();
                  });
              })();
            `,
          }}
        />
        <StitchesRegistry>
          <AuthProvider>
            <ThemeProvider>
            <LoadingProvider>
              <RootShell>{children}</RootShell>
            </LoadingProvider>
            </ThemeProvider>
          </AuthProvider>
        </StitchesRegistry>
      </body>
    </html>
  );
}
