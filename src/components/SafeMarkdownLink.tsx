import type React from "react";
import { getSafeExternalUrl } from "../utils/safeUrl";

interface SafeMarkdownLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
}

/** Markdown anchor that only navigates to http(s) URLs validated by getSafeExternalUrl. */
export const SafeMarkdownLink: React.FC<SafeMarkdownLinkProps> = ({
  href,
  children,
  className,
  ...rest
}) => {
  const safeUrl = href ? getSafeExternalUrl(href) : null;

  if (!safeUrl) {
    return (
      <span className={className ?? "text-slate-500"} {...rest}>
        {children}
      </span>
    );
  }

  return (
    <a
      {...rest}
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "text-red-400 hover:underline"}
    >
      {children}
    </a>
  );
};
