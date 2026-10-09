"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useActivity } from "./activity";
import { Icon } from "./ui";

// Eight is the most that stays legible across the bottom of a phone. Feed,
// Research, Settings, Help and the prompt builder live one tap deeper, under
// All (every dashboard, and the install button), which the logo also opens.
const items = [
  { href: "/", label: "Home", icon: Icon.power },
  { href: "/build", label: "Build", icon: Icon.sparkle },
  { href: "/try", label: "Try it", icon: Icon.play },
  { href: "/dashboards", label: "All", icon: Icon.expand },
  { href: "/orders", label: "Orders", icon: Icon.list },
  { href: "/projects", label: "Projects", icon: Icon.folder },
  { href: "/studio", label: "Media", icon: Icon.image },
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
