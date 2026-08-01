import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error-icon">!</div>
        <h1>Pi Switch 暂时无法显示</h1>
        <p>界面发生了未预期的错误。你的本地配置和密钥没有因此被修改。</p>
        <button className="button primary" type="button" onClick={() => window.location.reload()}>
          重新加载界面
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
