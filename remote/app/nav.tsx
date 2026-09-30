"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useActivity } from "./activity";
import { Icon } from "./ui";

// Six is the most that stays legible across the bottom of a phone. Research,
// Feed, Settings and Help live one tap deeper, under Control.
const items = [
  { href: "/", label: "Home", icon: Icon.power },
  { href: "/build", label: "Build", icon: Icon.sparkle },
  { href: "/prompt", label: "Prompt", icon: Icon.code },
  { href: "/orders", label: "Orders", icon: Icon.list },
  { href: "/projects", label: "Projects", icon: Icon.folder },
  { href: "/research", label: "Research", icon: Icon.flask },
  { href: "/control", label: "Control", icon: Icon.gear }
];

export const Nav = () => {
  const pathname = usePathname();
  const { live } = useActivity();
  return (
    <nav className="nav">
      <div className="nav-inner">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <span className="nav-icon">
                {item.icon}
                {item.href === "/build" && live.length > 0 ? <b className="nav-badge">{live.length}</b> : null}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
