import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const tiers = [
  {
    name: "Builder",
    price: "$99",
    description: "For small teams running advanced AI workflows with supervised autonomy."
  },
  {
    name: "Scale",
    price: "$399",
    description: "For multi-workspace organizations requiring retrieval, automations, and audit trails."
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For security reviews, SSO, policy controls, and dedicated deployment footprints."
  }
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="panel p-8">
        <Badge>Pricing</Badge>
        <h1 className="mt-4 font-display text-6xl">Plans for ambitious AI operations.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-8 text-black/[0.65]">
          Choose a deployment posture that fits your team, then scale into enterprise governance,
          model routing, and long-running automations.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {tiers.map((tier) => (
            <div key={tier.name} className="rounded-[28px] border border-black/10 bg-white/80 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-black/[0.45]">{tier.name}</p>
              <p className="mt-3 font-display text-5xl">{tier.price}</p>
              <p className="mt-4 text-sm leading-7 text-black/70">{tier.description}</p>
              <Button href="/signup" className="mt-6 w-full">
                Start with {tier.name}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
