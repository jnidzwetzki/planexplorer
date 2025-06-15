import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import styles from "./Footer.module.css";

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
        <hr className={styles.footerSeparator} />
        <footer className={styles.footerLinks}>
          <a href="https://jnidzwetzki.github.io/imprint/" target="_blank">
            Imprint
          </a>
          <span> | </span>
          <a
            href="https://jnidzwetzki.github.io/2025/05/18/building-a-query-plan-explorer.html"
            target="_blank"
          >
            Blog article 1
          </a>
          <span> | </span>
          <a
            href="https://jnidzwetzki.github.io/2025/06/03/art-of-query-optimization.html"
            target="_blank"
          >
            Blog article 2
          </a>
          <span> | </span>
          <a href="https://github.com/jnidzwetzki/planexplorer/" target="_blank">
            GitHub Repository
          </a>
        </footer>
      </body>
    </html>
  );
}
