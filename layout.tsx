import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEX Terminal — SPX/SPY Gamma Exposure Dashboard",
  description: "Intraday gamma exposure (GEX) analytics for SPX/SPY options, mapped to ES futures levels.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
