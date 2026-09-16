import { useEffect, useRef, useState, type FormEvent } from "react";
import { mfaChallengePayloadSchema, type LoginResponsePayload, type MfaChallengePayload } from "@cvg/contracts";
import type { ApiClient } from "../api/client";
import { revocationRisk, type SignOutRecord } from "../state/sign-out";
import type { ContextOption, User } from "../state/types";
import { Icon } from "./Icon";

type LoginStage = { kind: "credentials" } | { kind: "challenge"; challengeId: string; expiresAt: string };

function isMfaChallenge(value: LoginResponsePayload): value is MfaChallengePayload {
  return mfaChallengePayloadSchema.safeParse(value).success;
}

export function Login({ client, onLogin, signOutNotice = null, onRetryRevocation }: { client: ApiClient; onLogin: (user: User, contexts: ContextOption[]) => void; signOutNotice?: SignOutRecord | null; onRetryRevocation?: (() => Promise<void>) | undefined }) {
  const [login, setLogin] = useState("admin@cvg.local");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<LoginStage>({ kind: "credentials" });
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [health, setHealth] = useState<{ status: string; demoOnly: boolean } | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void client.get<{ status: string; capabilities: { demoOnly: boolean } }>("/health").then((data) => {
      if (active) setHealth({ status: data.status, demoOnly: data.capabilities.demoOnly });
    }).catch(() => {
      if (active) setHealth(null);
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (stage.kind !== "challenge") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [stage.kind]);

  useEffect(() => {
    if (stage.kind === "challenge") codeRef.current?.focus();
  }, [stage.kind]);

  const remainingSeconds = stage.kind === "challenge" ? Math.max(0, Math.ceil((Date.parse(stage.expiresAt) - clock) / 1_000)) : 0;
  const expired = stage.kind === "challenge" && remainingSeconds === 0;

  const accept = (result: LoginResponsePayload): boolean => {
    if (isMfaChallenge(result)) {
      setStage({ kind: "challenge", challengeId: result.challengeId, expiresAt: result.expiresAt });
      setCode("");
      setError("");
      setClock(Date.now());
      return true;
    }
    onLogin(result.user, result.contexts);
    return false;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      accept(await client.request<LoginResponsePayload>("/auth/login", { method: "POST", body: JSON.stringify({ login, password }) }));
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
      accept(await client.request<LoginResponsePayload>("/auth/demo", { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Demonstração indisponível.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.kind !== "challenge") return;
    if (expired) {
      setError("O código expirou. Refaça o login para receber um novo desafio.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      accept(await client.request<LoginResponsePayload>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ challengeId: stage.challengeId, code }) }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Código não confirmado.";
      const codeValue = reason instanceof Error && "code" in reason ? (reason as { code?: unknown }).code : null;
      if (codeValue === "ACCOUNT_LOCKED") {
        setStage({ kind: "credentials" });
        setCode("");
        setError(`${message} Inicie o login novamente.`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const cancelChallenge = () => {
    setStage({ kind: "credentials" });
    setCode("");
    setError("");
  };

  const retryRevocation = async () => {
    if (!onRetryRevocation) return;
    setRetrying(true);
    try {
      await onRetryRevocation();
    } finally {
      setRetrying(false);
    }
  };

  return <div className="login-shell"><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><main className="login-card" aria-labelledby="login-title"><div className="brand-lockup"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPERATIONS</span></div><div className="login-kicker"><span className="pulse-dot" /> ambiente local protegido</div><h1 id="login-title">O cuidado em foco.</h1><p className="login-intro">Um ponto de clareza para cada decisão clínica, operacional e humana.</p>{revocationRisk(signOutNotice) && <div className="inline-error" role="status"><Icon name="alert" size={16} /><span>Saída local concluída, mas a revogação desta sessão no servidor ainda não foi confirmada. O risco permanece visível até uma tentativa explícita.</span>{onRetryRevocation && <button className="button button-ghost" type="button" onClick={() => void retryRevocation()} disabled={retrying}>{retrying ? "Tentando…" : "Tentar revogar novamente"}</button>}</div>}{stage.kind === "credentials" ? <form onSubmit={submit} className="login-form"><label htmlFor="login">Identificação<input id="login" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} /></label><label htmlFor="password">Senha<input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} /></label>{error && <div id="login-error" className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<button className="button button-primary button-wide" type="submit" disabled={loading}>{loading ? "Validando…" : "Entrar no CVG"}<Icon name="arrow" size={17} /></button></form> : <form onSubmit={verify} className="login-form" aria-labelledby="mfa-title"><h2 id="mfa-title" className="mfa-title">Verificação em duas etapas</h2><p className="demo-note" id="mfa-expiry" role="status" aria-live="polite">{expired ? "Código expirado. Refaça o login para receber um novo desafio." : `Código expira em ${remainingSeconds}s.`}</p><label htmlFor="mfa-code">Código de verificação<input ref={codeRef} id="mfa-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} aria-invalid={Boolean(error)} aria-describedby={`mfa-expiry${error ? " login-error" : ""}`} /></label>{error && <div id="login-error" className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<button className="button button-primary button-wide" type="submit" disabled={loading || expired || code.length !== 6}>{loading ? "Confirmando…" : "Confirmar código"}<Icon name="arrow" size={17} /></button><button className="button button-ghost button-wide" type="button" onClick={cancelChallenge} disabled={loading}>Cancelar e voltar</button></form>}{health?.demoOnly && stage.kind === "credentials" && <><div className="login-divider"><span>ou</span></div><button className="button button-ghost button-wide" type="button" onClick={() => void demo()} disabled={loading}>Abrir demonstração sintética <Icon name="spark" size={16} /></button><p className="demo-note">Dados descartáveis · providers reais bloqueados</p></>}<footer className="login-footer"><span className="status-chip" role="status" aria-live="polite"><span className="status-dot status-teal" />{health?.status === "READY" ? "Serviços prontos" : "Verificando serviços"}</span><span>v0.1 · loopback</span></footer></main><aside className="login-aside"><div className="aside-topline">SINAL OPERACIONAL <span>01 — 06</span></div><div className="signal-graphic"><div className="signal-grid" /><div className="signal-wave wave-one" /><div className="signal-wave wave-two" /><div className="signal-ring" /><div className="signal-label label-a">CONTEXTO</div><div className="signal-label label-b">CUIDADO</div><div className="signal-label label-c">CONTINUIDADE</div></div><div className="aside-copy"><p>Menos ruído.<br /><strong>Mais presença.</strong></p><span>Feito para as pessoas que sustentam o cuidado todos os dias.</span></div></aside></div>;
}
