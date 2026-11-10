import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { localMode } from "@/lib/config";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fraaime · Project Studio",
  description:
    "AI-powered structural framing. Private plan review, editable models, and preliminary framing estimates.",
  icons: { icon: "/brand/fraaime-symbol.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const body = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
  return !localMode() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#000000",
          colorForeground: "#000000",
          colorMutedForeground: "#544f4c",
          colorBackground: "#ffffff",
          colorInput: "#ffffff",
          colorInputForeground: "#000000",
          fontFamily:
            '"PP Neue Montreal", "Neue Montreal", "Helvetica Neue", Helvetica, Arial, sans-serif',
          borderRadius: "4px",
        },
      }}
    >
      {body}
    </ClerkProvider>
  ) : (
    body
  );
}
