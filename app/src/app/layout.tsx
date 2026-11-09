import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { localMode } from "@/lib/config";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fraaime · Project Studio",
  description: "Private plan review and editable building models.",
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
    <ClerkProvider>{body}</ClerkProvider>
  ) : (
    body
  );
}
