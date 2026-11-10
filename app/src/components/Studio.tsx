"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useDialog } from "./useDialog";
import Brand from "./Brand";
import EstimatePanel from "./EstimatePanel";
import { MOCK_ESTIMATE_SETTINGS } from "@/lib/estimate-settings";
import {
  BuildingModel,
  blankModel,
  ModelSchema,
  validateModel,
  formatFeet,
  feet,
  length,
} from "@/lib/model";
import { addElement, removeElement, transformElement } from "@/lib/editing";
import { editWallMember, resetWallFraming } from "@/lib/framing";
import type { Manifest } from "@/lib/worker";
import {
  selectedPlanPages,
  sheetKind,
  needsTitleOcr,
  suggestedPlanPages,
  SHELL_SHEET_KINDS,
  MAX_SHELL_PAGES,
  selectionWarnings,
  pendingSheetReview,
  needsSheetDecision,
} from "@/lib/sheet-selection";
const Viewer = dynamic(() => import("./ModelViewer"), {
  ssr: false,
  loading: () => <div className="canvas loading">Opening model…</div>,
});
async function api<T = any>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok)
    throw new Error(b.error + (b.details ? " · " + b.details.join("; ") : ""));
  return b;
}
type Project = { id: string; name: string; head_id: string | null };
type Job = {
  id: string;
  plan_id: string;
  state: string;
  phase: string;
  error: string | null;
  pages: number[];
  completed_pages: number[];
  spend: string;
};
type Detail = {
  project: Project;
  plans: {
    id: string;
    filename: string;
    manifest: Manifest | null;
    size_bytes: number;
  }[];
  jobs: Job[];
  revisions: {
    id: string;
    kind: string;
    reviewed: boolean;
    created_at: string;
  }[];
  members: { email: string; role: string }[];
};
export default function Studio() {
  const { prompt, confirm, dialog } = useDialog();
  const [session, setSession] = useState<{
    local: boolean;
    user: { email: string; role: string };
    aiConfigured: boolean;
    workerConfigured: boolean;
    shellFusion: boolean;
  } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [model, setModel] = useState<BuildingModel>(blankModel()),
    [baseId, setBaseId] = useState<string | null>(null),
    [viewedRevision, setViewedRevision] = useState<string | null>(null);
  const [past, setPast] = useState<BuildingModel[]>([]),
    [future, setFuture] = useState<BuildingModel[]>([]),
    [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [mode, setMode] = useState<"translate" | "rotate" | "scale">("translate"),
    [levelId, setLevelId] = useState(""),
    [roofVisible, setRoofVisible] = useState(false),
    [framing, setFraming] = useState(true),
    [top, setTop] = useState(false);
  const [tab, setTab] = useState<
      "model" | "sheets" | "schedule" | "estimate" | "review"
    >("model"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pageSelections, setPageSelections] = useState<Record<string, number[]>>(
      {},
    ),
    [source, setSource] = useState<{
      planId: string;
      page: number;
      region?: number[] | null;
    } | null>(null);
  const [reviewOnly, setReviewOnly] = useState<Record<string, boolean>>({});
  const spacing = model.estimate?.spacingMm ?? 406.4;
  const setSpacing = (value: number) =>
    change({
      ...model,
      estimate: {
        ...(model.estimate ?? MOCK_ESTIMATE_SETTINGS),
        spacingMm: value as 406.4 | 609.6,
      },
    });
  const selections = Object.fromEntries(
    (detail?.plans ?? []).map((plan) => [
      plan.id,
      selectedPlanPages(
        plan.manifest,
        pageSelections[plan.id],
        detail?.jobs.find((job) => job.plan_id === plan.id)?.pages,
        session?.shellFusion ? MAX_SHELL_PAGES : 30,
      ),
    ]),
  );
  const pendingByPlan = Object.fromEntries(
    (detail?.plans ?? []).map((plan) => [
      plan.id,
      pendingSheetReview(plan.manifest, selections[plan.id] ?? []),
    ]),
  );
  const reviewSheet = async (
    planId: string,
    page: number,
    decision: "exclude" | "reset",
  ) => {
    const reason =
      decision === "exclude"
        ? await prompt(
            `After viewing PDF page ${page}, why can it be excluded from this model?`,
            "",
          )
        : "Reopened for review";
    if (!reason?.trim()) return;
    run(async () => {
      await api(`plans/${planId}/review`, "POST", { page, decision, reason });
      if (decision === "exclude")
        setPageSelections((prev) => ({
          ...prev,
          [planId]: (prev[planId] ?? selections[planId] ?? []).filter(
            (p) => p !== page,
          ),
        }));
      await refresh();
    });
  };
  const loadProjects = async () => setProjects(await api("projects"));
  const refresh = useCallback(async () => {
    if (projectId) setDetail(await api("projects/" + projectId));
  }, [projectId]);
  useEffect(() => {
    api("session")
      .then((s) => {
        setSession(s);
        return loadProjects();
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const refresh = () =>
      api<Detail>("projects/" + projectId)
        .then((d) => {
          if (alive) setDetail(d);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);
  const loadModel = async (id: string, revision?: string) => {
    const r = await api(
      `projects/${id}/model${revision ? "?revision=" + revision : ""}`,
    );
    setModel(r?.model ?? blankModel());
    setViewedRevision(r?.id ?? null);
    setPast([]);
    setFuture([]);
    setDirty(false);
    setSelected(null);
    setLevelId("");
  };
  const chooseProject = async (id: string) => {
    if (dirty && !(await confirm("Discard unsaved edits?"))) return;
    setError("");
    setProjectId(id);
    setDetail(null);
    setSource(null);
    const d = await api<Detail>("projects/" + id);
    setDetail(d);
    setBaseId(d.project.head_id);
    await loadModel(id);
  };
  const change = useCallback(
    (next: BuildingModel) => {
      const parsed = ModelSchema.safeParse(next);
      if (!parsed.success) {
        setError("That edit is outside supported model limits.");
        return;
      }
      setPast((p) => [...p.slice(-49), model]);
      setFuture([]);
      setModel(parsed.data);
      setDirty(true);
      setNotice("");
    },
    [model],
  );
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [model, ...f]);
    setModel(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, model]);
    setModel(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "w") setMode("translate");
      else if (e.key === "e") setMode("rotate");
      else if (e.key === "r") setMode("scale");
      else if (e.key === "Delete" && selected)
        change(removeElement(model, selected));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const create = async (sample = false) => {
    const name = await prompt(
      "Project name",
      sample ? "Sample courtyard house" : "",
    );
    if (!name) return;
    await run(async () => {
      const p = await api("projects", "POST", { name, sample });
      await loadProjects();
      await chooseProject(p.id);
    });
  };
  const save = async (review = false) =>
    run(async () => {
      const snapshot = {
        ...model,
        estimate: model.estimate ?? structuredClone(MOCK_ESTIMATE_SETTINGS),
      };
      const r = await api(
        `projects/${projectId}/${review ? "review" : "model"}`,
        "POST",
        { baseId, model: snapshot },
      );
      setModel((current) => (current === model ? snapshot : current));
      setBaseId(r.id);
      setViewedRevision(r.id);
      setDirty(false);
      setNotice(
        review
          ? "Model marked reviewed. This is not engineering approval."
          : "Revision saved to the project.",
      );
      await refresh();
    });
  const upload = async (file: File) =>
    run(async () => {
      setNotice("Registering upload…");
      const p = await api("uploads", "POST", {
        projectId,
        filename: file.name,
        size: file.size,
      });
      if (p.local) {
        const r = await fetch(`/api/plans/${p.planId}/local`, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": "application/pdf" },
        });
        if (!r.ok) throw new Error((await r.json()).error);
      } else {
        const { upload } = await import("@vercel/blob/client");
        await upload(p.key, file, {
          access: "private",
          handleUploadUrl: "/api/blob-upload",
          multipart: true,
          onUploadProgress: ({ percentage }) =>
            setNotice(`Uploading ${Math.round(percentage)}%…`),
        });
      }
      setNotice("Upload stored. Indexing source sheets…");
      await api(`plans/${p.planId}/complete`, "POST", {});
      await refresh();
      setTab("sheets");
    });
  const add = (kind: string) => {
    const l = model.levels.find((l) => l.id === levelId) || model.levels[0];
    if (!l && kind !== "floor") {
      setError("Add a floor first.");
      return;
    }
    const result = addElement(model, kind, l?.id ?? "", 0, 0);
    change(result.model);
    setSelected(result.id);
  };
  const element = [
    ...model.walls,
    ...model.openings,
    ...model.levels,
    ...model.components,
    ...model.roofs,
  ].find((e) => e.id === selected);
  const patch = (updates: Record<string, unknown>) => {
    const selectedWall = model.walls.find((w) => w.id === selected);
    if (selectedWall && ("height" in updates || "thickness" in updates)) {
      change(
        transformElement(model, selectedWall.id, {
          dx: 0,
          dy: 0,
          dz: 0,
          rotation: 0,
          sx: 1,
          sy:
            "height" in updates
              ? Number(updates.height) / selectedWall.height
              : 1,
          sz:
            "thickness" in updates
              ? Number(updates.thickness) / selectedWall.thickness
              : 1,
        }),
      );
      return;
    }
    const next = structuredClone(model);
    for (const items of [
      next.walls,
      next.openings,
      next.levels,
      next.components,
      next.roofs,
    ]) {
      const e = items.find((e) => e.id === selected);
      if (e) Object.assign(e, updates);
    }
    change(next);
  };
  const wall = model.walls.find((w) => w.id === selected),
    opening = model.openings.find((o) => o.id === selected),
    component = model.components.find((c) => c.id === selected),
    level = model.levels.find((l) => l.id === selected);
  const framingAssembly = model.framingAssemblies?.find(
    (a) => a.wallId === selected || a.componentIds.includes(selected ?? ""),
  );
  const field = (
    label: string,
    value: number,
    onChange: (n: number) => void,
  ) => (
    <label className="field" key={label}>
      {label} <span>ft</span>
      <input
        type="number"
        step="0.125"
        value={Math.round(feet(value) * 10000) / 10000}
        onChange={(e) => {
          if (e.target.value !== "") onChange(Number(e.target.value) * 304.8);
        }}
      />
    </label>
  );
  const unresolved = model.issues.filter((i) => !i.resolved),
    validation = validateModel(model),
    hasErrors = validation.some((i) => i.severity === "error");
  return (
    <div className="app-shell">
      {dialog}
      <header className="masthead">
        <Brand />
        <div className="mastnote">
          PROJECT STUDIO <span>INVITED PILOT</span>
        </div>
        <div className="account">
          {session?.local
            ? "Local development"
            : session?.user.email || "Private workspace"}{" "}
          <a href="/sign-in">Account</a>
        </div>
      </header>
      {session?.local && (
        <div className="local-note">
          Local workspace · Google login and paid AI are disabled until
          configured. Project files stay on this computer.
        </div>
      )}
      <div className="workspace">
        <aside className="projects">
          <div className="section-label">YOUR PROJECTS</div>
          <button className="primary" onClick={() => create()}>
            ＋ New project
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={"project-link " + (projectId === p.id ? "active" : "")}
              onClick={() => run(() => chooseProject(p.id))}
            >
              {p.name}
              <span>Open workspace ↗</span>
            </button>
          ))}
          <button className="quiet" onClick={() => create(true)}>
            Try the sample model
          </button>
          <div className="sidebar-foot">
            Plans → evidence → editable model.
            <br />
            Human judgment stays in the loop.
          </div>
          {session?.user.role === "admin" && (
            <button
              className="quiet"
              onClick={async () => {
                const email = await prompt(
                  "Email to allow into the pilot (any email provider)",
                );
                if (email)
                  run(async () => {
                    await api("invitations", "POST", {
                      email,
                      role: "reviewer",
                    });
                    setNotice(
                      "Pilot access granted. Share the application URL; they can sign in using Google or an email verification code.",
                    );
                  });
              }}
            >
              Grant pilot access
            </button>
          )}
        </aside>
        <main>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {!projectId ? (
            <section className="welcome">
              <div className="eyebrow">AI-POWERED STRUCTURAL FRAMING</div>
              <h1>
                Your plans.
                <br />
                Precision in view.
              </h1>
              <p>
                Bring your drawings into one workspace. Review source sheets,
                refine your framing model, and explore a preliminary estimate.
                Every correction stays with your project.
              </p>
              <div className="actions">
                <button className="primary" onClick={() => create()}>
                  Create a project ↗
                </button>
                <button onClick={() => create(true)}>Explore the editor</button>
              </div>
              <div className="welcome-grid">
                <article>
                  <b>01 / Upload</b>
                  <p>Your plan set, stored privately.</p>
                </article>
                <article>
                  <b>02 / Interpret</b>
                  <p>Selected sheets become a traceable draft.</p>
                </article>
                <article>
                  <b>03 / Review & estimate</b>
                  <p>
                    Review the framing and adjust sample pricing before sharing.
                  </p>
                </article>
              </div>
            </section>
          ) : (
            <>
              <section className="project-heading">
                <div>
                  <div className="eyebrow">PROJECT WORKSPACE</div>
                  <h1>{detail?.project.name || "Loading…"}</h1>
                  <p>
                    Editable review model · not construction or engineering
                    approval
                  </p>
                </div>
                <div className="actions">
                  <label
                    className={"button primary " + (busy ? "disabled" : "")}
                  >
                    Upload PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      hidden
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.files?.[0]) upload(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button disabled={busy} onClick={() => save()}>
                    {dirty ? "Save changes" : "Save revision"}
                  </button>
                </div>
              </section>
              <div className="tabs">
                {(
                  ["model", "sheets", "schedule", "estimate", "review"] as const
                ).map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t === "model"
                      ? "3D model"
                      : t === "sheets"
                        ? "Source sheets"
                        : t === "schedule"
                          ? "Opening schedule"
                          : t === "estimate"
                            ? "Estimate"
                            : `Review (${unresolved.length})`}
                  </button>
                ))}
                <span>
                  {dirty
                    ? "● Unsaved changes"
                    : viewedRevision
                      ? "Saved revision"
                      : "No model yet"}
                </span>
              </div>
              {tab === "estimate" && (
                <EstimatePanel
                  model={model}
                  revision={viewedRevision}
                  dirty={dirty}
                  onSettings={(estimate) => change({ ...model, estimate })}
                />
              )}
              {tab === "model" && (
                <>
                  <div className="framing-controls">
                    <div
                      className="toolgroup"
                      role="group"
                      aria-label="Model display"
                    >
                      <button
                        className={framing ? "active" : ""}
                        aria-pressed={framing}
                        onClick={() => setFraming(true)}
                      >
                        Framing view
                      </button>
                      <button
                        className={!framing ? "active" : ""}
                        aria-pressed={!framing}
                        onClick={() => setFraming(false)}
                      >
                        Building shell
                      </button>
                    </div>
                    {framing && (
                      <label>
                        Preview spacing{" "}
                        <select
                          aria-label="Framing spacing"
                          value={spacing}
                          onChange={(e) => setSpacing(Number(e.target.value))}
                        >
                          <option value={406.4}>16 in. on center</option>
                          <option value={609.6}>24 in. on center</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {framing && (
                    <div className="framing-note">
                      <strong>Illustrative framing</strong> · Studs, tracks,
                      opening headers, and floor joists generated from the
                      shell. Spacing and member sizes are preview assumptions,
                      not engineered specifications. Click a stud, track, or
                      header to edit that member. First selection saves that
                      wall’s layout as individual components; spacing and
                      opening changes no longer regenerate it. Floor and roof
                      members still select their assembly. Save your changes
                      before leaving.
                      <div className="frame-legend">
                        <span>● Studs</span>
                        <span>● Tracks / joists</span>
                        <span>● Headers / openings</span>
                      </div>
                    </div>
                  )}
                  <div className="toolbar">
                    <div className="toolgroup">
                      {(["translate", "rotate", "scale"] as const).map(
                        (m, i) => (
                          <button
                            key={m}
                            className={mode === m ? "active" : ""}
                            onClick={() => setMode(m)}
                          >
                            {["Move", "Rotate", "Resize"][i]}
                          </button>
                        ),
                      )}
                    </div>
                    <button onClick={undo} disabled={!past.length}>
                      ↶ Undo
                    </button>
                    <button onClick={redo} disabled={!future.length}>
                      ↷ Redo
                    </button>
                    <button onClick={() => setTop(!top)}>
                      {top ? "Perspective" : "Top view"}
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={roofVisible}
                        onChange={(e) => setRoofVisible(e.target.checked)}
                      />{" "}
                      Roofs
                    </label>
                    <select
                      aria-label="Visible floor"
                      value={levelId}
                      onChange={(e) => setLevelId(e.target.value)}
                    >
                      <option value="">All floors</option>
                      {model.levels.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="editor">
                    <aside className="palette">
                      <div className="section-label">ADD TO MODEL</div>
                      <p>Drag onto the model, or click to add.</p>
                      {[
                        "floor",
                        "wall",
                        "door",
                        "window",
                        "roof",
                        "stud",
                        "track",
                        "header",
                        "joist",
                      ].map((kind) => (
                        <button
                          key={kind}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData(
                              "application/fraaime-component",
                              kind,
                            )
                          }
                          onClick={() => add(kind)}
                        >
                          ＋ {kind}
                        </button>
                      ))}
                      <div className="fineprint">
                        Framing components are manual placeholders, not
                        engineered assemblies.
                      </div>
                    </aside>
                    <div className="viewport">
                      <Viewer
                        model={model}
                        selected={selected}
                        mode={mode}
                        levelId={levelId}
                        roofVisible={roofVisible}
                        framing={framing}
                        spacing={spacing}
                        top={top}
                        onSelect={setSelected}
                        onChange={change}
                        onError={setError}
                        onEditMember={(wallId, index) => {
                          try {
                            const result = editWallMember(
                              model,
                              wallId,
                              index,
                              spacing,
                            );
                            change(result.model);
                            setSelected(result.id);
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Unable to edit member",
                            );
                          }
                        }}
                      />
                      <div className="viewport-caption">
                        Select an element, then drag its handles. W move · E
                        rotate · R resize
                      </div>
                    </div>
                    <aside className="inspector">
                      <div className="section-label">
                        {element ? "SELECTED ELEMENT" : "MODEL INSPECTOR"}
                      </div>
                      {!element ? (
                        <>
                          <h3>Make it your own.</h3>
                          <p>
                            Select a wall, opening, floor, or component to edit
                            its dimensions and placement.
                          </p>
                          <div className="stats">
                            <b>{model.walls.length}</b> walls{" "}
                            <b>{model.openings.length}</b> openings
                          </div>
                          {model.detailProvenance && (
                            <p className="fineprint">
                              {
                                model.walls.filter((w) => w.role === "interior")
                                  .length
                              }{" "}
                              interior partitions · {model.roofs.length} roof
                              surfaces. Traced geometry needs review; inspect
                              roof assumptions in the review list.
                            </p>
                          )}
                          <select
                            aria-label="Select model element"
                            value=""
                            onChange={(e) => setSelected(e.target.value)}
                          >
                            <option value="">Choose an element…</option>
                            {[
                              ...model.levels,
                              ...model.walls,
                              ...model.openings,
                              ...model.components,
                              ...model.roofs,
                            ].map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.label}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          {"approximation" in element &&
                          element.approximation ? (
                            <p className="fineprint">
                              Roof assumptions: {element.approximation}
                            </p>
                          ) : null}
                          <label className="field">
                            Name
                            <input
                              value={element.label}
                              onChange={(e) => patch({ label: e.target.value })}
                            />
                          </label>
                          {wall && (
                            <>
                              {field("Length", length(wall), (n) =>
                                change(
                                  transformElement(model, wall.id, {
                                    dx: 0,
                                    dy: 0,
                                    dz: 0,
                                    rotation: 0,
                                    sx: n / length(wall),
                                    sy: 1,
                                    sz: 1,
                                  }),
                                ),
                              )}
                              {field("Height", wall.height, (n) =>
                                patch({ height: n }),
                              )}
                              {field("Thickness", wall.thickness, (n) =>
                                patch({ thickness: n }),
                              )}
                              <label className="field">
                                Orientation · degrees
                                <input
                                  type="number"
                                  value={Math.round(
                                    (Math.atan2(
                                      wall.end[1] - wall.start[1],
                                      wall.end[0] - wall.start[0],
                                    ) *
                                      180) /
                                      Math.PI,
                                  )}
                                  onChange={(e) =>
                                    change(
                                      transformElement(model, wall.id, {
                                        dx: 0,
                                        dy: 0,
                                        dz: 0,
                                        rotation:
                                          (Number(e.target.value) * Math.PI) /
                                            180 -
                                          Math.atan2(
                                            wall.end[1] - wall.start[1],
                                            wall.end[0] - wall.start[0],
                                          ),
                                        sx: 1,
                                        sy: 1,
                                        sz: 1,
                                      }),
                                    )
                                  }
                                />
                              </label>
                            </>
                          )}
                          {opening && (
                            <>
                              <label className="field">
                                Schedule tag
                                <input
                                  value={opening.tag}
                                  onChange={(e) =>
                                    patch({ tag: e.target.value })
                                  }
                                />
                              </label>
                              <label className="field">
                                Attached wall
                                <select
                                  value={opening.wallId ?? ""}
                                  onChange={(e) =>
                                    patch({
                                      wallId: e.target.value || null,
                                      levelId:
                                        model.walls.find(
                                          (w) => w.id === e.target.value,
                                        )?.levelId ?? null,
                                    })
                                  }
                                >
                                  <option value="">Unplaced</option>
                                  {model.walls.map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {field("Offset from start", opening.offset, (n) =>
                                patch({ offset: n }),
                              )}
                              {field("Width", opening.width, (n) =>
                                patch({ width: n }),
                              )}
                              {field("Height", opening.height, (n) =>
                                patch({ height: n }),
                              )}
                              {field("Sill", opening.sill, (n) =>
                                patch({ sill: n }),
                              )}
                            </>
                          )}
                          {component && (
                            <>
                              {field("Position X", component.center[0], (n) =>
                                patch({ center: [n, component.center[1]] }),
                              )}
                              {field("Position Z", component.center[1], (n) =>
                                patch({ center: [component.center[0], n] }),
                              )}
                              {field("Length", component.length, (n) =>
                                patch({ length: n }),
                              )}
                              {field("Height", component.height, (n) =>
                                patch({ height: n }),
                              )}
                              {field("Depth", component.depth, (n) =>
                                patch({ depth: n }),
                              )}
                              {field("Elevation", component.elevation, (n) =>
                                patch({ elevation: n }),
                              )}
                              <label className="field">
                                Orientation · degrees
                                <input
                                  type="number"
                                  value={
                                    Math.round(component.rotation * 100) / 100
                                  }
                                  onChange={(e) =>
                                    patch({ rotation: Number(e.target.value) })
                                  }
                                />
                              </label>
                            </>
                          )}
                          {framingAssembly && (
                            <div className="framing-note">
                              <strong>Custom wall framing</strong>
                              <br />
                              Each member is saved independently. Moving or
                              resizing the wall carries its members with it.
                              Changing openings requires manual adjustment or a
                              reset.
                              <button
                                onClick={async () => {
                                  if (
                                    await confirm(
                                      "Reset this wall’s framing? This removes its custom members and rebuilds the preview at the current spacing. You can undo this action.",
                                    )
                                  ) {
                                    change(
                                      resetWallFraming(
                                        model,
                                        framingAssembly.wallId,
                                      ),
                                    );
                                    setSelected(framingAssembly.wallId);
                                  }
                                }}
                              >
                                Reset wall framing
                              </button>
                            </div>
                          )}
                          {level && (
                            <>
                              {field("Elevation", level.elevation, (n) =>
                                patch({ elevation: n }),
                              )}
                              {field("Story height", level.height, (n) =>
                                patch({ height: n }),
                              )}
                              <button
                                onClick={async () => {
                                  const value = await prompt(
                                    "Floor outline: array of [x,z] coordinates in millimeters",
                                    JSON.stringify(level.outline),
                                  );
                                  if (value)
                                    try {
                                      patch({ outline: JSON.parse(value) });
                                    } catch {
                                      setError("Invalid outline JSON");
                                    }
                                }}
                              >
                                Edit outline
                              </button>
                              <button
                                onClick={async () => {
                                  const value = await prompt(
                                    "Voids: array of outline arrays in millimeters",
                                    JSON.stringify(level.voids),
                                  );
                                  if (value)
                                    try {
                                      patch({ voids: JSON.parse(value) });
                                    } catch {
                                      setError("Invalid void JSON");
                                    }
                                }}
                              >
                                Edit floor voids
                              </button>
                            </>
                          )}
                          <div className="actions">
                            <button
                              onClick={async () => {
                                const next = structuredClone(model),
                                  newId = crypto.randomUUID();
                                for (const key of [
                                  "walls",
                                  "openings",
                                  "components",
                                  "roofs",
                                ] as const) {
                                  const e = next[key].find(
                                    (e) => e.id === selected,
                                  );
                                  if (e)
                                    (next[key] as unknown[]).push({
                                      ...e,
                                      id: newId,
                                      label: e.label + " copy",
                                    });
                                }
                                change(next);
                                setSelected(newId);
                              }}
                              disabled={!!level}
                            >
                              Duplicate
                            </button>
                            <button
                              className="danger"
                              onClick={async () => {
                                change(removeElement(model, element.id));
                                setSelected(null);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                          <div className="section-label">SOURCE EVIDENCE</div>
                          {element.evidence.length ? (
                            element.evidence.map((e, i) => (
                              <button
                                className="evidence"
                                key={i}
                                onClick={() =>
                                  setSource({
                                    planId: e.planId,
                                    page: e.page,
                                    region: e.region,
                                  })
                                }
                              >
                                {e.sheet || "Source sheet"} · page {e.page}
                                <small>{e.note}</small>
                              </button>
                            ))
                          ) : (
                            <p className="fineprint">
                              Manually added or illustrative geometry. No
                              drawing evidence attached.
                            </p>
                          )}
                        </>
                      )}
                    </aside>
                  </div>
                  <div className="model-footer">
                    <span>
                      {model.levels.length} floors · {model.walls.length} walls
                      · {model.openings.length} openings
                      {model.detailProvenance &&
                        ` · ${model.roofs.length} roof surfaces`}
                    </span>
                    <button
                      onClick={async () => {
                        const blob = new Blob(
                          [JSON.stringify(model, null, 2)],
                          { type: "application/json" },
                        );
                        const url = URL.createObjectURL(blob),
                          a = document.createElement("a");
                        a.href = url;
                        a.download = "fraaime-model.json";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      Export model JSON ↓
                    </button>
                    <label className="button">
                      Import JSON
                      <input
                        hidden
                        type="file"
                        accept=".json"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            try {
                              change(
                                ModelSchema.parse(
                                  JSON.parse(await file.text()),
                                ),
                              );
                            } catch {
                              setError(
                                "This file is not a valid Fraaime model.",
                              );
                            }
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </>
              )}
              {tab === "sheets" && (
                <section className="panel">
                  <h2>Source sheets & processing</h2>
                  <p>
                    {session?.shellFusion
                      ? "Floor plans, elevations, sections, roof plans, and opening schedules are selected automatically. Up to 24 sheets feed three budgeted stages: shell, walls/roofs, and door/window placement. Review supporting drawings before processing."
                      : "Choose the drawings needed for the shell and schedules."}{" "}
                    Processing continues when this page is closed.
                  </p>
                  {!detail?.plans.length && <p>No PDF uploaded yet.</p>}
                  {detail?.plans.map((plan) => (
                    <article className="plan" key={plan.id}>
                      <div className="plan-title">
                        <h3>{plan.filename}</h3>
                        <a
                          href={`/api/plans/${plan.id}/source`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open PDF ↗
                        </a>
                      </div>
                      {detail.jobs
                        .filter((j) => j.plan_id === plan.id)
                        .map((j) => (
                          <div className="job" key={j.id}>
                            <div>
                              <b>{j.phase}</b>
                              <span className="badge">
                                {j.state.replaceAll("_", " ")}
                              </span>
                              <span>
                                {" "}
                                {j.completed_pages.length} pages completed · $
                                {Number(j.spend).toFixed(3)} accounted /
                                reserved
                              </span>
                            </div>
                            {j.error && <p className="error-text">{j.error}</p>}
                            {j.state === "failed" && (
                              <button
                                disabled={
                                  busy ||
                                  (pendingByPlan[plan.id] ?? []).length > 0 ||
                                  plan.manifest?.indexingComplete === false
                                }
                                onClick={async () => {
                                  if (
                                    await confirm(
                                      "Start a separate extraction? Completed or uncertain API calls may be charged again.",
                                    )
                                  )
                                    run(async () => {
                                      await api(`jobs/${j.id}/new`, "POST", {
                                        pages: selections[plan.id] ?? j.pages,
                                      });
                                      await refresh();
                                    });
                                }}
                              >
                                Start separate extraction
                              </button>
                            )}
                            {["preparing", "extracting"].includes(j.state) ? (
                              <button
                                onClick={() =>
                                  run(async () => {
                                    await api(
                                      `jobs/${j.id}/cancel`,
                                      "POST",
                                      {},
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                disabled={
                                  busy ||
                                  ((j.state === "needs_review" ||
                                    j.state === "needs_selection") &&
                                    ((pendingByPlan[plan.id] ?? []).length >
                                      0 ||
                                      plan.manifest?.indexingComplete ===
                                        false))
                                }
                                onClick={() =>
                                  run(async () => {
                                    await api(`jobs/${j.id}/run`, "POST", {
                                      pages: selections[plan.id] ?? j.pages,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                {j.state === "needs_selection"
                                  ? "Process selected sheets"
                                  : j.state === "needs_review"
                                    ? "Create new AI draft"
                                    : "Resume processing"}
                              </button>
                            )}
                          </div>
                        ))}
                      {!detail.jobs.some((j) => j.plan_id === plan.id) && (
                        <button
                          onClick={() =>
                            run(async () => {
                              await api(
                                `plans/${plan.id}/complete`,
                                "POST",
                                {},
                              );
                              await refresh();
                            })
                          }
                        >
                          Index sheets
                        </button>
                      )}
                      {plan.manifest && (
                        <>
                          <p className="fineprint">
                            {plan.manifest.pageCount} sheets ·{" "}
                            {selections[plan.id]?.length ?? 0} selected. Floor
                            plans, sections, elevations, roof plans, and
                            schedules are selected automatically for new
                            uploads. You can adjust the selection before
                            processing. Confirm sheet selection and scales
                            during review.{" "}
                            {session?.shellFusion
                              ? "Select 2–24 sheets. Existing drafts stay saved when you create a new one."
                              : "Maximum 30 pages per extraction run."}
                          </p>
                          <section
                            className="sheet-review"
                            aria-label="Unclassified drawing review"
                          >
                            <h3>Review unclassified pages before generating</h3>
                            <p>
                              {(pendingByPlan[plan.id] ?? []).length} pages
                              awaiting a decision. Open each drawing, then
                              select its checkbox to include it, or choose
                              “Reviewed: exclude” and record a reason. Title OCR
                              failure does not prevent a selected drawing from
                              reaching the AI.
                            </p>
                            <label>
                              <input
                                type="checkbox"
                                checked={reviewOnly[plan.id] ?? false}
                                onChange={(e) =>
                                  setReviewOnly((prev) => ({
                                    ...prev,
                                    [plan.id]: e.target.checked,
                                  }))
                                }
                              />{" "}
                              Show only pages needing a decision
                            </label>
                            {!(pendingByPlan[plan.id] ?? []).length && (
                              <p role="status">
                                All unclassified pages are included or
                                explicitly excluded. Check the full selected set
                                before generating.
                              </p>
                            )}
                          </section>
                          {selectionWarnings(
                            plan.manifest,
                            selections[plan.id] ?? [],
                          ).map((message) => (
                            <p className="error-text" key={message}>
                              {message}
                            </p>
                          ))}
                          <p className="fineprint">
                            After creating a new AI draft, choose it in Model
                            revisions to compare it with your saved model.
                          </p>
                          {plan.manifest.sheets.some(needsTitleOcr) &&
                            detail.jobs.some((j) => j.plan_id === plan.id) && (
                              <button
                                className="quiet"
                                disabled={
                                  busy ||
                                  detail.jobs.some(
                                    (j) =>
                                      j.plan_id === plan.id &&
                                      ["preparing", "extracting"].includes(
                                        j.state,
                                      ),
                                  )
                                }
                                onClick={() =>
                                  run(async () => {
                                    const job = detail.jobs.find(
                                      (j) => j.plan_id === plan.id,
                                    )!;
                                    await api(
                                      `jobs/${job.id}/index`,
                                      "POST",
                                      {},
                                    );
                                    setPageSelections((prev) => {
                                      const next = { ...prev };
                                      delete next[plan.id];
                                      return next;
                                    });
                                    setNotice(
                                      "Reading drawing titles with OCR. Suggestions will update when indexing finishes; saved models are unchanged.",
                                    );
                                    await refresh();
                                  })
                                }
                              >
                                Read unreadable titles (OCR)
                              </button>
                            )}
                          {plan.manifest.indexingComplete === false && (
                            <p className="fineprint">
                              Reading sheet titles. Suggestions update as OCR
                              completes; wait for indexing to finish before
                              processing.
                            </p>
                          )}
                          <button
                            className="quiet"
                            disabled={plan.manifest.indexingComplete === false}
                            onClick={() =>
                              setPageSelections((prev) => ({
                                ...prev,
                                [plan.id]: suggestedPlanPages(
                                  plan.manifest,
                                  session?.shellFusion ? MAX_SHELL_PAGES : 30,
                                ),
                              }))
                            }
                          >
                            Use suggested sheets
                          </button>
                          {plan.manifest.sheets.filter((sheet) =>
                            SHELL_SHEET_KINDS.some(
                              (kind) => kind === sheetKind(sheet),
                            ),
                          ).length >
                            (session?.shellFusion ? MAX_SHELL_PAGES : 30) && (
                            <p className="fineprint">
                              This PDF has more relevant sheets than fit in one
                              run. The suggestion keeps all detected floor plans
                              and required architectural sheets/schedules.
                              Choose a smaller coherent package explicitly; no
                              primary sheets are silently dropped. Optional
                              supporting sheets may be omitted.
                            </p>
                          )}
                          {session?.shellFusion &&
                            (selections[plan.id]?.length ?? 0) >
                              MAX_SHELL_PAGES && (
                              <p className="error-text">
                                More than {MAX_SHELL_PAGES} sheets are selected.
                                Split the project into a coherent set before
                                processing.
                              </p>
                            )}
                          {!plan.manifest.sheets.some(
                            (sheet) => sheetKind(sheet) === "floor-plan",
                          ) && (
                            <p className="fineprint">
                              No floor plans were detected automatically. Select
                              the relevant sheets below; OCR may still be
                              running, or titles may need manual review.
                            </p>
                          )}
                          <div className="sheet-grid">
                            {plan.manifest.sheets
                              .filter(
                                (s) =>
                                  !reviewOnly[plan.id] ||
                                  (pendingByPlan[plan.id] ?? []).some(
                                    (p) => p.page === s.page,
                                  ),
                              )
                              .map((s) => (
                                <div className="sheet" key={s.page}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      disabled={
                                        busy ||
                                        plan.manifest?.indexingComplete ===
                                          false
                                      }
                                      checked={(
                                        selections[plan.id] ?? []
                                      ).includes(s.page)}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setPageSelections((prev) => ({
                                          ...prev,
                                          [plan.id]: checked
                                            ? [
                                                ...new Set([
                                                  ...(prev[plan.id] ??
                                                    selections[plan.id] ??
                                                    []),
                                                  s.page,
                                                ]),
                                              ]
                                            : (
                                                prev[plan.id] ??
                                                selections[plan.id] ??
                                                []
                                              ).filter((p) => p !== s.page),
                                        }));
                                        if (needsSheetDecision(s))
                                          run(async () => {
                                            await api(
                                              `plans/${plan.id}/review`,
                                              "POST",
                                              {
                                                page: s.page,
                                                decision: checked
                                                  ? "include"
                                                  : "reset",
                                                reason: checked
                                                  ? "Included for model evidence"
                                                  : "Reopened for review",
                                              },
                                            );
                                            await refresh();
                                          });
                                      }}
                                    />
                                    <b>{s.sheet || `Page ${s.page}`}</b>
                                  </label>
                                  <span>
                                    {sheetKind(s)} {s.scanned ? "· scan" : ""}{" "}
                                    {s.ocr
                                      ? `· OCR ${s.ocr.status === "complete" ? "read" : s.ocr.status}`
                                      : ""}
                                  </span>
                                  {s.ocr?.status === "complete" && (
                                    <span className="fineprint">
                                      OCR title:{" "}
                                      {s.ocr.lines
                                        .slice(0, 3)
                                        .map((line) => line.text)
                                        .join(" · ")}
                                    </span>
                                  )}
                                  {s.ocr?.error && (
                                    <span className="error-text">
                                      {s.ocr.error}
                                    </span>
                                  )}
                                  {s.review?.decision === "exclude" && (
                                    <span className="fineprint">
                                      Reviewed: excluded · {s.review.reason}
                                    </span>
                                  )}
                                  {needsSheetDecision(s) &&
                                    !(selections[plan.id] ?? []).includes(
                                      s.page,
                                    ) &&
                                    s.review?.decision !== "exclude" && (
                                      <span className="error-text">
                                        Decision required before generation
                                      </span>
                                    )}
                                  <button
                                    onClick={() =>
                                      setSource({
                                        planId: plan.id,
                                        page: s.page,
                                      })
                                    }
                                  >
                                    View page {s.page} ↗
                                  </button>
                                  {needsSheetDecision(s) && (
                                    <button
                                      className="quiet"
                                      disabled={
                                        busy ||
                                        plan.manifest?.indexingComplete ===
                                          false
                                      }
                                      onClick={() =>
                                        reviewSheet(
                                          plan.id,
                                          s.page,
                                          s.review?.decision === "exclude"
                                            ? "reset"
                                            : "exclude",
                                        )
                                      }
                                    >
                                      {s.review?.decision === "exclude"
                                        ? "Reopen review"
                                        : "Reviewed: exclude"}
                                    </button>
                                  )}
                                </div>
                              ))}
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {tab === "schedule" && (
                <section className="panel">
                  <h2>Opening schedule</h2>
                  <p>
                    Dimensions reflect this model revision. Check source
                    evidence before relying on them.
                  </p>
                  {!!model.scheduleEntries?.length && (
                    <>
                      <h3>Source schedule rows</h3>
                      <p>
                        Quantities are from the schedule. They do not create
                        placed openings. Unknown values need review.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Tag</th>
                              <th>Kind / tag meaning</th>
                              <th>Quantity</th>
                              <th>Width × height</th>
                              <th>Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {model.scheduleEntries.map((o) => (
                              <tr key={o.id}>
                                <td>{o.tag}</td>
                                <td>
                                  {o.kind} / {o.tagRole}
                                </td>
                                <td>{o.quantity ?? "Unknown"}</td>
                                <td>
                                  {o.width === null
                                    ? "Unknown"
                                    : formatFeet(o.width)}{" "}
                                  ×{" "}
                                  {o.height === null
                                    ? "Unknown"
                                    : formatFeet(o.height)}
                                </td>
                                <td>
                                  {o.evidence.map((e, i) => (
                                    <button
                                      key={i}
                                      onClick={() =>
                                        setSource({
                                          planId: e.planId,
                                          page: e.page,
                                          region: e.region,
                                        })
                                      }
                                    >
                                      {e.sheet || `Page ${e.page}`}
                                    </button>
                                  ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <h3>Individual model openings</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tag</th>
                          <th>Type</th>
                          <th>Width × height</th>
                          <th>Placement</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.openings.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <button
                                onClick={async () => {
                                  setSelected(o.id);
                                  setTab("model");
                                }}
                              >
                                {o.tag}
                              </button>
                            </td>
                            <td>{o.kind}</td>
                            <td>
                              {formatFeet(o.width)} × {formatFeet(o.height)}
                            </td>
                            <td>{o.wallId ? "Placed" : "Needs placement"}</td>
                            <td>
                              {o.evidence.map((e, i) => (
                                <button
                                  key={i}
                                  onClick={() =>
                                    setSource({
                                      planId: e.planId,
                                      page: e.page,
                                      region: e.region,
                                    })
                                  }
                                >
                                  {e.sheet || `Page ${e.page}`}
                                </button>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === "review" && (
                <section className="panel">
                  <h2>Review before you rely on it.</h2>
                  <p>
                    Resolve uncertainty against the drawings. Marking reviewed
                    records a human decision, not engineering approval.
                  </p>
                  <h3>Drawing scales</h3>
                  {!model.calibrations.length && (
                    <p className="fineprint">
                      No extracted calibrations. Manually added and imported
                      demo geometry remain illustrative.
                    </p>
                  )}
                  {model.calibrations.map((c, i) => (
                    <div className="issue" key={i}>
                      <b>Page {c.page}</b>
                      <p>
                        {c.dimensionText} · {c.mmPerPoint ?? "Unknown"} mm / PDF
                        point
                      </p>
                      <label>
                        <input
                          type="checkbox"
                          checked={c.confirmed}
                          onChange={(e) => {
                            const next = structuredClone(model);
                            next.calibrations[i].confirmed = e.target.checked;
                            change(next);
                          }}
                        />{" "}
                        I checked this drawing scale against a dimension
                      </label>
                    </div>
                  ))}
                  {!!model.unresolvedObservations?.length && (
                    <>
                      <h3>Observations needing geometry review</h3>
                      <p>
                        These observations are retained but are not drawn. Check
                        their source before adding or correcting model geometry.
                      </p>
                      {model.unresolvedObservations.map((o, index) => (
                        <details className="issue" key={`${o.id}-${index}`}>
                          <summary>
                            {o.label || o.id} · {o.kind}
                          </summary>
                          <p>{o.reason}</p>
                          {o.evidence.map((e, i) => (
                            <button
                              key={i}
                              onClick={() =>
                                setSource({
                                  planId: e.planId,
                                  page: e.page,
                                  region: e.region,
                                })
                              }
                            >
                              View {e.sheet || `page ${e.page}`}
                            </button>
                          ))}
                        </details>
                      ))}
                    </>
                  )}
                  <h3>Model checks</h3>
                  {validation.map((i, n) => (
                    <div className="issue" key={n}>
                      <b>{i.severity}</b> {i.message}
                      {i.elementId && (
                        <button
                          onClick={async () => {
                            setSelected(i.elementId);
                            setTab("model");
                          }}
                        >
                          Inspect element
                        </button>
                      )}
                    </div>
                  ))}
                  {model.issues.map((i) => (
                    <div
                      className={"issue " + (i.resolved ? "resolved" : "")}
                      key={i.id}
                    >
                      <b>{i.severity}</b>
                      <p>{i.message}</p>
                      <p className="fineprint">{i.resolution}</p>
                      <button
                        onClick={async () => {
                          const reason = i.resolved
                            ? ""
                            : await prompt(
                                "Describe the correction or reason this issue is accepted",
                              );
                          if (
                            reason === null ||
                            (!i.resolved && !reason?.trim())
                          )
                            return;
                          const next = structuredClone(model),
                            issue = next.issues.find((x) => x.id === i.id)!;
                          issue.resolved = !i.resolved;
                          issue.resolution = reason || "";
                          change(next);
                        }}
                      >
                        {i.resolved ? "Reopen issue" : "Resolve with a note"}
                      </button>
                    </div>
                  ))}
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      hasErrors ||
                      unresolved.length > 0 ||
                      model.calibrations.some((c) => !c.confirmed) ||
                      session?.user.role === "customer"
                    }
                    onClick={() => save(true)}
                  >
                    Save as reviewed
                  </button>
                </section>
              )}
              <section className="revision-bar">
                <label>
                  Model revisions{" "}
                  <select
                    value={viewedRevision ?? ""}
                    onChange={(e) =>
                      run(async () => {
                        if (dirty && !(await confirm("Discard unsaved edits?")))
                          return;
                        await loadModel(projectId, e.target.value);
                        setBaseId(detail?.project.head_id ?? null);
                      })
                    }
                  >
                    <option value="">Choose revision…</option>
                    {detail?.revisions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.kind.startsWith("ai") ? "AI draft" : "Saved edit"} ·{" "}
                        {new Date(r.created_at).toLocaleString()}
                        {r.reviewed ? " · reviewed" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() =>
                    run(async () => {
                      const email = await prompt(
                        "Share this project with an invited pilot email",
                      );
                      if (email) {
                        await api(`projects/${projectId}/members`, "POST", {
                          email,
                          role: "reviewer",
                        });
                        await refresh();
                        setNotice("Project access granted.");
                      }
                    })
                  }
                >
                  Manage access
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    if (
                      await confirm(
                        "Delete this project, source PDFs, and saved models?",
                      )
                    )
                      run(async () => {
                        await api("projects/" + projectId, "DELETE");
                        setProjectId("");
                        setDetail(null);
                        setDirty(false);
                        await loadProjects();
                      });
                  }}
                >
                  Delete project
                </button>
              </section>
            </>
          )}
        </main>
      </div>
      {source && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Source sheet"
        >
          <div className="modal-head">
            <b>Source evidence · page {source.page}</b>
            <a
              target="_blank"
              rel="noreferrer"
              href={`/api/plans/${source.planId}/source#page=${source.page}`}
            >
              Open full PDF ↗
            </a>
            <button onClick={() => setSource(null)}>Close ×</button>
          </div>
          <div className="source-image">
            <img
              src={`/api/plans/${source.planId}/page?page=${source.page}`}
              alt={`Source drawing page ${source.page}`}
            />
            {source.region && (
              <div
                className="region"
                style={{
                  left: source.region[0] * 100 + "%",
                  top: source.region[1] * 100 + "%",
                  width: (source.region[2] - source.region[0]) * 100 + "%",
                  height: (source.region[3] - source.region[1]) * 100 + "%",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
