import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnowledgeGraph AI — Multi-Agent RAG System",
  description: "Production-grade GraphRAG with dynamic knowledge graph visualization, multi-agent reasoning, and real-time analytics",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <div id="toast-root" />
      </body>
    </html>
  );
}
