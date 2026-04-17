import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const steps = [
  "Sign in with email. No passwords, no team setup ceremony.",
  "Copy the OpenClaw-ready setup message with your API key baked in.",
  "Paste it into OpenClaw and watch traces appear in a few seconds.",
];

export default function LandingPage(): React.JSX.Element {
  return (
    <main className="space-y-10">
      <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div className="space-y-6">
          <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            Built for OpenClaw. Not another generic tracing dashboard.
          </div>
          <div className="space-y-4">
            <h1 className="max-w-4xl font-[var(--font-serif)] text-5xl leading-[0.96] tracking-tight text-foreground md:text-7xl">
              Turn OpenClaw into a product you can actually observe.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              ClawObs gives every OpenClaw user a hosted ingest endpoint, an install-ready setup
              message, and a clean trace dashboard without asking them to touch ClickHouse.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/auth">
              <Button size="lg">Start with email</Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="secondary" size="lg">
                See the flow
              </Button>
            </a>
          </div>
        </div>

        <Card className="overflow-hidden border-white/70 bg-[linear-gradient(135deg,#08302d_0%,#0f5c54_65%,#125850_100%)] text-white">
          <CardContent className="space-y-5 p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-white/70">Launch path</div>
            <div className="space-y-4">
              {steps.map((step, index) => (
                <div key={step} className="flex gap-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-sm font-semibold">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-7 text-white/88">{step}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="how-it-works" className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Signup that feels invisible",
            body: "Magic-link auth creates the user, project, and first API key in one flow.",
          },
          {
            title: "Paste-message onboarding",
            body: "Users get one message to paste into OpenClaw instead of docs and screenshots.",
          },
          {
            title: "Live traces in seconds",
            body: "The dashboard polls ClickHouse-backed read models every 3 seconds for MVP.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardContent className="space-y-3 p-6">
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{item.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
