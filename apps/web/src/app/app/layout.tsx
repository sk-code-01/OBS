import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/app", label: "Overview" },
  { href: "/app/traces", label: "Traces" },
  { href: "/app/setup", label: "Setup" },
  { href: "/app/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await requireSession();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[28px] border border-white/70 bg-white/78 px-6 py-5 shadow-panel md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Signed in as</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{session.email}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button variant="ghost" size="sm">
                {item.label}
              </Button>
            </Link>
          ))}
          <form action="/api/auth/logout" method="post">
            <Button variant="secondary" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}
