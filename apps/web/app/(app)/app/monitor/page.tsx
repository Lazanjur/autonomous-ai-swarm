import { Badge } from "@/components/ui/badge";
import { getChatWorkspace, getCurrentSession, hasSessionCookie } from "@/lib/api";

export default async function MonitorPage() {
  const session = await getCurrentSession();
  const workspaceId = session?.workspaces[0]?.workspace_id;

  if (!workspaceId) {
    if (await hasSessionCookie()) {
      return (
        <section className="panel p-6">
          <Badge>Agent Monitor</Badge>
          <h1 className="mt-4 font-display text-5xl">Live orchestration telemetry is unavailable.</h1>
          <p className="mt-4 max-w-2xl text-base text-black/62">
            The session cookie is present, but the authenticated workspace profile could not be loaded from the backend.
          </p>
        </section>
      );
    }
    return (
      <section className="panel p-6">
        <Badge>Agent Monitor</Badge>
        <h1 className="mt-4 font-display text-5xl">Live orchestration telemetry is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          Sign in to a workspace-backed session to inspect recent runs, execution plans, and supervisor posture.
        </p>
      </section>
    );
  }

  const runtime = await getChatWorkspace(workspaceId);
  if (!runtime) {
    return (
      <section className="panel p-6">
        <Badge>Agent Monitor</Badge>
        <h1 className="mt-4 font-display text-5xl">Live orchestration telemetry is unavailable.</h1>
        <p className="mt-4 max-w-2xl text-base text-black/62">
          The workspace session is valid, but persisted chat runtime data could not be loaded from the backend.
        </p>
      </section>
    );
  }
  const latestRun = runtime.runs[0] ?? null;
  const plannedSteps = Array.isArray(latestRun?.plan) ? latestRun?.plan : [];

  return (
    <section className="space-y-6">
      <div className="panel p-6">
        <Badge>Agent Monitor</Badge>
        <h1 className="mt-4 font-display text-5xl">Supervisor posture and recent execution state.</h1>
        <p className="mt-4 max-w-3xl text-base text-black/62">
          Inspect the active thread, the latest persisted run, and the orchestration plan the supervisor generated for it.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Threads</p>
          <p className="mt-3 font-display text-4xl">{runtime.threads.length}</p>
          <p className="mt-2 text-sm text-black/60">Persisted workspace conversations.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Runs</p>
          <p className="mt-3 font-display text-4xl">{runtime.runs.length}</p>
          <p className="mt-2 text-sm text-black/60">Recent runs on the selected thread.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Plan Steps</p>
          <p className="mt-3 font-display text-4xl">{plannedSteps.length}</p>
          <p className="mt-2 text-sm text-black/60">Supervisor tasks in the latest run.</p>
        </div>
        <div className="rounded-[24px] border border-black/10 bg-white/75 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-black/45">Model</p>
          <p className="mt-3 font-display text-3xl">{latestRun?.supervisor_model ?? "n/a"}</p>
          <p className="mt-2 text-sm text-black/60">Supervisor model for the most recent run.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="panel p-6">
          <h2 className="font-display text-3xl">Recent Runs</h2>
          <div className="mt-5 space-y-4">
            {runtime.runs.map((run) => (
              <div key={run.id} className="rounded-[22px] border border-black/10 bg-white/75 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-black/76">{run.status}</p>
                  <p className="text-sm text-black/45">{new Date(run.created_at).toLocaleString()}</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-black/72">{run.user_message}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs uppercase tracking-[0.14em] text-black/45">
                  <span className="rounded-full border border-black/10 px-3 py-1">{run.supervisor_model}</span>
                  <span className="rounded-full border border-black/10 px-3 py-1">
                    {Array.isArray(run.plan) ? run.plan.length : 0} plan steps
                  </span>
                </div>
                {run.summary ? <p className="mt-4 text-sm text-black/60">{run.summary}</p> : null}
              </div>
            ))}
            {runtime.runs.length === 0 ? (
              <p className="text-sm text-black/50">No persisted runs yet for this thread.</p>
            ) : null}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="font-display text-3xl">Latest Plan</h2>
          <div className="mt-5 space-y-4">
            {plannedSteps.map((step, index) => {
              const record = step as Record<string, unknown>;
              return (
                <div key={`${record.key ?? index}`} className="rounded-[22px] border border-black/10 bg-white/75 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-black/76">
                      {String(record.key ?? `step-${index + 1}`)}
                    </p>
                    <p className="text-xs uppercase tracking-[0.14em] text-black/45">
                      {String(record.execution_mode ?? "n/a")}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-black/68">
                    {String(record.objective ?? "No objective recorded.")}
                  </p>
                  <p className="mt-3 text-sm text-black/55">
                    {String(record.reason ?? "No rationale recorded.")}
                  </p>
                </div>
              );
            })}
            {plannedSteps.length === 0 ? (
              <p className="text-sm text-black/50">Run plans will appear here after a supervisor execution completes.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
