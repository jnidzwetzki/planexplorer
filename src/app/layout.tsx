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

export const metadata: Metadata = {
  title: "Query Plan Explorer",
  description: "A tool for exploring and analyzing SQL query plans.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <footer style={{ textAlign: 'center', marginTop: 32, marginBottom: 16, fontSize: 15, color: '#888' }}>
          <a href="https://jnidzwetzki.github.io/imprint/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>Imprint</a>
        </footer>
      </body>
    </html>
  );
}
