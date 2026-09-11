import { useEffect, useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client";
import type { ContextOption, User } from "../state/types";
import { Icon } from "./Icon";

export function Login({ client, onLogin }: { client: ApiClient; onLogin: (user: User, contexts: ContextOption[]) => void }) {
  const [login, setLogin] = useState("admin@cvg.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<{ status: string; demoOnly: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    void client.get<{ status: string; capabilities: { demoOnly: boolean } }>("/health").then((data) => {
      if (active) setHealth({ status: data.status, demoOnly: data.capabilities.demoOnly });
    }).catch(() => {
      if (active) setHealth(null);
    });
    return () => { active = false; };
  }, [client]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await client.request<{ user: User; contexts: ContextOption[] }>("/auth/login", { method: "POST", body: JSON.stringify({ login, password }) });
      onLogin(result.user, result.contexts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login não concluído.");
    } finally {
      setLoading(false);
    }
  };

  const demo = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await client.request<{ user: User; contexts: ContextOption[] }>("/auth/demo", { method: "POST" });
      onLogin(result.user, result.contexts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Demonstração indisponível.");
    } finally {
      setLoading(false);
    }
  };

  return <div className="login-shell"><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><main className="login-card" aria-labelledby="login-title"><div className="brand-lockup"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPERATIONS</span></div><div className="login-kicker"><span className="pulse-dot" /> ambiente local protegido</div><h1 id="login-title">O cuidado em foco.</h1><p className="login-intro">Um ponto de clareza para cada decisão clínica, operacional e humana.</p><form onSubmit={submit} className="login-form"><label htmlFor="login">Identificação<input id="login" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} /></label><label htmlFor="password">Senha<input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} /></label>{error && <div id="login-error" className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<button className="button button-primary button-wide" type="submit" disabled={loading}>{loading ? "Validando…" : "Entrar no CVG"}<Icon name="arrow" size={17} /></button></form>{health?.demoOnly && <><div className="login-divider"><span>ou</span></div><button className="button button-ghost button-wide" type="button" onClick={() => void demo()} disabled={loading}>Abrir demonstração sintética <Icon name="spark" size={16} /></button><p className="demo-note">Dados descartáveis · providers reais bloqueados</p></>}<footer className="login-footer"><span className="status-chip" role="status" aria-live="polite"><span className="status-dot status-teal" />{health?.status === "READY" ? "Serviços prontos" : "Verificando serviços"}</span><span>v0.1 · loopback</span></footer></main><aside className="login-aside"><div className="aside-topline">SINAL OPERACIONAL <span>01 — 06</span></div><div className="signal-graphic"><div className="signal-grid" /><div className="signal-wave wave-one" /><div className="signal-wave wave-two" /><div className="signal-ring" /><div className="signal-label label-a">CONTEXTO</div><div className="signal-label label-b">CUIDADO</div><div className="signal-label label-c">CONTINUIDADE</div></div><div className="aside-copy"><p>Menos ruído.<br /><strong>Mais presença.</strong></p><span>Feito para as pessoas que sustentam o cuidado todos os dias.</span></div></aside></div>;
}
