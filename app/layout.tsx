import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// METADATA PROFISSIONAL PARA A DEMO
export const metadata: Metadata = {
  title: "Centro AI | Gestão Inteligente",
  description: "Plataforma de automação e gestão de performance para centros de estudo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 1. O suppressHydrationWarning no html e body impede os falsos positivos das extensões
    // 2. lang="pt" evita que o browser sugira traduções na frente do cliente
    <html lang="pt" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}