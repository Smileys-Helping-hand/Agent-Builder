/** Sorting and filtering the portfolio, as plain functions the tests call. */
import type { Project, Role } from "./content";

/** Every tag used, most-used first, then alphabetically. */
export function allTags(projects: Project[]): string[] {
  const counts = new Map<string, number>();
  for (const project of projects) for (const tag of project.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** Newest first; "All" shows everything. */
export function projectsTagged(projects: Project[], tag: string): Project[] {
  const chosen = tag === "All" ? projects : projects.filter((project) => project.tags.includes(tag));
  return [...chosen].sort((a, b) => b.year - a.year);
}

/** Current role first, then by when it ended. */
export function timeline(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => (b.end ?? Infinity) - (a.end ?? Infinity) || b.start - a.start);
}

export function period(role: Role): string {
  return `${role.start} – ${role.end ?? "now"}`;
}
