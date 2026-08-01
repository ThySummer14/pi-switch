import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CloudDownload,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileJson,
  FileCode2,
  FolderCog,
  History,
  List,
  ListChecks,
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
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { callBridge } from "./api.js";
import { diagnoseProviderError } from "../../src/provider-errors.js";
import { inferModelCapabilities, inferModelContextWindow, inspectModelCapabilities } from "../../src/model-capabilities.js";

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

function busyLabel(value) {
  if (!value) return "";
  if (value.startsWith("test:")) return `正在测试 ${value.slice(5)} 的连接`;
  if (value.startsWith("sync:")) return `正在同步 ${value.slice(5)} 的模型`;
  if (value.startsWith("mcp:")) return "正在更新 MCP 状态";
  if (value.startsWith("profile:")) return "正在启动 Pi 配置";
  return ({
    addProvider: "正在添加 Provider",
    updateProvider: "正在保存 Provider",
    duplicateProvider: "正在复制 Provider",
    rotateKey: "正在更新 API 密钥",
    deleteProvider: "正在删除 Provider",
    upsertModel: "正在保存模型",
    batchUpdateModels: "正在批量更新模型",
    deleteModel: "正在删除模型",
    activateProvider: "正在切换默认模型",
    setThinking: "正在保存 Thinking 级别",
    importAll: "正在导入 Provider",
    restoreConfig: "正在恢复配置",
    syncProviderCatalog: "正在同步 Provider 模板",
    resetProviderCatalog: "正在还原内置模板",
    addSkillPath: "正在添加 Skill 路径",
    removeSkillPath: "正在移除 Skill 路径",
    pruneSkillPaths: "正在清理无效路径",
  })[value] || "正在处理";
}

// A concurrent click is a no-op, not a failed provider operation. Keeping a
// sentinel lets async callers leave their current UI state untouched.
const BUSY_SKIPPED = Object.freeze({ skipped: true });

const HEALTH_STORAGE_KEY = "pi-switch-test-history-v1";

function readHealthHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HEALTH_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistHealthHistory(value) {
  try {
    const safe = Object.fromEntries(Object.entries(value).map(([name, row]) => [name, {
      ok: Boolean(row?.ok),
      model: row?.model,
      ms: Number.isFinite(row?.ms) ? row.ms : 0,
      testedAt: row?.testedAt,
      modelCheck: row?.modelCheck ? { ok: Boolean(row.modelCheck.ok), status: row.modelCheck.status, modelCount: row.modelCheck.modelCount } : null,
      diff: row?.diff ? { missing: row.diff.missing || [], aliased: row.diff.aliased || [], extra: row.diff.extra || [], unknown: row.diff.unknown } : null,
      history: Array.isArray(row?.history) ? row.history : [],
    }]));
    localStorage.setItem(HEALTH_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // A private browsing profile may disable localStorage; the in-memory state still works.
  }
}

function historyEntry(result, testedAt = Date.now()) {
  return {
    testedAt,
    ok: Boolean(result?.ok),
    model: result?.model,
    ms: Number.isFinite(result?.ms) ? result.ms : 0,
    modelCheck: result?.modelCheck ? {
      ok: Boolean(result.modelCheck.ok),
      status: result.modelCheck.status,
      modelCount: result.modelCheck.modelCount,
    } : null,
    stages: Array.isArray(result?.stages) ? result.stages.map(stage => ({
      id: stage.id,
      label: stage.label,
      ok: Boolean(stage.ok),
      ms: Number.isFinite(stage.ms) ? stage.ms : 0,
    })) : [],
  };
}

export default function App() {
  const [view, setView] = useState("providers");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const busyRef = useRef("");
  const [health, setHealth] = useState(() => readHealthHistory());
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
    const nextBusy = options.busyKey || action;
    if (busyRef.current) {
      const message = `${busyLabel(busyRef.current)}，请完成后再执行其他写入操作`;
      setToast({ type: "error", message });
      return BUSY_SKIPPED;
    }
    busyRef.current = nextBusy;
    setBusy(nextBusy);
    try {
      const result = await callBridge(action, payload);
      if (options.reload !== false) await load({ quiet: true });
      if (success) setToast({ type: "success", message: typeof success === "function" ? success(result) : success });
      return result;
    } catch (err) {
      setToast({ type: "error", message: err?.message || String(err) });
      throw err;
    } finally {
      if (busyRef.current === nextBusy) {
        busyRef.current = "";
        setBusy("");
      }
    }
  }, [load]);

  const runTest = async name => {
    setHealth(current => ({ ...current, [name]: { loading: true, history: current[name]?.history || [] } }));
    try {
      const result = await act("testProvider", { name }, null, { reload: false, busyKey: `test:${name}` });
      if (result?.skipped) {
        setHealth(current => current[name]
          ? { ...current, [name]: { ...current[name], loading: false } }
          : current);
        return;
      }
      setHealth(current => {
        const entry = historyEntry(result);
        const nextHistory = [entry, ...(current[name]?.history || [])].slice(0, 5);
        const next = { ...current, [name]: { ...result, testedAt: entry.testedAt, history: nextHistory } };
        persistHealthHistory(next);
        return next;
      });
    } catch (err) {
      setHealth(current => {
        const result = { ok: false, error: err?.message || String(err), ms: 0 };
        const entry = historyEntry(result);
        const nextHistory = [entry, ...(current[name]?.history || [])].slice(0, 5);
        const next = { ...current, [name]: { ...result, testedAt: entry.testedAt, history: nextHistory } };
        persistHealthHistory(next);
        return next;
      });
    }
  };

  const clearHistory = name => {
    setHealth(current => {
      if (!current[name]) return current;
      const next = { ...current, [name]: { ...current[name], history: [] } };
      persistHealthHistory(next);
      return next;
    });
    setToast({ type: "success", message: `已清除 ${name} 的连接测试历史` });
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
              onChange={event => { void act("setThinking", { level: event.target.value }, "Thinking 级别已更新").catch(() => {}); }}
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
            {busy && (
              <div className="operation-status" role="status" aria-live="polite">
                <LoaderCircle size={14} className="spin" />
                <span>{busyLabel(busy)}</span>
              </div>
            )}
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
                  onExport={async () => {
                    try {
                      const snapshot = await act("exportConfig", {}, null, { reload: false });
                      if (snapshot?.skipped) return;
                      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = `pi-switch-config-${new Date().toISOString().slice(0, 10)}.json`;
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                      URL.revokeObjectURL(url);
                      setToast({ type: "success", message: "已导出脱敏配置文件，文件中不包含 API 密钥" });
                    } catch {
                      // act already surfaces the bridge error in the toast.
                    }
                  }}
                  onRestore={() => setModal({ type: "restoreConfig" })}
                />
              )}
              {view === "models" && (
                <ModelsPage
                  data={data}
                  focusProvider={focusProvider}
                  setFocusProvider={setFocusProvider}
                  act={act}
                  setModal={setModal}
                  busy={busy}
                />
              )}
              {view === "mcp" && <McpPage rows={data.mcp} cwd={data.workspaceCwd} act={act} busy={busy} setModal={setModal} />}
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
            updateModal={setModal}
            clearHistory={clearHistory}
            act={act}
            busy={busy}
          />
      )}
      {toast && <Toast toast={toast} close={() => setToast(null)} />}
    </div>
  );
}

function ProvidersPage({ data, health, busy, runTest, act, setModal, onExport, onRestore }) {
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
          <button className="button secondary" onClick={() => setModal({ type: "providerCatalog" })}>
            <CloudDownload size={16} /> 模板目录
          </button>
          <ConfigMenu onExport={onExport} onRestore={onRestore} />
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
              syncing={busy === `sync:${provider.name}`}
              onTest={() => runTest(provider.name)}
              onActivate={() => {
                if (provider.models.length === 1) {
                  act("activateProvider", { provider: provider.name, model: provider.models[0] }, `已启用 ${provider.name}`);
                } else {
                  setModal({ type: "activate", provider });
                }
              }}
              onEdit={() => setModal({ type: "providerForm", mode: "edit", provider })}
              onDuplicate={() => setModal({ type: "duplicateProvider", provider })}
              onKey={() => setModal({ type: "key", provider })}
              onSync={async () => {
                try {
                  const result = await act("syncProvider", { name: provider.name, apply: false }, null, { reload: false, busyKey: `sync:${provider.name}` });
                  if (result?.skipped) return;
                  setModal({ type: "sync", provider, result });
                } catch {
                  // act already exposes the bridge error in the toast.
                }
              }}
              onShowMissing={() => setModal({ type: "missingModels", provider, missing: health[provider.name]?.diff?.missing || [] })}
              onShowModelCheck={() => setModal({ type: "modelCheck", provider, health: health[provider.name] })}
              onShowError={() => setModal({ type: "connectionError", provider, health: health[provider.name] })}
              onShowHistory={() => setModal({ type: "testHistory", provider, history: health[provider.name]?.history || [] })}
              onDelete={() => setModal({ type: "confirm", title: `删除 ${provider.name}？`, body: "这个 Provider 及其模型将被删除。写入前会自动创建备份。", confirmLabel: "删除 Provider", danger: true, action: () => act("deleteProvider", { name: provider.name }, "Provider 已删除") })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider, health, testing, syncing, onTest, onActivate, onEdit, onDuplicate, onKey, onSync, onShowMissing, onShowModelCheck, onShowError, onShowHistory, onDelete }) {
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
        <HealthBadge health={health} testing={testing} onShowMissing={onShowMissing} onShowModelCheck={onShowModelCheck} onShowError={onShowError} onShowHistory={onShowHistory} />
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
        <IconButton label={syncing ? "同步模型中" : "同步模型"} onClick={onSync} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}</IconButton>
        <ProviderActionMenu onEdit={onEdit} onDuplicate={onDuplicate} onKey={onKey} onDelete={onDelete} />
      </div>
    </article>
  );
}

function ProviderActionMenu({ onEdit, onDuplicate, onKey, onDelete }) {
  const run = (event, action) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    action();
  };
  return (
    <details className="action-menu">
      <summary className="icon-button" title="更多 Provider 操作" aria-label="更多 Provider 操作"><MoreHorizontal size={17} /></summary>
      <div className="action-menu-panel">
        <button type="button" onClick={event => run(event, onEdit)}><Pencil size={15} /> 编辑 Provider</button>
        <button type="button" onClick={event => run(event, onDuplicate)}><Copy size={15} /> 复制 Provider</button>
        <button type="button" onClick={event => run(event, onKey)}><KeyRound size={15} /> 更新 API 密钥</button>
        <button type="button" className="danger-item" onClick={event => run(event, onDelete)}><Trash2 size={15} /> 删除 Provider</button>
      </div>
    </details>
  );
}

function HealthBadge({ health, testing, onShowMissing, onShowModelCheck, onShowError, onShowHistory }) {
  if (testing || health?.loading) return <div className="health neutral"><LoaderCircle className="spin" size={14} /> 测试中</div>;
  if (!health) return <div className="health neutral">未测试</div>;
  const historyButton = health.history?.length ? <button type="button" className="health-detail-button" title="查看测试历史" aria-label="查看测试历史" onClick={onShowHistory}><History size={13} /></button> : null;
  const testedAt = health.testedAt ? <small className="health-time">{formatRelativeTime(health.testedAt)}</small> : null;
  if (!health.ok) return <div className="health danger"><CircleAlert size={14} /> 连接失败 {testedAt}<button type="button" className="health-detail-button" title="查看连接错误" aria-label="查看连接错误" onClick={onShowError}><List size={13} /></button>{historyButton}</div>;
  if (health.diff?.missing?.length) return <div className="health warning"><TriangleAlert size={14} /> 缺少 {health.diff.missing.length} 个 {testedAt}<button type="button" className="health-detail-button" title="查看缺少的模型" aria-label="查看缺少的模型" onClick={onShowMissing}><List size={13} /></button>{historyButton}</div>;
  if (health.modelCheck && !health.modelCheck.ok) return <div className="health success" title="真实对话已成功，但服务端没有提供可读取的模型列表"><CircleCheck size={14} /> {health.ms} ms · 模型列表未知 {testedAt}<button type="button" className="health-detail-button" title="查看模型列表检查详情" aria-label="查看模型列表检查详情" onClick={onShowModelCheck}><List size={13} /></button>{historyButton}</div>;
  return <div className="health success"><CircleCheck size={14} /> {health.ms} ms {testedAt}{historyButton}</div>;
}

function ModelsPage({ data, focusProvider, setFocusProvider, act, setModal, busy }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const provider = data.providers.find(item => item.name === focusProvider) || data.providers[0];
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setSelectedIds(new Set());
  }, [provider?.name]);
  if (!provider) return <EmptyState icon={Cpu} title="请先添加 Provider，再添加模型" />;
  const reviewCount = provider.modelObjects.filter(model => inspectModelCapabilities(model).needsReview).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = provider.modelObjects.filter(model => {
    const capabilities = inspectModelCapabilities(model);
    const haystack = `${model.id} ${model.name || ""} ${model.source || ""}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
    if (filter === "review") return capabilities.needsReview;
    if (filter === "image") return capabilities.input.includes("image");
    if (filter === "reasoning") return capabilities.reasoning && capabilities.reasoningConfidence !== "unknown";
    return true;
  });
  const selectedModels = provider.modelObjects.filter(model => selectedIds.has(model.id));
  const allVisibleSelected = filteredModels.length > 0 && filteredModels.every(model => selectedIds.has(model.id));
  const toggleModelSelection = (id, checked) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleVisibleSelection = checked => {
    setSelectedIds(current => {
      const next = new Set(current);
      for (const model of filteredModels) {
        if (checked) next.add(model.id);
        else next.delete(model.id);
      }
      return next;
    });
  };
  const openBatchEditor = () => {
    if (selectedModels.length === 0 || busy) return;
    setModal({ type: "batchModelForm", provider: provider.name, models: selectedModels });
    setSelectedIds(new Set());
  };

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div className="toolbar-filters">
          <label className="select-control">
            <span>Provider</span>
            <select value={provider.name} onChange={event => setFocusProvider(event.target.value)}>
              {data.providers.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <SearchField value={query} onChange={setQuery} placeholder="搜索模型 ID、来源" />
          <label className="select-control compact">
            <span>筛选</span>
            <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">全部模型</option>
              <option value="review">待确认能力</option>
              <option value="image">支持图片</option>
              <option value="reasoning">支持推理</option>
            </select>
          </label>
          {selectedModels.length > 0 && <span className="selection-summary">已选 {selectedModels.length} 个</span>}
        </div>
        <div className="toolbar-actions model-toolbar-actions">
          <label className="visible-model-selection">
            <input type="checkbox" checked={allVisibleSelected} disabled={filteredModels.length === 0 || Boolean(busy)} onChange={event => toggleVisibleSelection(event.target.checked)} aria-label="选择当前筛选结果" />
            <span>选择筛选结果</span>
          </label>
          {selectedModels.length > 0 && <button className="button secondary compact" disabled={Boolean(busy)} onClick={openBatchEditor}><SlidersHorizontal size={16} /> 批量编辑</button>}
          <button className="button primary" disabled={Boolean(busy)} onClick={() => setModal({ type: "modelForm", mode: "add", provider: provider.name })}>
            <Plus size={17} /> 添加模型
          </button>
        </div>
      </div>
      {reviewCount > 0 && <div className="form-note capability-review-note"><TriangleAlert size={16} /><span><strong>{reviewCount} 个模型的能力或上下文尚未确认。</strong>未知模型默认放宽为可接收图片，但 Reasoning 仍保持关闭；上下文未知时使用 200K fallback。打开模型编辑后确认服务端信息。</span><button className="button secondary compact" onClick={() => { void act("repairModelCapabilities", { provider: provider.name }, result => result.changed?.length ? `已修复 ${result.changed.length} 个已知模型的能力/上下文` : "没有可自动修复的已知模型").catch(() => {}); }}>修复已知能力</button></div>}

      <div className="table-surface">
        <div className="table-head model-grid">
          <span className="model-head-label"><input type="checkbox" checked={allVisibleSelected} disabled={filteredModels.length === 0 || Boolean(busy)} onChange={event => toggleVisibleSelection(event.target.checked)} aria-label="选择当前筛选结果" /><span>模型</span></span><span>上下文</span><span>最大输出</span><span>推理</span><span>输入</span><span>成本</span><span />
        </div>
        {provider.modelObjects.length === 0 ? (
          <EmptyState icon={Cpu} title="尚未配置模型" action="添加模型" onAction={() => setModal({ type: "modelForm", mode: "add", provider: provider.name })} />
        ) : filteredModels.length === 0 ? (
          <EmptyState icon={Search} title="没有匹配的模型" action="清除筛选" actionIcon={X} onAction={() => { setQuery(""); setFilter("all"); }} />
        ) : filteredModels.map(model => {
          const active = data.settings.defaultProvider === provider.name && data.settings.defaultModel === model.id;
          const capabilities = inspectModelCapabilities(model);
          const context = capabilities.contextWindowConfidence === "unknown" ? `${formatTokens(capabilities.contextWindow)}（待确认）` : formatTokens(capabilities.contextWindow);
          const contextTitle = capabilities.contextWindowSource ? `上下文来源：${capabilities.contextWindowSource}` : "上下文来源待确认";
          const reasoning = capabilities.reasoningConfidence === "unknown" ? "待确认" : capabilities.reasoning ? "支持" : "关闭";
          const input = capabilities.inputConfidence === "unknown" ? `${(model.input || ["text"]).join(", ")}（推断）` : (model.input || ["text"]).join(", ");
          return (
            <div className={`table-row model-grid ${active ? "active" : ""}`} key={model.id}>
              <div className="model-name"><input className="model-select-checkbox" type="checkbox" checked={selectedIds.has(model.id)} disabled={Boolean(busy)} onChange={event => toggleModelSelection(model.id, event.target.checked)} aria-label={`选择模型 ${model.id}`} /><strong>{model.id}</strong>{active && <span className="badge success">当前</span>}</div>
              <span data-label="上下文" className={capabilities.contextWindowConfidence === "unknown" ? "capability-unknown" : ""} title={contextTitle}>{context}</span>
              <span data-label="最大输出">{formatTokens(model.maxTokens)}</span>
              <span data-label="推理" className={capabilities.reasoningConfidence === "unknown" ? "capability-unknown" : ""}>{reasoning}</span>
              <span data-label="输入" className={capabilities.inputConfidence === "unknown" ? "capability-unknown" : ""}>{input}</span>
              <span data-label="成本" className="model-cost">{formatCost(model.cost)}{model.source && <small>{model.source}</small>}</span>
              <div className="inline-actions">
                {!active && <IconButton label="使用模型" onClick={() => { void act("activateProvider", { provider: provider.name, model: model.id }, `已启用 ${model.id}`).catch(() => {}); }}><Check size={16} /></IconButton>}
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

function McpPage({ rows, cwd, act, busy, setModal }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = rows.filter(server => {
    const haystack = `${server.name} ${server.command || ""} ${server.effectiveLayer || ""}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
    if (filter === "enabled") return !server.disabled;
    if (filter === "disabled") return server.disabled;
    return true;
  });

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div className="toolbar-filters">
          <SearchField value={query} onChange={setQuery} placeholder="搜索 MCP 名称、命令" />
          <label className="select-control compact">
            <span>状态</span>
            <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">全部服务</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
            </select>
          </label>
        </div>
        <button className="button primary" onClick={() => setModal({ type: "mcpForm", mode: "add", cwd })}>
          <Plus size={17} /> 添加 MCP
        </button>
      </div>
      <div className="table-surface">
      <div className="table-head mcp-grid"><span>服务</span><span>命令</span><span>配置层</span><span>生命周期</span><span>操作</span></div>
      {rows.length === 0 ? <EmptyState icon={Server} title="尚未配置 MCP 服务" /> : filtered.length === 0 ? <EmptyState icon={Search} title="没有匹配的 MCP 服务" action="清除筛选" actionIcon={X} onAction={() => { setQuery(""); setFilter("all"); }} /> : filtered.map(server => (
        <div className="table-row mcp-grid" key={server.name}>
          <div className="server-name"><div className="mini-icon"><Server size={17} /></div><div><strong>{server.name}</strong>{server.envKeys?.length > 0 && <small className="server-env-hint">环境变量 {server.envKeys.length} 个</small>}</div></div>
          <code>{server.command}</code>
          <span data-label="配置层">{server.effectiveLayer}</span>
          <span data-label="生命周期">{server.lifecycle}</span>
          <div className="mcp-status-actions">
            <Toggle
              checked={!server.disabled}
              disabled={busy === `mcp:${server.name}`}
              label={`${server.disabled ? "启用" : "停用"} ${server.name}`}
              onChange={() => { void act("toggleMcp", { name: server.name, disabled: !server.disabled, cwd }, `${server.name} 已${server.disabled ? "启用" : "停用"}`, { busyKey: `mcp:${server.name}` }).catch(() => {}); }}
            />
            <IconButton label={`编辑 ${server.name}`} onClick={() => setModal({ type: "mcpForm", mode: "edit", server, cwd })}><Pencil size={15} /></IconButton>
            <IconButton label={server.canDelete ? `删除 ${server.name}` : `共享层服务不可删除`} danger disabled={!server.canDelete || busy === "deleteMcp"} onClick={() => setModal({ type: "confirm", title: `删除 ${server.name}？`, body: "只会删除 Pi 自有配置层中的定义，不会修改共享 MCP 配置。", confirmLabel: "删除 MCP", danger: true, action: () => act("deleteMcp", { name: server.name, cwd }, `${server.name} 已删除`) })}><Trash2 size={15} /></IconButton>
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function SkillsPage({ data, act, setModal }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = data.skillCatalog.filter(skill => `${skill.name} ${skill.description || ""} ${skill.from || ""}`.toLowerCase().includes(normalizedQuery));

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div className="toolbar-filters"><SearchField value={query} onChange={setQuery} placeholder="搜索 Skill 名称、描述" /><div className="summary-line">显示 <strong>{filteredSkills.length}</strong> / {data.skillCatalog.length} 个 Skills，来自 <strong>{data.skillPaths.length}</strong> 个路径</div></div>
        <div className="toolbar-actions">
          <button className="button secondary" onClick={() => { void act("pruneSkillPaths", {}, result => result.length ? `已移除 ${result.length} 个无效路径` : "没有无效路径").catch(() => {}); }}>清理无效路径</button>
          <button className="button primary" onClick={() => setModal({ type: "skillPath" })}><Plus size={17} /> 添加路径</button>
        </div>
      </div>
      <div className="path-list">
        {data.skillPaths.length === 0 ? <EmptyState icon={Sparkles} title="尚未配置 Skill 路径" action="添加路径" onAction={() => setModal({ type: "skillPath" })} /> : data.skillPaths.map(path => (
          <article className="path-row" key={path.entry}>
            <div className={`mini-icon ${path.exists ? "" : "error"}`}><FileCode2 size={18} /></div>
            <div className="path-main"><strong>{path.entry}</strong><span>{path.kind === "exclude" ? "排除规则" : `${path.selector === "include" ? "include" : path.kind} · ${path.count} 个 Skills`}</span></div>
            <span className={`badge ${path.exists ? "success" : "danger"}`}>{path.kind === "exclude" ? "规则有效" : path.exists ? "可用" : "路径缺失"}</span>
            <IconButton label="移除路径" danger onClick={() => setModal({ type: "confirm", title: "移除 Skill 路径？", body: path.entry, confirmLabel: "移除路径", danger: true, action: () => act("removeSkillPath", { path: path.entry }, "Skill 路径已移除") })}><Trash2 size={16} /></IconButton>
          </article>
        ))}
      </div>
      <section className="catalog-section">
        <div className="section-heading"><div><h2>已发现的 Skills</h2><p>从当前 Skill 路径读取到的能力，可按名称或描述快速定位。</p></div></div>
        <div className="skill-list">
          {filteredSkills.length === 0 ? <EmptyState icon={Search} title={data.skillCatalog.length ? "没有匹配的 Skill" : "尚未发现 Skill"} action={normalizedQuery ? "清除搜索" : undefined} actionIcon={X} onAction={() => setQuery("")} /> : filteredSkills.map(skill => (
            <article className="skill-row" key={`${skill.name}-${skill.from}`}>
              <div className="mini-icon"><Sparkles size={17} /></div>
              <div className="skill-main"><strong>{skill.name}</strong><span>{skill.description || "暂无描述"}</span></div>
              <code>{skill.from}</code>
            </article>
          ))}
        </div>
      </section>
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
          <button className="button primary compact" disabled={!profile.exists || busy === `profile:${profile.name}`} onClick={() => { void act("launchProfile", { name: profile.name }, `已在终端中打开 ${profile.label}`, { reload: false, busyKey: `profile:${profile.name}` }).catch(() => {}); }}>
            <Play size={15} /> 启动
          </button>
        </article>
      ))}
    </div>
  );
}

function ModalHost({ modal, data, close, updateModal, clearHistory, act, busy }) {
  const runAndClose = async (action, payload, success, options) => {
    try {
      const result = await act(action, payload, success, options);
      if (result?.skipped) return;
      close();
    } catch {
      // The toast keeps the error visible while the form remains open.
    }
  };

  if (modal.type === "providerForm") {
    return <ProviderForm modal={modal} apiTypes={data.apiTypes} providerNames={data.providers.map(provider => provider.name)} providerPresets={data.providerPresets || []} keychainAvailable={data.keychainAvailable} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "providerCatalog") {
    const runCatalogAction = async action => {
      try {
        const result = await act(
          action,
          {},
          null,
        );
        if (result?.skipped) return;
        updateModal(current => current?.type === "providerCatalog"
          ? { ...current, result: action === "syncProviderCatalog" ? result : null }
          : current);
      } catch {
        // act already keeps the failure visible in the toast.
      }
    };
    return <ProviderCatalogModal
      catalog={data.providerCatalog}
      result={modal.result}
      close={close}
      sync={() => runCatalogAction("syncProviderCatalog")}
      reset={() => runCatalogAction("resetProviderCatalog")}
      busy={busy}
    />;
  }
  if (modal.type === "duplicateProvider") {
    return <DuplicateProviderModal provider={modal.provider} data={data} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "modelForm") {
    return <ModelForm modal={modal} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "batchModelForm") {
    return <BatchModelForm modal={modal} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "key") {
    return <KeyForm provider={modal.provider} keychainAvailable={data.keychainAvailable} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "skillPath") {
    return <SimpleInputModal title="添加 Skill 路径" label="路径" placeholder="~/.pi/agent/skills" close={close} submit={value => runAndClose("addSkillPath", { path: value }, "Skill 路径已添加")} busy={busy} />;
  }
  if (modal.type === "activate") {
    return <ActivateModal provider={modal.provider} close={close} submit={model => runAndClose("activateProvider", { provider: modal.provider.name, model }, `已启用 ${modal.provider.name}/${model}`)} busy={busy} />;
  }
  if (modal.type === "confirm") {
    return <ConfirmModal modal={modal} close={close} />;
  }
  if (modal.type === "doctor") {
    return <DoctorModal modal={modal} close={close} probe={async () => {
      updateModal(current => current?.type === "doctor" ? { ...current, probeLoading: true, probeError: "" } : current);
      try {
        const findings = await callBridge("doctor", { probe: true });
        updateModal(current => current?.type === "doctor" ? {
          ...current,
          probeLoading: false,
          probeError: "",
          probed: true,
          findings,
        } : current);
      } catch (error) {
        updateModal(current => current?.type === "doctor" ? {
          ...current,
          probeLoading: false,
          probeError: error?.message || String(error),
        } : current);
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
  if (modal.type === "modelCheck") {
    return (
      <Dialog title="模型列表检查" close={close}>
        <div className="dialog-body connection-error-detail">
          <p><strong>{modal.provider.name}</strong> 的真实对话已经成功，但服务端模型列表接口没有返回可比较的模型。</p>
          <StageList stages={modal.health?.stages} />
          <pre>{modal.health?.modelCheck?.error || "服务端返回了空的模型列表"}</pre>
        </div>
        <div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div>
      </Dialog>
    );
  }
  if (modal.type === "testHistory") {
    return <TestHistoryModal
      provider={modal.provider}
      history={modal.history}
      close={close}
      onClear={() => updateModal({
        type: "confirm",
        title: `清除 ${modal.provider.name} 的测试历史？`,
        body: "只会清除 Pi Switch 本地保存的阶段摘要，不会修改 Provider 配置或密钥。",
        confirmLabel: "清除历史",
        danger: true,
        action: () => clearHistory(modal.provider.name),
      })}
    />;
  }
  if (modal.type === "connectionError") {
    const diagnosis = diagnoseProviderError(modal.health?.error);
    return (
      <Dialog title="连接测试失败" close={close}>
        <div className="dialog-body connection-error-detail">
          {diagnosis && <div className="connection-diagnosis"><strong>{diagnosis.title}</strong><p>{diagnosis.message}</p></div>}
          <p><strong>{modal.provider.name}/{modal.health?.model || modal.provider.defaultModel || modal.provider.models[0]}</strong> 未能完成一次真实对话请求：</p>
          <StageList stages={modal.health?.stages} />
          <pre>{modal.health?.error || "未返回具体错误"}</pre>
        </div>
        <div className="dialog-footer"><button className="button primary" onClick={close}>完成</button></div>
      </Dialog>
    );
  }
  if (modal.type === "sync") {
    const count = modal.result.diff?.extra?.length || 0;
    const capabilityUpdates = modal.result.capabilityUpdates || [];
    const total = count + capabilityUpdates.length;
    return (
      <Dialog title="同步模型" close={close}>
        <div className="dialog-body">
          <p>{count || capabilityUpdates.length ? `${modal.provider.name} 的服务端检查发现 ${count ? `${count} 个新模型` : "没有新模型"}${capabilityUpdates.length ? `，以及 ${capabilityUpdates.length} 个已有模型的能力声明更新` : ""}。` : "当前模型列表和能力信息已是最新状态。"}</p>
          {count > 0 && <div className="preview-list">{modal.result.diff.extra.map(id => <code key={id}>{id}</code>)}</div>}
          {capabilityUpdates.length > 0 && <div className="sync-capability-preview"><strong>将刷新服务端已明确声明的能力</strong>{capabilityUpdates.map(update => <div key={update.id}><code>{update.id}</code><span>{update.fields.join("、")}</span></div>)}<small>手动编辑或已确认的能力不会被覆盖。</small></div>}
        </div>
        <div className="dialog-footer"><button className="button secondary" onClick={close} disabled={busy === "syncProvider"}>取消</button>{total > 0 && <button className="button primary" disabled={busy === "syncProvider"} onClick={() => runAndClose("syncProvider", { name: modal.provider.name, apply: true }, result => `已同步 ${result.capabilityRefresh?.changed?.length || 0} 个能力更新${count ? `，添加 ${count} 个模型` : ""}`)}>{busy === "syncProvider" && <LoaderCircle size={16} className="spin" />}应用同步</button>}</div>
      </Dialog>
    );
  }
  if (modal.type === "import") {
    return <ImportModal preview={modal.preview} keychainAvailable={data.keychainAvailable} close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "restoreConfig") {
    return <ConfigTransferModal close={close} submit={runAndClose} busy={busy} />;
  }
  if (modal.type === "agent") return <AgentModal agent={modal.agent} close={close} />;
  if (modal.type === "mcpForm") return <McpForm modal={modal} close={close} submit={runAndClose} busy={busy} />;
  return null;
}

function ConfigMenu({ onExport, onRestore }) {
  const closeMenu = event => event.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <details className="toolbar-menu">
      <summary className="button secondary"><Settings2 size={16} /> 配置 <ChevronDown size={14} /></summary>
      <div className="toolbar-menu-panel">
        <button type="button" onClick={event => { closeMenu(event); onExport(); }}><Download size={15} /> 导出脱敏配置</button>
        <button type="button" onClick={event => { closeMenu(event); onRestore(); }}><Upload size={15} /> 恢复配置</button>
      </div>
    </details>
  );
}

function ProviderCatalogModal({ catalog, result, close, sync, reset, busy }) {
  const source = catalog?.source === "remote-cache" ? "远程缓存" : "内置模板";
  const syncing = busy === "syncProviderCatalog";
  const resetting = busy === "resetProviderCatalog";
  const changes = result?.changes;
  const changeCount = (changes?.added?.length || 0) + (changes?.updated?.length || 0) + (changes?.removed?.length || 0);
  return (
    <Dialog title="Provider 模板目录" close={close}>
      <div className="dialog-body catalog-dialog">
        <div className="catalog-source-line">
          <div>
            <span>当前来源</span>
            <strong>{source}</strong>
          </div>
          <span className={`badge ${catalog?.source === "remote-cache" ? "success" : "outline"}`}>{catalog?.remotePresetCount || 0} 个远程模板</span>
        </div>
        <dl className="catalog-meta">
          <div><dt>目录版本</dt><dd>{catalog?.updatedAt ? formatDateTime(catalog.updatedAt) : "随应用发布"}</dd></div>
          <div><dt>上次同步</dt><dd>{catalog?.fetchedAt ? formatDateTime(catalog.fetchedAt) : "尚未同步"}</dd></div>
          {catalog?.sha256 && <div><dt>内容指纹</dt><dd><code>{catalog.sha256.slice(0, 12)}</code></dd></div>}
        </dl>
        {catalog?.error && <div className="catalog-warning"><TriangleAlert size={16} /><span>{catalog.error}</span></div>}
        {result && (
          <div className="catalog-result">
            <div><CircleCheck size={17} /><strong>{changeCount ? "目录已更新" : "已经是最新目录"}</strong></div>
            <p>{result.presetCount} 个模板通过格式、字段和完整性校验。</p>
            {changeCount > 0 && <div className="catalog-change-list">
              {changes.added.map(id => <span key={`add-${id}`}>新增 {id}</span>)}
              {changes.updated.map(id => <span key={`update-${id}`}>更新 {id}</span>)}
              {changes.removed.map(id => <span key={`remove-${id}`}>移除 {id}</span>)}
            </div>}
          </div>
        )}
        <div className="form-note catalog-note">
          <ShieldCheck size={17} />
          <span>同步只下载公开端点模板并写入独立缓存；不会上传 API Key，也不会修改现有 Provider。</span>
        </div>
      </div>
      <div className="dialog-footer">
        {catalog?.source === "remote-cache" && <button className="button secondary" disabled={syncing || resetting} onClick={reset}>{resetting ? <LoaderCircle size={16} className="spin" /> : <Undo2 size={16} />}还原内置模板</button>}
        <button className="button secondary" disabled={syncing || resetting} onClick={close}>关闭</button>
        <button className="button primary" disabled={syncing || resetting} onClick={sync}>{syncing ? <LoaderCircle size={16} className="spin" /> : <CloudDownload size={16} />}同步官方目录</button>
      </div>
    </Dialog>
  );
}

function ProviderForm({ modal, apiTypes, providerNames, providerPresets, keychainAvailable, close, submit, busy }) {
  const provider = modal.provider;
  const [form, setForm] = useState({ name: provider?.name || "", baseUrl: provider?.baseUrl || "", api: provider?.api || apiTypes[0], key: "", model: "", storeKeychain: Boolean(keychainAvailable), presetId: "custom" });
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const nameTaken = modal.mode === "add" && providerNames.includes(form.name.trim());
  const submitting = busy === (modal.mode === "edit" ? "updateProvider" : "addProvider");
  const selectedPreset = providerPresets.find(preset => preset.id === form.presetId);
  const valid = form.name.trim() && form.baseUrl.trim() && form.api && !nameTaken && (modal.mode === "edit" || (form.key.trim() && form.model.trim()));
  const applyPreset = id => {
    const preset = providerPresets.find(item => item.id === id);
    if (!preset || id === "custom") {
      change("presetId", id);
      return;
    }
    setForm(current => ({ ...current, presetId: id, name: preset.name, baseUrl: preset.baseUrl, api: preset.api, model: preset.model }));
  };
  return (
    <Dialog title={modal.mode === "edit" ? `编辑 ${provider.name}` : "添加 Provider"} close={close}>
      <form onSubmit={event => { event.preventDefault(); if (modal.mode === "edit") submit("updateProvider", { name: provider.name, baseUrl: form.baseUrl, api: form.api }, "Provider 已更新"); else submit("addProvider", form, "Provider 已添加"); }}>
        <div className="dialog-body form-grid">
          {modal.mode === "add" && providerPresets.length > 0 && <Field label="快速模板" wide><select value={form.presetId} onChange={event => applyPreset(event.target.value)}><option value="custom">自定义 Provider</option>{providerPresets.filter(preset => preset.id !== "custom").map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select>{selectedPreset?.description && <small className="field-help">{selectedPreset.description}</small>}</Field>}
          <Field label="Provider 名称"><input value={form.name} disabled={modal.mode === "edit"} onChange={event => change("name", event.target.value)} placeholder="例如：米醋中转" /></Field>
          {nameTaken && <small className="field-error name-taken wide">这个 Provider 名称已经存在，添加操作不会覆盖现有配置。</small>}
          <Field label="API 格式"><select value={form.api} onChange={event => change("api", event.target.value)}>{apiTypes.map(api => <option key={api} value={api}>{api}</option>)}</select></Field>
          <Field label="Base URL" wide><input value={form.baseUrl} onChange={event => change("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></Field>
          {modal.mode === "add" && <><Field label="首个模型" wide><input value={form.model} onChange={event => change("model", event.target.value)} placeholder="claude-sonnet-5" /></Field><Field label="API 密钥" wide><input type="password" value={form.key} onChange={event => change("key", event.target.value)} autoComplete="off" /></Field>{keychainAvailable ? <label className="check-row wide"><input type="checkbox" checked={form.storeKeychain} onChange={event => change("storeKeychain", event.target.checked)} /><span><strong>存入 macOS Keychain</strong><small>models.json 中只保留读取命令。</small></span></label> : <div className="form-note wide"><strong>当前平台没有 macOS Keychain</strong><span>密钥会按明文写入本地配置，请确认文件权限并在支持的平台上迁移。</span></div>}</>}
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!valid || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}{modal.mode === "edit" ? "保存修改" : "添加 Provider"}</button></div>
      </form>
    </Dialog>
  );
}

function DuplicateProviderModal({ provider, data, close, submit, busy }) {
  const existingNames = new Set(data.providers.map(item => item.name));
  const suggested = `${provider.name}-副本`;
  const [name, setName] = useState(suggested);
  const trimmed = name.trim();
  const duplicate = trimmed && existingNames.has(trimmed);
  const same = trimmed === provider.name;
  const valid = trimmed && !duplicate && !same;
  const submitting = busy === "duplicateProvider";

  return (
    <Dialog title={`复制 ${provider.name}`} close={close}>
      <form onSubmit={event => {
        event.preventDefault();
        if (valid) submit("duplicateProvider", { source: provider.name, name: trimmed }, result => `已复制为 ${result.name}`);
      }}>
        <div className="dialog-body form-grid">
          <Field label="新 Provider 名称" wide>
            <input value={name} onChange={event => setName(event.target.value)} autoFocus placeholder={suggested} />
            {duplicate && <small className="field-error">这个名称已经存在，请换一个名称。</small>}
            {same && <small className="field-error">新名称必须与原 Provider 不同。</small>}
          </Field>
          <div className="form-note wide">
            <strong>会复制什么？</strong>
            <span>会复制 Base URL、API 类型和 {provider.models.length} 个模型。API 密钥不会被读取或显示，复制后仍引用原 Provider 的同一份密钥配置。</span>
          </div>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!valid || submitting}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Copy size={16} />}复制 Provider</button></div>
      </form>
    </Dialog>
  );
}

function ImportModal({ preview, keychainAvailable, close, submit, busy }) {
  const count = preview.importable.length;
  const submitting = busy === "importAll";
  const [storeKeychain, setStoreKeychain] = useState(Boolean(keychainAvailable));
  const successMessage = result => {
    const storage = result.keychainCount > 0
      ? `${result.keychainCount} 个密钥已存入 Keychain`
      : result.plaintextCount > 0
        ? `${result.plaintextCount} 个密钥保留在明文配置中`
        : "没有需要迁移的密钥";
    return `已导入 ${result.count} 个 Provider，${storage}`;
  };

  return (
    <Dialog title="从 CC Switch 导入" close={close}>
      <div className="dialog-body">
        <p>{count ? `有 ${count} 个 Provider 可导入，且不会覆盖现有配置。` : "没有可导入的 Provider。"}</p>
        <div className="preview-list">{preview.importable.map(row => <div key={row.targetName}><strong>{row.targetName}</strong><span>{row.appType}</span></div>)}</div>
        {count > 0 && keychainAvailable ? (
          <label className="check-row import-storage-choice"><input type="checkbox" checked={storeKeychain} onChange={event => setStoreKeychain(event.target.checked)} /><span><strong>将导入的密钥存入 macOS Keychain</strong><small>{storeKeychain ? "models.json 只保留 Keychain 读取命令。" : "关闭后会按原配置写入，密钥可能以明文保存在 models.json。"}</small></span></label>
        ) : count > 0 ? (
          <div className="form-note import-storage-choice"><strong>当前平台没有 macOS Keychain</strong><span>导入会保留原凭据形式，请在支持的平台上再迁移到安全存储。</span></div>
        ) : null}
      </div>
      <div className="dialog-footer"><button className="button secondary" onClick={close} disabled={submitting}>取消</button>{count > 0 && <button className="button primary" disabled={submitting} onClick={() => submit("importAll", { storeKeychain }, successMessage)}>{submitting && <LoaderCircle size={16} className="spin" />}全部导入</button>}</div>
    </Dialog>
  );
}

function ConfigTransferModal({ close, submit, busy }) {
  const [fileName, setFileName] = useState("");
  const [config, setConfig] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const submitting = busy === "restoreConfig";

  const chooseFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setError("");
    setPreview(null);
    try {
      const parsed = JSON.parse(await file.text());
      const summary = await callBridge("previewRestore", { config: parsed });
      setFileName(file.name);
      setConfig(parsed);
      setPreview(summary);
    } catch (err) {
      setConfig(null);
      setError(err?.message || String(err));
    } finally {
      setReading(false);
    }
  };

  const successMessage = result => {
    const warning = result.warnings?.length ? `，${result.warnings.length} 条设置被保留` : "";
    return `已恢复 ${result.providersAdded + result.providersUpdated} 个 Provider、${result.modelsImported} 个模型${warning}`;
  };

  return (
    <Dialog title="恢复 Pi Switch 配置" close={close}>
      <div className="dialog-body">
        <div className="form-note">
          <strong>恢复文件不包含 API 密钥</strong>
          <span>同名 Provider 会保留本机现有的 Keychain、环境变量或命令引用；新 Provider 导入后需要单独更新密钥。恢复前会自动创建备份。</span>
        </div>
        <label className="file-picker">
          <input type="file" accept="application/json,.json" onChange={chooseFile} />
          <FileJson size={18} />
          <span>{reading ? "正在检查配置文件…" : fileName || "选择 Pi Switch 导出文件"}</span>
          <Upload size={15} />
        </label>
        {error && <div className="field-error transfer-error">{error}</div>}
        {preview && (
          <div className="transfer-preview">
            <div className="transfer-summary">
              <div><strong>{preview.providersAdded + preview.providersUpdated}</strong><span>个 Provider</span></div>
              <div><strong>{preview.modelsImported}</strong><span>个模型</span></div>
              <div><strong>{preview.keysPreserved}</strong><span>个密钥引用保留</span></div>
            </div>
            {preview.warnings?.length > 0 && <div className="finding-list">{preview.warnings.map((warning, index) => <div className="finding warn" key={index}><TriangleAlert size={17} /><p>{warning}</p></div>)}</div>}
          </div>
        )}
      </div>
      <div className="dialog-footer"><button className="button secondary" onClick={close} disabled={submitting}>取消</button><button className="button primary" disabled={!config || reading || submitting} onClick={() => submit("restoreConfig", { config }, successMessage)}>{submitting && <LoaderCircle size={16} className="spin" />}恢复配置</button></div>
    </Dialog>
  );
}

function McpForm({ modal, close, submit, busy }) {
  const server = modal.server;
  const [form, setForm] = useState({
    name: server?.name || "",
    transport: server?.url ? "url" : "command",
    url: server?.url || "",
    command: server?.commandName || "",
    args: server?.args?.join("\n") || "",
    lifecycle: server?.lifecycle || "eager",
    env: "",
  });
  const [envError, setEnvError] = useState("");
  const submitting = busy === "upsertMcp";
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const parseEnv = () => {
    const result = {};
    for (const line of form.env.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error(`环境变量格式错误：${line}`);
      const key = line.slice(0, separator).trim();
      if (!key) throw new Error(`环境变量名称不能为空：${line}`);
      result[key] = line.slice(separator + 1);
    }
    return result;
  };

  const valid = Boolean(form.name.trim() && (form.transport === "url" ? form.url.trim() : form.command.trim()));
  const save = event => {
    event.preventDefault();
    if (!valid || submitting) return;
    try {
      const env = form.env.trim() ? parseEnv() : undefined;
      setEnvError("");
      const payload = {
        name: form.name.trim(),
        scope: "global",
        cwd: modal.cwd,
        lifecycle: form.lifecycle,
        ...(form.transport === "url"
          ? { url: form.url.trim() }
          : { command: form.command.trim(), args: form.args.split(/\r?\n/).map(value => value.trim()).filter(Boolean) }),
        ...(env ? { env } : {}),
      };
      submit("upsertMcp", payload, modal.mode === "edit" ? "MCP 已更新" : "MCP 已添加");
    } catch (error) {
      setEnvError(error?.message || String(error));
    }
  };

  return (
    <Dialog title={modal.mode === "edit" ? `编辑 ${server.name}` : "添加 MCP"} close={close}>
      <form onSubmit={save}>
        <div className="dialog-body form-grid">
          <Field label="名称" wide><input value={form.name} disabled={modal.mode === "edit" || submitting} onChange={event => change("name", event.target.value)} placeholder="例如：context7" /></Field>
          <Field label="传输方式"><select value={form.transport} disabled={submitting} onChange={event => change("transport", event.target.value)}><option value="command">本地命令</option><option value="url">远程 URL</option></select></Field>
          <Field label="生命周期"><select value={form.lifecycle} disabled={submitting} onChange={event => change("lifecycle", event.target.value)}><option value="eager">eager（启动时）</option><option value="lazy">lazy（需要时）</option></select></Field>
          {form.transport === "url" ? (
            <Field label="服务 URL" wide><input value={form.url} disabled={submitting} onChange={event => change("url", event.target.value)} placeholder="https://mcp.example.com/sse" /></Field>
          ) : (
            <>
              <Field label="命令" wide><input value={form.command} disabled={submitting} onChange={event => change("command", event.target.value)} placeholder="npx" /></Field>
              <Field label="参数（每行一个）" wide><textarea value={form.args} disabled={submitting} onChange={event => change("args", event.target.value)} placeholder="-y\n@upstash/context7-mcp" rows={4} /></Field>
            </>
          )}
          <Field label="环境变量（每行 KEY=value）" wide>
            <textarea value={form.env} disabled={submitting} onChange={event => { change("env", event.target.value); setEnvError(""); }} placeholder={server?.envKeys?.length ? `已存在 ${server.envKeys.length} 个环境变量；留空表示保留现有值` : "API_KEY=从环境变量或密钥管理器读取"} rows={4} />
            {envError && <small className="field-error">{envError}</small>}
            {server?.envKeys?.length > 0 && <small className="field-help">当前服务已有：{server.envKeys.join(", ")}。Pi Switch 不会把现有值回显到界面。</small>}
          </Field>
          <div className="form-note wide"><strong>配置范围：Pi 全局层</strong><span>共享 MCP 文件保持只读；编辑共享服务只会写入 Pi 的覆盖层，删除也只删除 Pi 自有定义。</span></div>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!valid || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}{modal.mode === "edit" ? "保存修改" : "添加 MCP"}</button></div>
      </form>
    </Dialog>
  );
}

function StageList({ stages }) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  return (
    <div className="stage-list" aria-label="连接测试阶段">
      {stages.map(stage => (
        <div className={`stage-row ${stage.ok ? "ok" : "failed"}`} key={stage.id}>
          {stage.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <strong>{stage.label}</strong>
          <span>{stage.ms != null ? `${stage.ms} ms` : "—"}</span>
          <small>{stage.detail}</small>
        </div>
      ))}
    </div>
  );
}

function TestHistoryModal({ provider, history, close, onClear }) {
  return (
    <Dialog title={`${provider.name} · 测试历史`} close={close}>
      <div className="dialog-body">
        {history.length === 0 ? <p>还没有保存的连接测试记录。</p> : <div className="history-list">{history.map((entry, index) => (
          <article className={`history-entry ${entry.ok ? "ok" : "failed"}`} key={`${entry.testedAt}-${index}`}>
            <div className="history-entry-head">
              <strong>{entry.ok ? "连接成功" : "连接失败"}</strong>
              <span>{formatDateTime(entry.testedAt)}</span>
            </div>
            <div className="history-entry-meta"><span>{entry.model || "未选择模型"}</span><span>{entry.ms} ms</span>{entry.modelCheck && <span>{entry.modelCheck.ok ? `模型列表 ${entry.modelCheck.modelCount ?? 0} 个` : "模型列表未知"}</span>}</div>
            {entry.stages?.length > 0 && <div className="history-stage-line">{entry.stages.map(stage => <span key={stage.id} className={stage.ok ? "ok" : "failed"}>{stage.label} {stage.ms} ms</span>)}</div>}
          </article>
        ))}</div>}
      </div>
      <div className="dialog-footer">{history.length > 0 && <button className="button danger" onClick={onClear}><Trash2 size={15} /> 清除当前历史</button>}<button className="button primary" onClick={close}>完成</button></div>
    </Dialog>
  );
}

function ModelForm({ modal, close, submit, busy }) {
  const inputCapability = modal.model?.capabilities?.input;
  const reasoningCapability = modal.model?.capabilities?.reasoning;
  const inputIsLocked = inputCapability?.source === "manual" || inputCapability?.confidence === "confirmed";
  const reasoningIsLocked = reasoningCapability?.source === "manual" || reasoningCapability?.confidence === "confirmed";
  const initialContext = modal.model?.contextWindow ?? inferModelContextWindow("").contextWindow;
  const [form, setForm] = useState({
    id: modal.model?.id || "",
    contextWindow: initialContext,
    maxTokens: modal.model?.maxTokens || 32768,
    reasoning: modal.model?.reasoning || false,
    input: modal.model?.input || ["text"],
    source: modal.model?.source || "",
    costInput: modal.model?.cost?.input ?? 0,
    costOutput: modal.model?.cost?.output ?? 0,
    costCacheRead: modal.model?.cost?.cacheRead ?? 0,
    costCacheWrite: modal.model?.cost?.cacheWrite ?? 0,
  });
  // Preserve confirmed evidence in the form, but do not turn a legacy/inferred
  // row into a manual override merely because an unrelated field was edited.
  const [inputTouched, setInputTouched] = useState(inputIsLocked);
  const [reasoningTouched, setReasoningTouched] = useState(reasoningIsLocked);
  const [contextTouched, setContextTouched] = useState(false);
  const change = (key, value) => {
    if (key === "contextWindow") setContextTouched(true);
    setForm(current => {
      if (key === "id" && !contextTouched) {
        return { ...current, id: value, contextWindow: inferModelContextWindow(value).contextWindow };
      }
      return { ...current, [key]: value };
    });
  };
  const inferred = form.id.trim() ? inferModelCapabilities(form.id, {}) : { input: ["text"], reasoning: false };
  const contextInferred = form.id.trim() ? inferModelContextWindow(form.id) : inferModelContextWindow("");
  const displayedInput = inputTouched ? form.input : inferred.input;
  const displayedReasoning = reasoningTouched ? form.reasoning : inferred.reasoning;
  const toggleInput = type => {
    setInputTouched(true);
    setForm(current => {
      const base = inputTouched ? current.input : displayedInput;
      return { ...current, input: base.includes(type) ? base.filter(item => item !== type) : [...base, type] };
    });
  };
  const canSave = Boolean(form.id.trim() && (!inputTouched || form.input.length > 0));
  const submitting = busy === "upsertModel";
  const numeric = value => Number(value) || 0;
  const saveModel = {
    id: form.id.trim(),
    ...(contextTouched ? { contextWindow: numeric(form.contextWindow) } : {}),
    maxTokens: numeric(form.maxTokens),
    source: form.source.trim() || undefined,
    cost: { input: numeric(form.costInput), output: numeric(form.costOutput), cacheRead: numeric(form.costCacheRead), cacheWrite: numeric(form.costCacheWrite) },
    ...(inputTouched ? { input: form.input } : {}),
    ...(reasoningTouched ? { reasoning: form.reasoning } : {}),
  };
  return (
    <Dialog title={modal.mode === "edit" ? `编辑 ${modal.model.id}` : "添加模型"} close={close}>
      <form onSubmit={event => { event.preventDefault(); submit("upsertModel", { provider: modal.provider, model: saveModel }, modal.mode === "edit" ? "模型已更新" : "模型已添加"); }}>
        <div className="dialog-body form-grid">
          <Field label="Model ID" wide><input value={form.id} disabled={modal.mode === "edit"} onChange={event => change("id", event.target.value)} /></Field>
          <Field label="上下文窗口"><input type="number" min="1" value={form.contextWindow} onChange={event => change("contextWindow", event.target.value)} /><small>{contextTouched ? "手动确认；不会被自动同步覆盖。" : modal.model ? "保留当前值；修改此字段后会记录为手动确认。" : `按模型目录推断：${formatTokens(contextInferred.contextWindow)}（${contextInferred.contextWindowSource}）`}</small></Field>
          <Field label="最大输出 Token"><input type="number" min="1" value={form.maxTokens} onChange={event => change("maxTokens", event.target.value)} /></Field>
          <Field label="来源"><input value={form.source} onChange={event => change("source", event.target.value)} placeholder="例如：官方文档 / models.dev" /></Field>
          <fieldset className="cost-field wide"><legend>成本（USD / 1M tokens）</legend><div className="cost-grid">
            <Field label="输入"><input type="number" min="0" step="any" value={form.costInput} onChange={event => change("costInput", event.target.value)} /></Field>
            <Field label="输出"><input type="number" min="0" step="any" value={form.costOutput} onChange={event => change("costOutput", event.target.value)} /></Field>
            <Field label="缓存读取"><input type="number" min="0" step="any" value={form.costCacheRead} onChange={event => change("costCacheRead", event.target.value)} /></Field>
            <Field label="缓存写入"><input type="number" min="0" step="any" value={form.costCacheWrite} onChange={event => change("costCacheWrite", event.target.value)} /></Field>
          </div><small>Pi 使用每百万 Token 的费率估算成本；未知价格可保留为 0。</small></fieldset>
          <fieldset className="modality-field wide"><legend>输入类型</legend><div className="modality-options">{["text", "image"].map(type => <label key={type}><input type="checkbox" checked={displayedInput.includes(type)} disabled={displayedInput.length === 1 && displayedInput.includes(type)} onChange={() => toggleInput(type)} /><span>{type === "text" ? "文本" : "图片"}</span></label>)}</div><small>{inputTouched ? "只声明服务端真实支持的输入类型；至少保留一种。" : "当前按模型名推断；明确修改后才会记录为手动确认。"}</small></fieldset>
          <label className="check-row wide"><input type="checkbox" checked={displayedReasoning} onChange={event => { setReasoningTouched(true); change("reasoning", event.target.checked); }} /><span><strong>支持 Reasoning</strong><small>{reasoningTouched ? "仅当服务端点会转发 thinking 参数时启用。" : "当前按模型名推断；明确修改后才会记录为手动确认。"}</small></span></label>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!canSave || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}保存模型</button></div>
      </form>
    </Dialog>
  );
}

function BatchModelForm({ modal, close, submit, busy }) {
  const models = Array.isArray(modal.models) ? modal.models : [];
  const first = models[0] || {};
  const sameValue = key => models.length > 0 && models.every(model => model[key] === first[key]);
  const inputValue = model => model.input?.includes("image") ? "text,image" : "text";
  const sameInput = models.length > 0 && models.every(model => inputValue(model) === inputValue(first));
  const reasoningValue = model => model.reasoning ? "on" : "off";
  const sameReasoning = models.length > 0 && models.every(model => reasoningValue(model) === reasoningValue(first));
  const [enabled, setEnabled] = useState({ contextWindow: false, maxTokens: false, input: false, reasoning: false });
  const [form, setForm] = useState({
    contextWindow: sameValue("contextWindow") ? String(first.contextWindow ?? "") : "",
    maxTokens: sameValue("maxTokens") ? String(first.maxTokens ?? "") : "",
    input: sameInput ? inputValue(first) : "",
    reasoning: sameReasoning ? reasoningValue(first) : "",
  });
  const submitting = busy === "batchUpdateModels";
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggleField = key => setEnabled(current => ({ ...current, [key]: !current[key] }));
  const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const patch = {};
  if (enabled.contextWindow) patch.contextWindow = Number(form.contextWindow);
  if (enabled.maxTokens) patch.maxTokens = Number(form.maxTokens);
  if (enabled.input) patch.input = form.input.split(",");
  if (enabled.reasoning) patch.reasoning = form.reasoning === "on";
  const valid = models.length > 0 && Object.keys(patch).length > 0 &&
    (!enabled.contextWindow || positiveInteger(form.contextWindow)) &&
    (!enabled.maxTokens || positiveInteger(form.maxTokens)) &&
    (!enabled.input || ["text", "text,image"].includes(form.input)) &&
    (!enabled.reasoning || ["on", "off"].includes(form.reasoning));

  return (
    <Dialog title={`批量编辑 ${models.length} 个模型`} size="large" close={close}>
      <form onSubmit={event => { event.preventDefault(); if (valid) submit("batchUpdateModels", { provider: modal.provider, ids: models.map(model => model.id), patch }, result => `已更新 ${result.updated.length} 个模型`); }}>
        <div className="dialog-body batch-model-form">
          <div className="form-note wide">
            <strong><ListChecks size={16} /> 只会覆盖已勾选的字段</strong>
            <span>上下文、输入类型和 Reasoning 会记录为手动确认；未勾选的字段与现有能力证据保持不变。</span>
          </div>
          <div className="batch-model-list" aria-label="已选择模型">
            {models.map(model => <span key={model.id}>{model.id}</span>)}
          </div>
          <div className="batch-field-grid">
            <label className="batch-field">
              <span className="batch-field-title"><input type="checkbox" checked={enabled.contextWindow} onChange={() => toggleField("contextWindow")} /><strong>上下文窗口</strong></span>
              <input type="number" min="1" value={form.contextWindow} disabled={!enabled.contextWindow || submitting} onChange={event => change("contextWindow", event.target.value)} placeholder="多个值不同" />
              <small>例如：1,048,576</small>
            </label>
            <label className="batch-field">
              <span className="batch-field-title"><input type="checkbox" checked={enabled.maxTokens} onChange={() => toggleField("maxTokens")} /><strong>最大输出 Token</strong></span>
              <input type="number" min="1" value={form.maxTokens} disabled={!enabled.maxTokens || submitting} onChange={event => change("maxTokens", event.target.value)} placeholder="多个值不同" />
              <small>只影响输出上限，不改变上下文窗口。</small>
            </label>
            <label className="batch-field">
              <span className="batch-field-title"><input type="checkbox" checked={enabled.input} onChange={() => toggleField("input")} /><strong>输入类型</strong></span>
              <select value={form.input} disabled={!enabled.input || submitting} onChange={event => change("input", event.target.value)}>{!sameInput && <option value="" disabled>请选择统一值</option>}<option value="text">文本</option><option value="text,image">文本 + 图片</option></select>
              <small>{sameInput ? "至少保留文本输入。" : "多个模型当前值不同；请选择统一的输入类型。"}</small>
            </label>
            <label className="batch-field">
              <span className="batch-field-title"><input type="checkbox" checked={enabled.reasoning} onChange={() => toggleField("reasoning")} /><strong>Reasoning</strong></span>
              <select value={form.reasoning} disabled={!enabled.reasoning || submitting} onChange={event => change("reasoning", event.target.value)}>{!sameReasoning && <option value="" disabled>请选择统一值</option>}<option value="off">关闭</option><option value="on">开启</option></select>
              <small>{sameReasoning ? "只在服务端确实转发 thinking 时开启。" : "多个模型当前值不同；请选择统一的 Reasoning 状态。"}</small>
            </label>
          </div>
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!valid || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}应用到 {models.length} 个模型</button></div>
      </form>
    </Dialog>
  );
}

function KeyForm({ provider, keychainAvailable, close, submit, busy }) {
  const [key, setKey] = useState("");
  const [storeKeychain, setStoreKeychain] = useState(Boolean(keychainAvailable) && !provider.keyInline);
  const [visible, setVisible] = useState(false);
  const [loadingKey, setLoadingKey] = useState(true);
  const [keyError, setKeyError] = useState("");
  const submitting = busy === "rotateKey";

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
          {keychainAvailable ? <label className="check-row wide"><input type="checkbox" checked={storeKeychain} onChange={event => setStoreKeychain(event.target.checked)} /><span><strong>存入 macOS Keychain</strong><small>建议将本地凭据保存在这里。</small></span></label> : <div className="form-note wide"><strong>当前平台没有 macOS Keychain</strong><span>密钥会按明文写入本地配置。</span></div>}
        </div>
        <div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={loadingKey || submitting}>取消</button><button type="submit" className="button primary" disabled={loadingKey || !key || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}更新密钥</button></div>
      </form>
    </Dialog>
  );
}

function ActivateModal({ provider, close, submit, busy }) {
  const [model, setModel] = useState(provider.defaultModel || provider.models[0]);
  const submitting = busy === "activateProvider";
  return <Dialog title={`使用 ${provider.name}`} close={close}><div className="dialog-body"><Field label="默认模型"><select value={model} onChange={event => setModel(event.target.value)} disabled={submitting}>{provider.models.map(id => <option key={id}>{id}</option>)}</select></Field></div><div className="dialog-footer"><button className="button secondary" onClick={close} disabled={submitting}>取消</button><button className="button primary" disabled={submitting} onClick={() => submit(model)}>{submitting && <LoaderCircle size={16} className="spin" />}启用</button></div></Dialog>;
}

function SimpleInputModal({ title, label, placeholder, close, submit, busy }) {
  const [value, setValue] = useState("");
  const submitting = busy === "addSkillPath";
  return <Dialog title={title} close={close}><form onSubmit={event => { event.preventDefault(); submit(value); }}><div className="dialog-body"><Field label={label}><input value={value} placeholder={placeholder} onChange={event => setValue(event.target.value)} autoFocus disabled={submitting} /></Field></div><div className="dialog-footer"><button type="button" className="button secondary" onClick={close} disabled={submitting}>取消</button><button type="submit" className="button primary" disabled={!value.trim() || submitting}>{submitting && <LoaderCircle size={16} className="spin" />}添加路径</button></div></form></Dialog>;
}

function ConfirmModal({ modal, close }) {
  const [working, setWorking] = useState(false);
  const confirm = async () => {
    setWorking(true);
    try {
      const result = await modal.action();
      if (!result?.skipped) close();
    } catch {
      // The action has already surfaced its error in the toast; keep the
      // confirmation dialog open so the user can inspect or retry it.
    } finally {
      setWorking(false);
    }
  };
  return <Dialog title={modal.title} close={close}><div className="dialog-body"><p>{modal.body}</p></div><div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button><button className={`button ${modal.danger ? "danger" : "primary"}`} disabled={working} onClick={confirm}>{working && <LoaderCircle size={16} className="spin" />}{modal.confirmLabel}</button></div></Dialog>;
}

function DoctorModal({ modal, close, probe }) {
  const errors = modal.findings.filter(item => item.level === "error").length;
  const warnings = modal.findings.filter(item => item.level === "warn").length;
  return (
    <Dialog title="配置诊断" close={close} size="large">
      <div className="dialog-body doctor-body">
        {modal.loading ? <LoadingState compact /> : modal.error ? <ErrorState message={modal.error} /> : <>
          <div className="doctor-summary"><div><strong>{errors}</strong><span>错误</span></div><div><strong>{warnings}</strong><span>警告</span></div><div><strong>{modal.findings.filter(item => item.level === "ok").length}</strong><span>通过</span></div></div>
          {!modal.probed && <div className="doctor-probe-note">当前只检查本地配置；网络检查会逐个请求 Provider 的模型列表，不会发送聊天内容。</div>}
          {modal.probeError && <div className="field-error doctor-probe-error">网络检查失败：{modal.probeError}</div>}
          <div className="finding-list">{modal.findings.map((finding, index) => <div className={`finding ${finding.level}`} key={`${finding.area}-${index}`}>{finding.level === "error" ? <CircleAlert size={17} /> : finding.level === "warn" ? <TriangleAlert size={17} /> : <CircleCheck size={17} />}<div><strong>{finding.area}</strong><p>{finding.message}</p>{finding.fix && <small>{finding.fix}</small>}</div></div>)}</div>
        </>}
      </div>
      <div className="dialog-footer"><button className="button secondary" disabled={modal.loading || modal.probeLoading} onClick={probe}>{modal.probeLoading && <LoaderCircle size={16} className="spin" />} {modal.probeLoading ? "网络检查中" : modal.probed ? "重新运行网络检查" : "运行网络检查"}</button><button className="button primary" onClick={close}>完成</button></div>
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

function EmptyState({ icon: Icon, title, action, actionIcon: ActionIcon = Plus, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={24} /></div><h2>{title}</h2>{action && <button className="button secondary" onClick={onAction}><ActionIcon size={16} />{action}</button>}</div>;
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

function formatCost(cost) {
  if (!cost || typeof cost !== "object") return "未设置";
  const input = Number(cost.input);
  const output = Number(cost.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return "未设置";
  if (input === 0 && output === 0) return "免费/未知";
  return `$${input} / $${output}`;
}

function formatRelativeTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatDateTime(timestamp) {
  const value = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(value)) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}
