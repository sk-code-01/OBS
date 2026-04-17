import { requestMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface AuthPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuthPage({ searchParams }: AuthPageProps): Promise<React.JSX.Element> {
  const params = (await searchParams) ?? {};
  const sent = params.sent === "1";
  const error = params.error;

  return (
    <main className="mx-auto max-w-xl">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-4 border-b border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(237,249,244,0.95))]">
          <div className="text-xs uppercase tracking-[0.28em] text-primary">ClawObs access</div>
          <CardTitle className="font-[var(--font-serif)] text-4xl leading-tight">
            Sign in with your email.
          </CardTitle>
          <CardDescription className="text-base leading-7">
            We’ll send a one-click link. On your first login, ClawObs also creates your project and
            first API key automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          {sent ? (
            <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
              Check your inbox. The sign-in link is on its way.
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error === "invalid-email" ? "Please enter a valid email address." : "That link is invalid or expired."}
            </div>
          ) : null}

          <form action={requestMagicLink} className="space-y-4">
            <label className="space-y-2 text-sm font-medium text-foreground">
              <span>Email</span>
              <Input name="email" type="email" placeholder="you@company.com" required />
            </label>
            <Button className="w-full" size="lg">
              Send magic link
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
