import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ActivityProvider } from "./activity";
import { BuilderVersionProvider } from "./builder-version";
import { Nav } from "./nav";
import { ToastHost } from "./ui";

export const metadata: Metadata = {
  title: "Agent Builder",
  description: "Run your builder from anywhere.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Agent Builder" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" }
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastHost>
          <BuilderVersionProvider>
            <ActivityProvider>
              {children}
              <Nav />
            </ActivityProvider>
          </BuilderVersionProvider>
        </ToastHost>
        <script
          // Registers the offline shell. Inline and tiny so it costs nothing and
          // cannot fail the page if the worker is unavailable.
          dangerouslySetInnerHTML={{
            __html:
              "if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); }); }"
          }}
        />
      </body>
    </html>
  );
}
