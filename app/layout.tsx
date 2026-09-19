import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G0 — Terminal-Bench 4.0 prompt check",
  description:
    "Deterministic checks over a Terminal-Bench 4.0 task prompt. Does not approve tasks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
