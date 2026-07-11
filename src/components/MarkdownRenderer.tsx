import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SafeMarkdownLink } from "./SafeMarkdownLink";

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, className, ...rest }) => (
          <SafeMarkdownLink href={href} className={className ?? "text-red-400 hover:underline"} {...rest}>
            {children}
          </SafeMarkdownLink>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

export default MarkdownRenderer;
