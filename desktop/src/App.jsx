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
  Eye,
  EyeOff,
  FileCode2,
  FolderCog,
  List,
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
  { id: "providers", label: "Provider 管理", icon: Database },
  { id: "models", label: "模型", icon: Cpu },
  { id: "mcp", label: "MCP 服务", icon: Server },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "profiles", label: "启动配置", icon: FolderCog },
];

const PAGE_COPY = {
  providers: ["Provider 管理", "切换服务端点、测试连接并管理凭据。"],
  models: ["模型", "管理 Pi 可以使用的模型列表。"],
  mcp: ["MCP 服务", "管理 Pi 各配置层中实际生效的 MCP 服务。"],
  skills: ["Skills", "查看已配置的 Skill 路径及其提供的能力。"],
  agents: ["Agents", "检查子代理配置及 frontmatter 状态。"],
  profiles: ["启动配置", "使用指定工作目录和模式启动 Pi。"],
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
            <span>配置管理器</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
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
            <span>Thinking 级别</span>
            <select
              value={data?.settings.defaultThinkingLevel || "medium"}
              disabled={!data || busy === "setThinking"}
              onChange={event => act("setThinking", { level: event.target.value }, "Thinking 级别已更新")}
            >
              {(data?.thinkingLevels || ["off", "minimal", "low", "medium", "high", "xhigh", "max"]).map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <button className="sidebar-action" onClick={openDoctor}>
            <ShieldCheck size={17} strokeWidth={1.8} />
            <span>运行 Doctor 诊断</span>
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
              <div className="active-context" title="Pi 当前默认配置">
                <CircleCheck size={16} />
                <span>{data.settings.defaultProvider}</span>
                <b>{data.settings.defaultModel}</b>
              </div>
            )}
            <IconButton label="刷新" onClick={() => load()} disabled={loading}>
              <RefreshCw size={17} className={loading ? "spin" : ""} />
            </IconButton>
            <IconButton label={`主题：${theme}`} onClick={() => setTheme(current => current === "system" ? "light" : current === "light" ? "dark" : "system")}>
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
        <SearchField value={query} onChange={setQuery} placeholder="搜索 Provider" />
        <div className="toolbar-actions">
          {data.ccSwitchAvailable && (
            <button className="button secondary" onClick={importProviders}>
              <Database size={16} /> 导入
            </button>
          )}
          <button className="button primary" onClick={() => setModal({ type: "providerForm", mode: "add" })}>
            <Plus size={17} /> 添加 Provider
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Database} title="没有找到 Provider" action="添加 Provider" onAction={() => setModal({ type: "providerForm", mode: "add" })} />
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
                  act("activateProvider", { provider: provider.name, model: provider.models[0] }, `已启用 ${provider.name}`);
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
              onShowMissing={() => setModal({ type: "missingModels", provider, missing: health[provider.name]?.diff?.missing || [] })}
              onShowError={() => setModal({ type: "connectionError", provider, health: health[provider.name] })}
              onDelete={() => setModal({ type: "confirm", title: `删除 ${provider.name}？`, body: "这个 Provider 及其模型将被删除。写入前会自动创建备份。", confirmLabel: "删除 Provider", danger: true, action: () => act("deleteProvider", { name: provider.name }, "Provider 已删除") })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider, health, testing, onTest, onActivate, onEdit, onKey, onSync, onShowMissing, onShowError, onDelete }) {
  const status = provider.isDefault
    ? { className: "success", text: "当前" }
    : !provider.keyOk
      ? { className: "danger", text: "密钥异常" }
      : { className: "neutral", text: "就绪" };

  return (
    <article className={`provider-row ${provider.isDefault ? "current" : ""}`}>
      <div className="provider-symbol" aria-hidden="true">{provider.name.slice(0, 2).toUpperCase()}</div>
      <div className="provider-main">
        <div className="provider-title-line">
          <h2>{provider.name}</h2>
          <span className={`badge ${status.className}`}>{status.text}</span>
          <span className="badge outline">{provider.api}</span>
        </div>
        <div className="provider-url">{provider.baseUrl || "未配置服务端点"}</div>
        <div className="provider-meta">
          <span><Box size={14} /> {provider.models.length} 个模型</span>
          <span><KeyRound size={14} /> {provider.keyOk ? provider.keySource : provider.keyError}</span>
        </div>
      </div>

      <div className="provider-status">
        <HealthBadge health={health} testing={testing} onShowMissing={onShowMissing} onShowError={onShowError} />
        {provider.isDefault ? (
          <div className="active-model">{provider.defaultModel}</div>
        ) : (
          <button className="button secondary compact" onClick={onActivate} disabled={!provider.keyOk || provider.models.length === 0}>
            <Check size={15} /> 使用
          </button>
        )}
      </div>

      <div className="row-actions">
        <IconButton label="测试连接" onClick={onTest} disabled={testing}><Activity size={17} /></IconButton>
        <IconButton label="同步模型" onClick={onSync}><RotateCcw size={17} /></IconButton>
        <IconButton label="编辑 Provider" onClick={onEdit}><Pencil size={17} /></IconButton>
        <IconButton label="更新 API 密钥" onClick={onKey}><KeyRound size={17} /></IconButton>
        <IconButton label="删除 Provider" onClick={onDelete} danger><Trash2 size={17} /></IconButton>
      </div>
    </article>
  );
}

function HealthBadge({ health, testing, onShowMissing, onShowError }) {
  if (testing || health?.loading) return <div className="health neutral"><LoaderCircle className="spin" size={14} /> 测试中</div>;
  if (!health) return <div className="health neutral">未测试</div>;
  if (!health.ok) return <div className="health danger"><CircleAlert size={14} /> 连接失败 <button type="button" className="health-detail-button" title="查看连接错误" aria-label="查看连接错误" onClick={onShowError}><List size={13} /></button></div>;
  if (health.diff?.missing?.length) return <div className="health warning"><TriangleAlert size={14} /> 缺少 {health.diff.missing.length} 个 <button type="button" className="health-detail-button" title="查看缺少的模型" aria-label="查看缺少的模型" onClick={onShowMissing}><List size={13} /></button></div>;
  return <div className="health success"><CircleCheck size={14} /> {health.ms} ms</div>;
}

function ModelsPage({ data, focusProvider, setFocusProvider, act, setModal }) {
  const provider = data.providers.find(item => item.name === focusProvider) || data.providers[0];
  if (!provider) return <EmptyState icon={Cpu} title="请先添加 Provider，再添加模型" />;

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
          <Plus size={17} /> 添加模型
        </button>
      </div>

      <div className="table-surface">
        <div className="table-head model-grid">
          <span>模型</span><span>上下文</span><span>最大输出</span><span>推理</span><span>输入</span><span />
        </div>
        {provider.modelObjects.length === 0 ? (
          <EmptyState icon={Cpu} title="尚未配置模型" action="添加模型" onAction={() => setModal({ type: "modelForm", mode: "add", provider: provider.name })} />
        ) : provider.modelObjects.map(model => {
          const active = data.settings.defaultProvider === provider.name && data.settings.defaultModel === model.id;
          return (
            <div className={`table-row model-grid ${active ? "active" : ""}`} key={model.id}>
              <div className="model-name"><strong>{model.id}</strong>{active && <span className="badge success">当前</span>}</div>
              <span>{formatTokens(model.contextWindow)}</span>
              <span>{formatTokens(model.maxTokens)}</span>
              <span>{model.reasoning ? "支持" : "关闭"}</span>
              <span>{(model.input || ["text"]).join(", ")}</span>
              <div className="inline-actions">
                {!active && <IconButton label="使用模型" onClick={() => act("activateProvider", { provider: provider.name, model: model.id }, `已启用 ${model.id}`)}><Check size={16} /></IconButton>}
                <IconButton label="编辑模型" onClick={() => setModal({ type: "modelForm", mode: "edit", provider: provider.name, model })}><Pencil size={16} /></IconButton>
                <IconButton label="删除模型" danger disabled={active} onClick={() => setModal({ type: "confirm", title: `删除 ${model.id}？`, body: "该模型将从这个 Provider 中删除。", confirmLabel: "删除模型", danger: true, action: () => act("deleteModel", { provider: provider.name, id: model.id }, "模型已删除") })}><Trash2 size={16} /></IconButton>
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
      <div className="table-head mcp-grid"><span>服务</span><span>命令</span><span>配置层</span><span>生命周期</span><span>状态</span></div>
      {rows.length === 0 ? <EmptyState icon={Server} title="尚未配置 MCP 服务" /> : rows.map(server => (
        <div className="table-row mcp-grid" key={server.name}>
          <div className="server-name"><div className="mini-icon"><Server size={17} /></div><strong>{server.name}</strong></div>
          <code>{server.command}</code>
          <span>{server.effectiveLayer}</span>
          <span>{server.lifecycle}</span>
          <Toggle
            checked={!server.disabled}
            disabled={busy === `mcp:${server.name}`}
            label={`${server.disabled ? "启用" : "停用"} ${server.name}`}
            onChange={() => act("toggleMcp", { name: server.name, disabled: !server.disabled }, `${server.name} 已${server.disabled ? "启用" : "停用"}`, { busyKey: `mcp:${server.name}` })}
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
        <div className="summary-line"><strong>{data.skillCatalog.length}</strong> 个 Skills，来自 <strong>{data.skillPaths.length}</strong> 个路径</div>
        <div className="toolbar-actions">
          <button className="button secondary" onClick={() => act("pruneSkillPaths", {}, result => result.length ? `已移除 ${result.length} 个无效路径` : "没有无效路径")}>清理无效路径</button>
          <button className="button primary" onClick={() => setModal({ type: "skillPath" })}><Plus size={17} /> 添加路径</button>
        </div>
      </div>
      <div className="path-list">
        {data.skillPaths.length === 0 ? <EmptyState icon={Sparkles} title="尚未配置 Skill 路径" action="添加路径" onAction={() => setModal({ type: "skillPath" })} /> : data.skillPaths.map(path => (
          <article className="path-row" key={path.entry}>
            <div className={`mini-icon ${path.exists ? "" : "error"}`}><FileCode2 size={18} /></div>
            <div className="path-main"><strong>{path.entry}</strong><span>{path.kind} · {path.count} 个 Skills</span></div>
            <span className={`badge ${path.exists ? "success" : "danger"}`}>{path.exists ? "可用" : "路径缺失"}</span>
            <IconButton label="移除路径" danger onClick={() => setModal({ type: "confirm", title: "移除 Skill 路径？", body: path.entry, confirmLabel: "移除路径", danger: true, action: () => act("removeSkillPath", { path: path.entry }, "Skill 路径已移除") })}><Trash2 size={16} /></IconButton>
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
      <div className="page-toolbar"><SearchField value={query} onChange={setQuery} placeholder="搜索 Agents" /></div>
      <div className="agent-grid">
        {filtered.map(agent => {
          const errors = agent.problems.filter(problem => problem.level === "error").length;
          const warnings = agent.problems.filter(problem => problem.level === "warn").length;
          return (
            <button className="agent-card" key={agent.name} onClick={() => setModal({ type: "agent", agent })}>
              <div className="agent-card-head"><div className="mini-icon"><Bot size={18} /></div><span className={`badge ${errors ? "danger" : warnings ? "warning" : "success"}`}>{errors ? `${errors} 个错误` : warnings ? `${warnings} 个警告` : "配置有效"}</span></div>
              <strong>{agent.displayName || agent.name}</strong>
              <p>{agent.description || "暂无描述"}</p>
              <div className="agent-meta"><span>{agent.model || "继承默认值"}</span><span>{agent.thinking || "继承默认值"}</span></div>
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
      {rows.length === 0 ? <EmptyState icon={FolderCog} title="尚未配置启动项" /> : rows.map(profile => (
        <article className="profile-row" key={profile.name}>
          <div className="profile-mode">{profile.mode.slice(0, 2).toUpperCase()}</div>
          <div className="profile-main">
            <div><h2>{profile.label}</h2>{profile.isDefault && <span className="badge success">默认</span>}</div>
            <code>{profile.cwd}</code>
          </div>
          <span className={`badge ${profile.exists ? "outline" : "danger"}`}>{profile.mode}</span>
          <button className="button primary compact" disabled={!profile.exists || busy === `profile:${profile.name}`} onClick={() => act("launchProfile", { name: profile.name }, `已在终端中打开 ${profile.label}`, { reload: false, busyKey: `profile:${profile.name}` })}>
            <Play size={15} /> 启动
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
    return <SimpleInputModal title="添加 Skill 路径" label="路径" placeholder="~/.pi/agent/skills" close={close} submit={value => runAndClose("addSkillPath", { path: value }, "Skill 路径已添加")} />;
  }
  if (modal.type === "activate") {
    return <ActivateModal provider={modal.provider} close={close} submit={model => runAndClose("activateProvider", { provider: modal.provider.name, model }, `已启用 ${modal.provider.name}/${model}`)} />;
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
  if (modal.type === "missingModels") {
    return (
      <Dialog title="缺少的模型" close={close}>
        <div className="dialog-body">
          <p><strong>{modal.provider.name}</strong> 本次连接测试检查的以下模型，服务端没有返回：</p>
          <div className="preview-list missing-model-list">{modal.missing.map(id => <code key={id}>{id}</code>)}</div>
        </div>
        <div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div>
      </Dialog>
    );
  }
  if (modal.type === "connectionError") {
    return (
      <Dialog title="连接测试失败" close={close}>
        <div className="dialog-body connection-error-detail">
          <p><strong>{modal.provider.name}/{modal.health?.model || modal.provider.defaultModel || modal.provider.models[0]}</strong> 未能完成一次真实对话请求：</p>
          <pre>{modal.health?.error || "未返回具体错误"}</pre>
        </div>
        <div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div>
      </Dialog>
    );
  }
  if (modal.type === "sync") {
    const count = modal.result.diff?.extra?.length || 0;
    return (
      <Dialog title="同步模型" close={close}>
        <div className="dialog-body">
          <p>{count ? `${modal.provider.name} 服务端有 ${count} 个本地尚未配置的新模型。` : "当前模型列表已是最新状态。"}</p>
          {count > 0 && <div className="preview-list">{modal.result.diff.extra.map(id => <code key={id}>{id}</code>)}</div>}
        </div>
        <div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button>{count > 0 && <button className="button primary" onClick={() => runAndClose("syncProvider", { name: modal.provider.name, apply: true }, `已添加 ${count} 个模型`)}>添加模型</button>}</div>
      </Dialog>
    );
  }
  if (modal.type === "import") {
    const count = modal.preview.importable.length;
    return (
      <Dialog title="从 CC Switch 导入" close={close}>
        <div className="dialog-body"><p>{count ? `有 ${count} 个 Provider 可导入，且不会覆盖现有配置。导入的凭据在更新到 Keychain 前可能仍以明文保存。` : "没有可导入的 Provider。"}</p><div className="preview-list">{modal.preview.importable.map(row => <div key={row.targetName}><strong>{row.targetName}</strong><span>{row.appType}</span></div>)}</div></div>
        <div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button>{count > 0 && <button className="button primary" onClick={() => runAndClose("importAll", {}, result => `已导入 ${result.count} 个 Provider`)}>全部导入</button>}</div>
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
    <Dialog title={modal.mode === "edit" ? `编辑 ${provider.name}` : "添加 Provider"} close={close}>
      <form onSubmit={event => { event.preventDefault(); if (modal.mode === "edit") submit("updateProvider", { name: provider.name, baseUrl: form.baseUrl, api: form.api }, "Provider 已更新"); else submit("addProvider", form, "Provider 已添加"); }}>
        <div className="dialog-body form-grid">
          <Field label="Provider 名称"><input value={form.name} disabled={modal.mode === "edit"} onChange={event => change("name", event.target.value)} placeholder="my-relay" /></Field>
          <Field label="API 格式"><select value={form.api} onChange={event => change("api", event.target.value)}>{apiTypes.map(api => <option key={api} value={api}>{api}</option>)}</select></Field>
          <Field label="Base URL" wide><input value={form.baseUrl} onChange={event => change("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></Field>
          {modal.mode === "add" && <><Field label="首个模型" wide><input value={form.model} onChange={event => change("model", event.target.value)} placeholder="claude-sonnet-5" /></Field><Field label="API 密钥" wide><input type="password" value={form.key} onChange={event => change("key", event.target.value)} autoComplete="off" /></Field><label className="check-row wide"><input type="checkbox" checked={form.storeKeychain} onChange={event => change("storeKeychain", event.target.checked)} /><span><strong>存入 macOS Keychain</strong><small>models.json 中只保留读取命令。</small></span></label></>}
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button type="submit" className="button primary" disabled={!valid}>{modal.mode === "edit" ? "保存修改" : "添加 Provider"}</button></div>
      </form>
    </Dialog>
  );
}

function ModelForm({ modal, close, submit }) {
  const [form, setForm] = useState({ id: modal.model?.id || "", contextWindow: modal.model?.contextWindow || 200000, maxTokens: modal.model?.maxTokens || 32768, reasoning: modal.model?.reasoning || false, input: modal.model?.input || ["text"] });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return (
    <Dialog title={modal.mode === "edit" ? `编辑 ${modal.model.id}` : "添加模型"} close={close}>
      <form onSubmit={event => { event.preventDefault(); submit("upsertModel", { provider: modal.provider, model: { ...form, contextWindow: Number(form.contextWindow), maxTokens: Number(form.maxTokens) } }, modal.mode === "edit" ? "模型已更新" : "模型已添加"); }}>
        <div className="dialog-body form-grid">
          <Field label="Model ID" wide><input value={form.id} disabled={modal.mode === "edit"} onChange={event => change("id", event.target.value)} /></Field>
          <Field label="上下文窗口"><input type="number" min="1" value={form.contextWindow} onChange={event => change("contextWindow", event.target.value)} /></Field>
          <Field label="最大输出 Token"><input type="number" min="1" value={form.maxTokens} onChange={event => change("maxTokens", event.target.value)} /></Field>
          <label className="check-row wide"><input type="checkbox" checked={form.reasoning} onChange={event => change("reasoning", event.target.checked)} /><span><strong>支持 Reasoning</strong><small>仅当服务端点会转发 thinking 参数时启用。</small></span></label>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button type="submit" className="button primary" disabled={!form.id}>保存模型</button></div>
      </form>
    </Dialog>
  );
}

function KeyForm({ provider, close, submit }) {
  const [key, setKey] = useState("");
  const [storeKeychain, setStoreKeychain] = useState(!provider.keyInline);
  const [visible, setVisible] = useState(false);
  const [loadingKey, setLoadingKey] = useState(true);
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    let active = true;
    callBridge("readProviderKey", { name: provider.name })
      .then(result => { if (active) setKey(result.key); })
      .catch(error => { if (active) setKeyError(error?.message || String(error)); })
      .finally(() => { if (active) setLoadingKey(false); });
    return () => { active = false; };
  }, [provider.name]);

  return (
    <Dialog title={`更新 ${provider.name} 的密钥`} close={close}>
      <form onSubmit={event => { event.preventDefault(); submit("rotateKey", { name: provider.name, key, storeKeychain }, "API 密钥已更新"); }}>
        <div className="dialog-body form-grid">
          <Field label="API 密钥" wide>
            <div className="secret-field">
              <input type={visible ? "text" : "password"} value={key} disabled={loadingKey} onChange={event => setKey(event.target.value)} autoFocus autoComplete="off" placeholder={loadingKey ? "正在读取密钥..." : "输入 API 密钥"} />
              <IconButton label={visible ? "隐藏密钥" : "显示密钥"} onClick={() => setVisible(current => !current)} disabled={loadingKey || !key}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton>
            </div>
            {keyError && <small className="field-error">现有密钥读取失败：{keyError}。你仍可以输入新密钥覆盖它。</small>}
          </Field>
          <label className="check-row wide"><input type="checkbox" checked={storeKeychain} onChange={event => setStoreKeychain(event.target.checked)} /><span><strong>存入 macOS Keychain</strong><small>建议将本地凭据保存在这里。</small></span></label>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button type="submit" className="button primary" disabled={loadingKey || !key}>更新密钥</button></div>
      </form>
    </Dialog>
  );
}

function ActivateModal({ provider, close, submit }) {
  const [model, setModel] = useState(provider.defaultModel || provider.models[0]);
  return <Dialog title={`使用 ${provider.name}`} close={close}><div className="dialog-body"><Field label="默认模型"><select value={model} onChange={event => setModel(event.target.value)}>{provider.models.map(id => <option key={id}>{id}</option>)}</select></Field></div><div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button><button className="button primary" onClick={() => submit(model)}>启用</button></div></Dialog>;
}

function SimpleInputModal({ title, label, placeholder, close, submit }) {
  const [value, setValue] = useState("");
  return <Dialog title={title} close={close}><form onSubmit={event => { event.preventDefault(); submit(value); }}><div className="dialog-body"><Field label={label}><input value={value} placeholder={placeholder} onChange={event => setValue(event.target.value)} autoFocus /></Field></div><div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button type="submit" className="button primary" disabled={!value.trim()}>添加路径</button></div></form></Dialog>;
}

function ConfirmModal({ modal, close }) {
  const [working, setWorking] = useState(false);
  const confirm = async () => { setWorking(true); try { await modal.action(); close(); } finally { setWorking(false); } };
  return <Dialog title={modal.title} close={close}><div className="dialog-body"><p>{modal.body}</p></div><div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button><button className={`button ${modal.danger ? "danger" : "primary"}`} disabled={working} onClick={confirm}>{working && <LoaderCircle size={16} className="spin" />}{modal.confirmLabel}</button></div></Dialog>;
}

function DoctorModal({ modal, close }) {
  const errors = modal.findings.filter(item => item.level === "error").length;
  const warnings = modal.findings.filter(item => item.level === "warn").length;
  return (
    <Dialog title="配置诊断" close={close} size="large">
      <div className="dialog-body doctor-body">
        {modal.loading ? <LoadingState compact /> : modal.error ? <ErrorState message={modal.error} /> : <>
          <div className="doctor-summary"><div><strong>{errors}</strong><span>错误</span></div><div><strong>{warnings}</strong><span>警告</span></div><div><strong>{modal.findings.filter(item => item.level === "ok").length}</strong><span>通过</span></div></div>
          <div className="finding-list">{modal.findings.map((finding, index) => <div className={`finding ${finding.level}`} key={`${finding.area}-${index}`}>{finding.level === "error" ? <CircleAlert size={17} /> : finding.level === "warn" ? <TriangleAlert size={17} /> : <CircleCheck size={17} />}<div><strong>{finding.area}</strong><p>{finding.message}</p>{finding.fix && <small>{finding.fix}</small>}</div></div>)}</div>
        </>}
      </div>
      <div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div>
    </Dialog>
  );
}

function AgentModal({ agent, close }) {
  return <Dialog title={agent.displayName || agent.name} close={close}><div className="dialog-body agent-detail"><p>{agent.description || "暂无描述"}</p><dl><div><dt>来源</dt><dd>{agent.source}</dd></div><div><dt>模型</dt><dd>{agent.model || "继承默认值"}</dd></div><div><dt>Thinking</dt><dd>{agent.thinking || "继承默认值"}</dd></div><div><dt>工具</dt><dd>{agent.tools || "所有内置工具"}</dd></div></dl>{agent.problems.length > 0 && <div className="finding-list">{agent.problems.map((problem, index) => <div className={`finding ${problem.level}`} key={index}>{problem.level === "error" ? <CircleAlert size={17} /> : <TriangleAlert size={17} />}<p>{problem.message}</p></div>)}</div>}</div><div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div></Dialog>;
}

function Dialog({ title, close, children, size = "normal" }) {
  useEffect(() => {
    const handler = event => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className={`dialog ${size}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{title}</h2><IconButton label="关闭" onClick={close}><X size={18} /></IconButton></header>{children}</section></div>;
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
  return <div className="error-state"><CircleAlert size={28} /><h2>Pi Switch 加载失败</h2><p>{message}</p>{onRetry && <button className="button secondary" onClick={onRetry}><RefreshCw size={16} /> 重试</button>}</div>;
}

function Toast({ toast, close }) {
  return <div className={`toast ${toast.type}`} role="status">{toast.type === "error" ? <CircleAlert size={18} /> : <CircleCheck size={18} />}<span>{toast.message}</span><IconButton label="关闭提示" onClick={close}><X size={15} /></IconButton></div>;
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return "未设置";
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}
