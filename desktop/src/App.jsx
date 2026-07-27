import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  FolderCog,
  KeyRound,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { callBridge } from "./api.js";

const NAV_ITEMS = [
  { id: "providers", label: "Providers", icon: Database },
  { id: "models", label: "Models", icon: Cpu },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "profiles", label: "Profiles", icon: FolderCog },
];

const PAGE_COPY = {
  providers: ["Providers", "Switch endpoints, check connectivity, and manage credentials."],
  models: ["Models", "Control the model catalog exposed to Pi."],
  mcp: ["MCP Servers", "Manage effective server state across Pi configuration layers."],
  skills: ["Skills", "Review explicit skill paths and the capabilities they expose."],
  agents: ["Agents", "Inspect subagent configuration and frontmatter health."],
  profiles: ["Startup Profiles", "Launch Pi with the right working directory and mode."],
};

export default function App() {
  const [view, setView] = useState("providers");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [health, setHealth] = useState({});
  const [focusProvider, setFocusProvider] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("pi-switch-theme") || "system");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await callBridge("dashboard");
      setData(next);
      setFocusProvider(current => current || next.settings.defaultProvider || next.providers[0]?.name || "");
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("pi-switch-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const act = useCallback(async (action, payload, success, options = {}) => {
    setBusy(options.busyKey || action);
    try {
      const result = await callBridge(action, payload);
      if (options.reload !== false) await load({ quiet: true });
      if (success) setToast({ type: "success", message: typeof success === "function" ? success(result) : success });
      return result;
    } catch (err) {
      setToast({ type: "error", message: err?.message || String(err) });
      throw err;
    } finally {
      setBusy("");
    }
  }, [load]);

  const runTest = async name => {
    setHealth(current => ({ ...current, [name]: { loading: true } }));
    try {
      const result = await act("testProvider", { name }, null, { reload: false, busyKey: `test:${name}` });
      setHealth(current => ({ ...current, [name]: result }));
    } catch (err) {
      setHealth(current => ({ ...current, [name]: { ok: false, error: err?.message || String(err) } }));
    }
  };

  const openDoctor = async () => {
    setModal({ type: "doctor", loading: true, findings: [] });
    try {
      const findings = await callBridge("doctor", { probe: false });
      setModal({ type: "doctor", loading: false, findings });
    } catch (err) {
      setModal({ type: "doctor", loading: false, error: err?.message || String(err), findings: [] });
    }
  };

  const counts = useMemo(() => ({
    providers: data?.providers.length,
    models: data?.providers.reduce((total, provider) => total + provider.models.length, 0),
    mcp: data?.mcp.length,
    skills: data?.skillCatalog.length,
    agents: data?.agents.length,
    profiles: data?.profiles.length,
  }), [data]);

  const [title, subtitle] = PAGE_COPY[view];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="traffic-light-space" data-tauri-drag-region />
        <div className="brand" data-tauri-drag-region>
          <div className="brand-mark">PI</div>
          <div>
            <strong>Pi Switch</strong>
            <span>Configuration manager</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {counts[item.id] != null && <small>{counts[item.id]}</small>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <label className="thinking-control">
            <span>Thinking level</span>
            <select
              value={data?.settings.defaultThinkingLevel || "medium"}
              disabled={!data || busy === "setThinking"}
              onChange={event => act("setThinking", { level: event.target.value }, "Thinking level updated")}
            >
              {(data?.thinkingLevels || ["off", "minimal", "low", "medium", "high", "xhigh", "max"]).map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <button className="sidebar-action" onClick={openDoctor}>
            <ShieldCheck size={17} strokeWidth={1.8} />
            <span>Run doctor</span>
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar" data-tauri-drag-region>
          <div className="page-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar-actions">
            {data?.settings.defaultProvider && (
              <div className="active-context" title="Current Pi default">
                <CircleCheck size={16} />
                <span>{data.settings.defaultProvider}</span>
                <b>{data.settings.defaultModel}</b>
              </div>
            )}
            <IconButton label="Refresh" onClick={() => load()} disabled={loading}>
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </IconButton>
            <IconButton label={`Theme: ${theme}`} onClick={() => setTheme(current => current === "system" ? "light" : current === "light" ? "dark" : "system")}>
              {theme === "dark" ? <Moon size={17} /> : theme === "light" ? <Sun size={17} /> : <Settings2 size={17} />}
            </IconButton>
          </div>
        </header>

        <section className="content">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={() => load()} />
          ) : (
            <>
              {view === "providers" && (
                <ProvidersPage
                  data={data}
                  health={health}
                  busy={busy}
                  runTest={runTest}
                  act={act}
                  setModal={setModal}
                />
              )}
              {view === "models" && (
                <ModelsPage
                  data={data}
                  focusProvider={focusProvider}
                  setFocusProvider={setFocusProvider}
                  act={act}
                  setModal={setModal}
                />
              )}
              {view === "mcp" && <McpPage rows={data.mcp} act={act} busy={busy} />}
              {view === "skills" && <SkillsPage data={data} act={act} setModal={setModal} />}
              {view === "agents" && <AgentsPage rows={data.agents} setModal={setModal} />}
              {view === "profiles" && <ProfilesPage rows={data.profiles} act={act} busy={busy} />}
            </>
          )}
        </section>
      </main>

      {modal && (
        <ModalHost
          modal={modal}
          data={data}
          close={() => setModal(null)}
          act={act}
        />
      )}
      {toast && <Toast toast={toast} close={() => setToast(null)} />}
    </div>
  );
}

function ProvidersPage({ data, health, busy, runTest, act, setModal }) {
  const [query, setQuery] = useState("");
  const filtered = data.providers.filter(provider =>
    `${provider.name} ${provider.baseUrl} ${provider.api}`.toLowerCase().includes(query.toLowerCase()),
  );

  const importProviders = async () => {
    const preview = await callBridge("importPreview");
    setModal({ type: "import", preview });
  };

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search providers" />
        <div className="toolbar-actions">
          {data.ccSwitchAvailable && (
            <button className="button secondary" onClick={importProviders}>
              <Database size={16} /> Import
            </button>
          )}
          <button className="button primary" onClick={() => setModal({ type: "providerForm", mode: "add" })}>
            <Plus size={17} /> Add provider
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Database} title="No providers found" action="Add provider" onAction={() => setModal({ type: "providerForm", mode: "add" })} />
      ) : (
        <div className="provider-list">
          {filtered.map(provider => (
            <ProviderRow
              key={provider.name}
              provider={provider}
              health={health[provider.name]}
              testing={busy === `test:${provider.name}`}
              onTest={() => runTest(provider.name)}
              onActivate={() => {
                if (provider.models.length === 1) {
                  act("activateProvider", { provider: provider.name, model: provider.models[0] }, `${provider.name} is now active`);
                } else {
                  setModal({ type: "activate", provider });
                }
              }}
              onEdit={() => setModal({ type: "providerForm", mode: "edit", provider })}
              onKey={() => setModal({ type: "key", provider })}
              onSync={async () => {
                const result = await act("syncProvider", { name: provider.name, apply: false }, null, { reload: false });
                setModal({ type: "sync", provider, result });
              }}
              onDelete={() => setModal({ type: "confirm", title: `Delete ${provider.name}?`, body: "The provider and its models will be removed. A backup is created before the write.", confirmLabel: "Delete provider", danger: true, action: () => act("deleteProvider", { name: provider.name }, "Provider deleted") })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider, health, testing, onTest, onActivate, onEdit, onKey, onSync, onDelete }) {
  const status = provider.isDefault
    ? { className: "success", text: "Current" }
    : !provider.keyOk
      ? { className: "danger", text: "Key issue" }
      : { className: "neutral", text: "Ready" };

  return (
    <article className={`provider-row ${provider.isDefault ? "current" : ""}`}>
      <div className="provider-symbol" aria-hidden="true">{provider.name.slice(0, 2).toUpperCase()}</div>
      <div className="provider-main">
        <div className="provider-title-line">
          <h2>{provider.name}</h2>
          <span className={`badge ${status.className}`}>{status.text}</span>
          <span className="badge outline">{provider.api}</span>
        </div>
        <div className="provider-url">{provider.baseUrl || "No endpoint configured"}</div>
        <div className="provider-meta">
          <span><Box size={14} /> {provider.models.length} model{provider.models.length === 1 ? "" : "s"}</span>
          <span><KeyRound size={14} /> {provider.keyOk ? provider.keySource : provider.keyError}</span>
        </div>
      </div>

      <div className="provider-status">
        <HealthBadge health={health} testing={testing} />
        {provider.isDefault ? (
          <div className="active-model">{provider.defaultModel}</div>
        ) : (
          <button className="button secondary compact" onClick={onActivate} disabled={!provider.keyOk || provider.models.length === 0}>
            <Check size={15} /> Use
          </button>
        )}
      </div>

      <div className="row-actions">
        <IconButton label="Test connection" onClick={onTest} disabled={testing}><Activity size={17} /></IconButton>
        <IconButton label="Sync models" onClick={onSync}><RotateCcw size={17} /></IconButton>
        <IconButton label="Edit provider" onClick={onEdit}><Pencil size={17} /></IconButton>
        <IconButton label="Rotate API key" onClick={onKey}><KeyRound size={17} /></IconButton>
        <IconButton label="Delete provider" onClick={onDelete} danger><Trash2 size={17} /></IconButton>
      </div>
    </article>
  );
}

function HealthBadge({ health, testing }) {
  if (testing || health?.loading) return <div className="health neutral"><LoaderCircle className="spin" size={14} /> Testing</div>;
  if (!health) return <div className="health neutral">Not tested</div>;
  if (!health.ok) return <div className="health danger"><CircleAlert size={14} /> Unavailable</div>;
  if (health.diff?.missing?.length) return <div className="health warning"><TriangleAlert size={14} /> {health.diff.missing.length} missing</div>;
  return <div className="health success"><CircleCheck size={14} /> {health.ms} ms</div>;
}

function ModelsPage({ data, focusProvider, setFocusProvider, act, setModal }) {
  const provider = data.providers.find(item => item.name === focusProvider) || data.providers[0];
  if (!provider) return <EmptyState icon={Cpu} title="Add a provider before adding models" />;

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <label className="select-control">
          <span>Provider</span>
          <select value={provider.name} onChange={event => setFocusProvider(event.target.value)}>
            {data.providers.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        <button className="button primary" onClick={() => setModal({ type: "modelForm", mode: "add", provider: provider.name })}>
          <Plus size={17} /> Add model
        </button>
      </div>

      <div className="table-surface">
        <div className="table-head model-grid">
          <span>Model</span><span>Context</span><span>Output</span><span>Reasoning</span><span>Input</span><span />
        </div>
        {provider.modelObjects.length === 0 ? (
          <EmptyState icon={Cpu} title="No models configured" action="Add model" onAction={() => setModal({ type: "modelForm", mode: "add", provider: provider.name })} />
        ) : provider.modelObjects.map(model => {
          const active = data.settings.defaultProvider === provider.name && data.settings.defaultModel === model.id;
          return (
            <div className={`table-row model-grid ${active ? "active" : ""}`} key={model.id}>
              <div className="model-name"><strong>{model.id}</strong>{active && <span className="badge success">Current</span>}</div>
              <span>{formatTokens(model.contextWindow)}</span>
              <span>{formatTokens(model.maxTokens)}</span>
              <span>{model.reasoning ? "Supported" : "Off"}</span>
              <span>{(model.input || ["text"]).join(", ")}</span>
              <div className="inline-actions">
                {!active && <IconButton label="Use model" onClick={() => act("activateProvider", { provider: provider.name, model: model.id }, `${model.id} is now active`)}><Check size={16} /></IconButton>}
                <IconButton label="Edit model" onClick={() => setModal({ type: "modelForm", mode: "edit", provider: provider.name, model })}><Pencil size={16} /></IconButton>
                <IconButton label="Delete model" danger disabled={active} onClick={() => setModal({ type: "confirm", title: `Delete ${model.id}?`, body: "The model will be removed from this provider.", confirmLabel: "Delete model", danger: true, action: () => act("deleteModel", { provider: provider.name, id: model.id }, "Model deleted") })}><Trash2 size={16} /></IconButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function McpPage({ rows, act, busy }) {
  return (
    <div className="table-surface">
      <div className="table-head mcp-grid"><span>Server</span><span>Command</span><span>Layer</span><span>Lifecycle</span><span>Status</span></div>
      {rows.length === 0 ? <EmptyState icon={Server} title="No MCP servers configured" /> : rows.map(server => (
        <div className="table-row mcp-grid" key={server.name}>
          <div className="server-name"><div className="mini-icon"><Server size={17} /></div><strong>{server.name}</strong></div>
          <code>{server.command}</code>
          <span>{server.effectiveLayer}</span>
          <span>{server.lifecycle}</span>
          <Toggle
            checked={!server.disabled}
            disabled={busy === `mcp:${server.name}`}
            label={`${server.disabled ? "Enable" : "Disable"} ${server.name}`}
            onChange={() => act("toggleMcp", { name: server.name, disabled: !server.disabled }, `${server.name} ${server.disabled ? "enabled" : "disabled"}`, { busyKey: `mcp:${server.name}` })}
          />
        </div>
      ))}
    </div>
  );
}

function SkillsPage({ data, act, setModal }) {
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div className="summary-line"><strong>{data.skillCatalog.length}</strong> skills from <strong>{data.skillPaths.length}</strong> paths</div>
        <div className="toolbar-actions">
          <button className="button secondary" onClick={() => act("pruneSkillPaths", {}, result => result.length ? `Removed ${result.length} missing path(s)` : "No missing paths")}>Prune</button>
          <button className="button primary" onClick={() => setModal({ type: "skillPath" })}><Plus size={17} /> Add path</button>
        </div>
      </div>
      <div className="path-list">
        {data.skillPaths.length === 0 ? <EmptyState icon={Sparkles} title="No explicit skill paths" action="Add path" onAction={() => setModal({ type: "skillPath" })} /> : data.skillPaths.map(path => (
          <article className="path-row" key={path.entry}>
            <div className={`mini-icon ${path.exists ? "" : "error"}`}><FileCode2 size={18} /></div>
            <div className="path-main"><strong>{path.entry}</strong><span>{path.kind} · {path.count} skill{path.count === 1 ? "" : "s"}</span></div>
            <span className={`badge ${path.exists ? "success" : "danger"}`}>{path.exists ? "Available" : "Missing"}</span>
            <IconButton label="Remove path" danger onClick={() => setModal({ type: "confirm", title: "Remove skill path?", body: path.entry, confirmLabel: "Remove path", danger: true, action: () => act("removeSkillPath", { path: path.entry }, "Skill path removed") })}><Trash2 size={16} /></IconButton>
          </article>
        ))}
      </div>
    </div>
  );
}

function AgentsPage({ rows, setModal }) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter(agent => `${agent.name} ${agent.description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page-stack">
      <div className="page-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search agents" /></div>
      <div className="agent-grid">
        {filtered.map(agent => {
          const errors = agent.problems.filter(problem => problem.level === "error").length;
          const warnings = agent.problems.filter(problem => problem.level === "warn").length;
          return (
            <button className="agent-card" key={agent.name} onClick={() => setModal({ type: "agent", agent })}>
              <div className="agent-card-head"><div className="mini-icon"><Bot size={18} /></div><span className={`badge ${errors ? "danger" : warnings ? "warning" : "success"}`}>{errors ? `${errors} errors` : warnings ? `${warnings} warnings` : "Valid"}</span></div>
              <strong>{agent.displayName || agent.name}</strong>
              <p>{agent.description || "No description"}</p>
              <div className="agent-meta"><span>{agent.model || "inherit"}</span><span>{agent.thinking || "inherit"}</span></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfilesPage({ rows, act, busy }) {
  return (
    <div className="profile-list">
      {rows.length === 0 ? <EmptyState icon={FolderCog} title="No startup profiles configured" /> : rows.map(profile => (
        <article className="profile-row" key={profile.name}>
          <div className="profile-mode">{profile.mode.slice(0, 2).toUpperCase()}</div>
          <div className="profile-main">
            <div><h2>{profile.label}</h2>{profile.isDefault && <span className="badge success">Default</span>}</div>
            <code>{profile.cwd}</code>
          </div>
          <span className={`badge ${profile.exists ? "outline" : "danger"}`}>{profile.mode}</span>
          <button className="button primary compact" disabled={!profile.exists || busy === `profile:${profile.name}`} onClick={() => act("launchProfile", { name: profile.name }, `${profile.label} opened in Terminal`, { reload: false, busyKey: `profile:${profile.name}` })}>
            <Play size={15} /> Launch
          </button>
        </article>
      ))}
    </div>
  );
}

function ModalHost({ modal, data, close, act }) {
  const runAndClose = async (action, payload, success, options) => {
    try {
      await act(action, payload, success, options);
      close();
    } catch {
      // The toast keeps the error visible while the form remains open.
    }
  };

  if (modal.type === "providerForm") {
    return <ProviderForm modal={modal} apiTypes={data.apiTypes} close={close} submit={runAndClose} />;
  }
  if (modal.type === "modelForm") {
    return <ModelForm modal={modal} close={close} submit={runAndClose} />;
  }
  if (modal.type === "key") {
    return <KeyForm provider={modal.provider} close={close} submit={runAndClose} />;
  }
  if (modal.type === "skillPath") {
    return <SimpleInputModal title="Add skill path" label="Path" placeholder="~/.pi/agent/skills" close={close} submit={value => runAndClose("addSkillPath", { path: value }, "Skill path added")} />;
  }
  if (modal.type === "activate") {
    return <ActivateModal provider={modal.provider} close={close} submit={model => runAndClose("activateProvider", { provider: modal.provider.name, model }, `${modal.provider.name}/${model} is now active`)} />;
  }
  if (modal.type === "confirm") {
    return <ConfirmModal modal={modal} close={close} />;
  }
  if (modal.type === "doctor") {
    return <DoctorModal modal={modal} close={close} probe={async () => {
      try {
        const findings = await callBridge("doctor", { probe: true });
        modal.findings = findings;
      } catch {
        // The next open retains the normal non-probe report.
      }
    }} />;
  }
  if (modal.type === "sync") {
    const count = modal.result.diff?.extra?.length || 0;
    return (
      <Dialog title="Sync models" close={close}>
        <div className="dialog-body">
          <p>{count ? `${count} new model${count === 1 ? "" : "s"} available from ${modal.provider.name}.` : "The configured model list is already up to date."}</p>
          {count > 0 && <div className="preview-list">{modal.result.diff.extra.map(id => <code key={id}>{id}</code>)}</div>}
        </div>
        <div className="dialog-footer"><button className="button secondary" onClick={close}>Cancel</button>{count > 0 && <button className="button primary" onClick={() => runAndClose("syncProvider", { name: modal.provider.name, apply: true }, `${count} model(s) added`)}>Add models</button>}</div>
      </Dialog>
    );
  }
  if (modal.type === "import") {
    const count = modal.preview.importable.length;
    return (
      <Dialog title="Import from CC Switch" close={close}>
        <div className="dialog-body"><p>{count ? `${count} provider${count === 1 ? "" : "s"} can be imported without overwriting existing entries. Imported credentials may remain plaintext until you rotate them into Keychain.` : "No providers are available to import."}</p><div className="preview-list">{modal.preview.importable.map(row => <div key={row.targetName}><strong>{row.targetName}</strong><span>{row.appType}</span></div>)}</div></div>
        <div className="dialog-footer"><button className="button secondary" onClick={close}>Cancel</button>{count > 0 && <button className="button primary" onClick={() => runAndClose("importAll", {}, result => `${result.count} provider(s) imported`)}>Import all</button>}</div>
      </Dialog>
    );
  }
  if (modal.type === "agent") return <AgentModal agent={modal.agent} close={close} />;
  return null;
}

function ProviderForm({ modal, apiTypes, close, submit }) {
  const provider = modal.provider;
  const [form, setForm] = useState({ name: provider?.name || "", baseUrl: provider?.baseUrl || "", api: provider?.api || apiTypes[0], key: "", model: "", storeKeychain: true });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const valid = form.name.trim() && form.baseUrl.trim() && form.api && (modal.mode === "edit" || (form.key.trim() && form.model.trim()));
  return (
    <Dialog title={modal.mode === "edit" ? `Edit ${provider.name}` : "Add provider"} close={close}>
      <form onSubmit={event => { event.preventDefault(); if (modal.mode === "edit") submit("updateProvider", { name: provider.name, baseUrl: form.baseUrl, api: form.api }, "Provider updated"); else submit("addProvider", form, "Provider added"); }}>
        <div className="dialog-body form-grid">
          <Field label="Provider name"><input value={form.name} disabled={modal.mode === "edit"} onChange={event => change("name", event.target.value)} placeholder="my-relay" /></Field>
          <Field label="API format"><select value={form.api} onChange={event => change("api", event.target.value)}>{apiTypes.map(api => <option key={api} value={api}>{api}</option>)}</select></Field>
          <Field label="Base URL" wide><input value={form.baseUrl} onChange={event => change("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></Field>
          {modal.mode === "add" && <><Field label="First model" wide><input value={form.model} onChange={event => change("model", event.target.value)} placeholder="claude-sonnet-5" /></Field><Field label="API key" wide><input type="password" value={form.key} onChange={event => change("key", event.target.value)} autoComplete="off" /></Field><label className="check-row wide"><input type="checkbox" checked={form.storeKeychain} onChange={event => change("storeKeychain", event.target.checked)} /><span><strong>Store in macOS Keychain</strong><small>models.json keeps only a lookup command.</small></span></label></>}
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!valid}>{modal.mode === "edit" ? "Save changes" : "Add provider"}</button></div>
      </form>
    </Dialog>
  );
}

function ModelForm({ modal, close, submit }) {
  const [form, setForm] = useState({ id: modal.model?.id || "", contextWindow: modal.model?.contextWindow || 200000, maxTokens: modal.model?.maxTokens || 32768, reasoning: modal.model?.reasoning || false, input: modal.model?.input || ["text"] });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return (
    <Dialog title={modal.mode === "edit" ? `Edit ${modal.model.id}` : "Add model"} close={close}>
      <form onSubmit={event => { event.preventDefault(); submit("upsertModel", { provider: modal.provider, model: { ...form, contextWindow: Number(form.contextWindow), maxTokens: Number(form.maxTokens) } }, modal.mode === "edit" ? "Model updated" : "Model added"); }}>
        <div className="dialog-body form-grid">
          <Field label="Model ID" wide><input value={form.id} disabled={modal.mode === "edit"} onChange={event => change("id", event.target.value)} /></Field>
          <Field label="Context window"><input type="number" min="1" value={form.contextWindow} onChange={event => change("contextWindow", event.target.value)} /></Field>
          <Field label="Max output tokens"><input type="number" min="1" value={form.maxTokens} onChange={event => change("maxTokens", event.target.value)} /></Field>
          <label className="check-row wide"><input type="checkbox" checked={form.reasoning} onChange={event => change("reasoning", event.target.checked)} /><span><strong>Reasoning supported</strong><small>Enable only when the endpoint forwards thinking parameters.</small></span></label>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!form.id}>Save model</button></div>
      </form>
    </Dialog>
  );
}

function KeyForm({ provider, close, submit }) {
  const [key, setKey] = useState("");
  const [storeKeychain, setStoreKeychain] = useState(true);
  return (
    <Dialog title={`Rotate key for ${provider.name}`} close={close}>
      <form onSubmit={event => { event.preventDefault(); submit("rotateKey", { name: provider.name, key, storeKeychain }, "API key updated"); }}>
        <div className="dialog-body form-grid"><Field label="New API key" wide><input type="password" value={key} onChange={event => setKey(event.target.value)} autoFocus autoComplete="off" /></Field><label className="check-row wide"><input type="checkbox" checked={storeKeychain} onChange={event => setStoreKeychain(event.target.checked)} /><span><strong>Store in macOS Keychain</strong><small>Recommended for local credentials.</small></span></label></div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!key}>Update key</button></div>
      </form>
    </Dialog>
  );
}

function ActivateModal({ provider, close, submit }) {
  const [model, setModel] = useState(provider.defaultModel || provider.models[0]);
  return <Dialog title={`Use ${provider.name}`} close={close}><div className="dialog-body"><Field label="Default model"><select value={model} onChange={event => setModel(event.target.value)}>{provider.models.map(id => <option key={id}>{id}</option>)}</select></Field></div><div className="dialog-footer"><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" onClick={() => submit(model)}>Activate</button></div></Dialog>;
}

function SimpleInputModal({ title, label, placeholder, close, submit }) {
  const [value, setValue] = useState("");
  return <Dialog title={title} close={close}><form onSubmit={event => { event.preventDefault(); submit(value); }}><div className="dialog-body"><Field label={label}><input value={value} placeholder={placeholder} onChange={event => setValue(event.target.value)} autoFocus /></Field></div><div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={!value.trim()}>Add path</button></div></form></Dialog>;
}

function ConfirmModal({ modal, close }) {
  const [working, setWorking] = useState(false);
  const confirm = async () => { setWorking(true); try { await modal.action(); close(); } finally { setWorking(false); } };
  return <Dialog title={modal.title} close={close}><div className="dialog-body"><p>{modal.body}</p></div><div className="dialog-footer"><button className="button secondary" onClick={close}>Cancel</button><button className={`button ${modal.danger ? "danger" : "primary"}`} disabled={working} onClick={confirm}>{working && <LoaderCircle size={16} className="spin" />}{modal.confirmLabel}</button></div></Dialog>;
}

function DoctorModal({ modal, close }) {
  const errors = modal.findings.filter(item => item.level === "error").length;
  const warnings = modal.findings.filter(item => item.level === "warn").length;
  return (
    <Dialog title="Configuration doctor" close={close} size="large">
      <div className="dialog-body doctor-body">
        {modal.loading ? <LoadingState compact /> : modal.error ? <ErrorState message={modal.error} /> : <>
          <div className="doctor-summary"><div><strong>{errors}</strong><span>Errors</span></div><div><strong>{warnings}</strong><span>Warnings</span></div><div><strong>{modal.findings.filter(item => item.level === "ok").length}</strong><span>Passed</span></div></div>
          <div className="finding-list">{modal.findings.map((finding, index) => <div className={`finding ${finding.level}`} key={`${finding.area}-${index}`}>{finding.level === "error" ? <CircleAlert size={17} /> : finding.level === "warn" ? <TriangleAlert size={17} /> : <CircleCheck size={17} />}<div><strong>{finding.area}</strong><p>{finding.message}</p>{finding.fix && <small>{finding.fix}</small>}</div></div>)}</div>
        </>}
      </div>
      <div className="dialog-footer"><button className="button primary" onClick={close}>Done</button></div>
    </Dialog>
  );
}

function AgentModal({ agent, close }) {
  return <Dialog title={agent.displayName || agent.name} close={close}><div className="dialog-body agent-detail"><p>{agent.description || "No description"}</p><dl><div><dt>Source</dt><dd>{agent.source}</dd></div><div><dt>Model</dt><dd>{agent.model || "inherit"}</dd></div><div><dt>Thinking</dt><dd>{agent.thinking || "inherit"}</dd></div><div><dt>Tools</dt><dd>{agent.tools || "all built-ins"}</dd></div></dl>{agent.problems.length > 0 && <div className="finding-list">{agent.problems.map((problem, index) => <div className={`finding ${problem.level}`} key={index}>{problem.level === "error" ? <CircleAlert size={17} /> : <TriangleAlert size={17} />}<p>{problem.message}</p></div>)}</div>}</div><div className="dialog-footer"><button className="button primary" onClick={close}>Done</button></div></Dialog>;
}

function Dialog({ title, close, children, size = "normal" }) {
  useEffect(() => {
    const handler = event => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className={`dialog ${size}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{title}</h2><IconButton label="Close" onClick={close}><X size={18} /></IconButton></header>{children}</section></div>;
}

function Field({ label, children, wide = false }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}

function SearchField({ value, onChange, placeholder }) {
  return <label className="search-field"><Search size={17} /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /><span className="sr-only">{placeholder}</span></label>;
}

function IconButton({ label, children, onClick, disabled = false, danger = false }) {
  return <button className={`icon-button ${danger ? "danger" : ""}`} type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Toggle({ checked, onChange, label, disabled }) {
  return <button className={`toggle ${checked ? "checked" : ""}`} role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={onChange}><span /></button>;
}

function EmptyState({ icon: Icon, title, action, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={24} /></div><h2>{title}</h2>{action && <button className="button secondary" onClick={onAction}><Plus size={16} />{action}</button>}</div>;
}

function LoadingState({ compact = false }) {
  return <div className={`loading-state ${compact ? "compact" : ""}`}><div className="skeleton wide" /><div className="skeleton medium" /><div className="skeleton wide" /><div className="skeleton short" /></div>;
}

function ErrorState({ message, onRetry }) {
  return <div className="error-state"><CircleAlert size={28} /><h2>Pi Switch could not load</h2><p>{message}</p>{onRetry && <button className="button secondary" onClick={onRetry}><RefreshCw size={16} /> Retry</button>}</div>;
}

function Toast({ toast, close }) {
  return <div className={`toast ${toast.type}`} role="status">{toast.type === "error" ? <CircleAlert size={18} /> : <CircleCheck size={18} />}<span>{toast.message}</span><IconButton label="Dismiss" onClick={close}><X size={15} /></IconButton></div>;
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return "Not set";
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}
