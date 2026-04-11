"use client";

import { motion } from "framer-motion";
import { ArrowRight, Bot, ChartNoAxesCombined, Code2, Shield, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const features = [
  {
    title: "Supervisor-led multi-agent execution",
    copy:
      "A Qwen-powered supervisor decomposes goals, assigns specialist agents, manages escalations, and synthesizes outcomes."
  },
  {
    title: "Research, analysis, content, coding, automation",
    copy:
      "One system handles strategic research, reports, code generation, browser flows, data work, and rich artifacts."
  },
  {
    title: "Enterprise architecture by default",
    copy:
      "Workspace-scoped memory, audit trails, approvals, retrieval grounding, and streaming run telemetry are built in."
  }
];

const capabilities = [
  {
    icon: Bot,
    title: "Agentic Orchestration",
    copy: "Parallel and sequential agent swarms with confidence scoring, retries, and escalation policies."
  },
  {
    icon: ChartNoAxesCombined,
    title: "Research + Analytics",
    copy: "Deep source synthesis, structured reasoning, and decision-ready outputs grounded in evidence."
  },
  {
    icon: Code2,
    title: "Software Delivery",
    copy: "Generate apps, APIs, workflows, scripts, and automation plans inside a secure execution model."
  },
  {
    icon: Shield,
    title: "Security + Governance",
    copy: "Approvals, audit logs, policy-aware tools, and enterprise control surfaces for production teams."
  }
];

export function Homepage() {
  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-8">
        <div className="panel overflow-hidden rounded-[36px] bg-gradient-to-br from-white/85 via-white/70 to-mist/70">
          <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-xl">Autonomous AI Swarm</p>
                <p className="text-sm text-black/60">
                  Multi-agent operating system for ambitious knowledge work
                </p>
              </div>
            </div>
            <div className="hidden gap-3 md:flex">
              <Button href="/features" variant="ghost">
                Features
              </Button>
              <Button href="/trust" variant="ghost">
                Trust
              </Button>
              <Button href="/pricing" variant="ghost">
                Pricing
              </Button>
              <Button href="/docs" variant="ghost">
                Docs
              </Button>
              <Button href="/signin">Enter App</Button>
            </div>
          </div>

          <div className="grid gap-10 px-6 py-12 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-16">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="space-y-7"
            >
              <Badge>Autonomous Workflows for Research, Creation, and Execution</Badge>
              <div className="space-y-5">
                <h1 className="max-w-4xl font-display text-5xl leading-[0.95] text-balance md:text-7xl">
                  The premium AI workspace for complex work that spans research, decisions,
                  software, and automation.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-black/[0.68]">
                  Inspired by elite financial platforms and next-generation AI operators, this
                  system coordinates specialized agents across web research, strategy, code,
                  visual workflows, and deliverable generation.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <Button href="/signin" className="gap-2">
                  Launch Workspace
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button href="/docs" variant="secondary">
                  Explore Architecture
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {features.map((feature) => (
                  <div key={feature.title} className="rounded-[24px] border border-black/10 bg-white/60 p-5">
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-black/[0.55]">
                      {feature.title}
                    </h2>
                    <p className="text-sm leading-7 text-black/70">{feature.copy}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.7 }}
              className="rounded-[32px] border border-black/10 bg-ink p-5 text-white shadow-soft"
            >
              <div className="mb-5 flex items-center justify-between">
                <Badge className="border-white/[0.15] bg-white/10 text-white/75">Live Swarm Run</Badge>
                <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs text-emerald-200">
                  5 agents active
                </span>
              </div>
              <div className="space-y-4">
                <div className="rounded-[24px] bg-white/[0.08] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/[0.45]">Supervisor</p>
                  <p className="mt-2 text-lg">
                    Decomposing a market-entry brief into research, pricing, operations, and launch
                    narrative workstreams.
                  </p>
                </div>
                <div className="grid gap-3">
                  {[
                    "Research agent gathered sources and regulatory checkpoints.",
                    "Analysis agent ranked expansion scenarios and margin sensitivity.",
                    "Content agent drafted the board memo and launch storyline.",
                    "Coding agent designed data ingestion and KPI dashboard architecture."
                  ].map((line) => (
                    <div key={line} className="rounded-[20px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white/[0.78]">
                      {line}
                    </div>
                  ))}
                </div>
                <div className="rounded-[24px] border border-bronze/40 bg-bronze/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-bronze">Artifacts</p>
                  <p className="mt-2 text-sm leading-7 text-white/80">
                    Board memo, source pack, action plan, automation schedule, architecture draft
                    for execution dashboard.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {capabilities.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="panel p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-pine text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 font-display text-2xl">{item.title}</h3>
                <p className="text-sm leading-7 text-black/70">{item.copy}</p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
