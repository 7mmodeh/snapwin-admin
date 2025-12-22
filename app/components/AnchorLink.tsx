// components/AnchorLink.tsx
"use client";

import React from "react";

type AnchorLinkProps = {
  href: string; // e.g. "#faq"
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  offset?: number; // default 96
};

export function AnchorLink({
  href,
  className,
  style,
  children,
  offset = 96,
}: AnchorLinkProps) {
  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={(e) => {
        // allow normal behavior for non-hash links
        if (!href.startsWith("#")) return;

        e.preventDefault();
        const id = href.slice(1);
        const el = document.getElementById(id);
        if (!el) return;

        const top =
          el.getBoundingClientRect().top + window.scrollY - (offset ?? 0);

        window.scrollTo({ top, behavior: "smooth" });
        history.replaceState(null, "", href);
      }}
    >
      {children}
    </a>
  );
}
