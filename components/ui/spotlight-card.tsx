"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card with an aceternity-style cursor spotlight: a soft amber radial glow
 * follows the pointer while hovering. Pure CSS variables, no animation deps.
 */
export function SpotlightCard({
  className,
  children,
  spotlightColor = "rgba(250, 188, 17, 0.14)",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { spotlightColor?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = React.useState(false);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--spotlight-x", `${event.clientX - rect.left}px`);
    element.style.setProperty("--spotlight-y", `${event.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn("console-card relative", className)}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: hovering ? 1 : 0,
          background: `radial-gradient(280px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 70%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
