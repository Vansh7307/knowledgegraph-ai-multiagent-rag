import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnowledgeGraph AI — Multi-Agent RAG System",
  description: "Production-grade GraphRAG with dynamic knowledge graph visualization, multi-agent reasoning, and real-time analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
        <div id="toast-root" />
      </body>
    </html>
  );
}
