"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "./ui";

const items = [
  { href: "/", label: "Home", icon: Icon.power },
  { href: "/projects", label: "Projects", icon: Icon.folder },
  { href: "/research", label: "Research", icon: Icon.flask },
  { href: "/feed", label: "Feed", icon: Icon.list },
  { href: "/settings", label: "Settings", icon: Icon.gear }
];

export const Nav = () => {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
