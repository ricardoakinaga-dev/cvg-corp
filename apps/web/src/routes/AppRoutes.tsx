import { lazy, Suspense } from "react";
import type { ApiClient } from "../api/client";
import { StatePanel } from "../components/ui";
import type { ContextOption, User, View } from "../state/types";

const Overview = lazy(async () => ({ default: (await import("../features/overview/Overview")).Overview }));
const Agenda = lazy(async () => ({ default: (await import("../features/agenda/Agenda")).Agenda }));
const Admin = lazy(async () => ({ default: (await import("../features/admin/Admin")).Admin }));
const Clinical = lazy(async () => ({ default: (await import("../features/clinical/Clinical")).Clinical }));
const Communications = lazy(async () => ({ default: (await import("../features/communications/Communications")).Communications }));
const Copilot = lazy(async () => ({ default: (await import("../features/copilot/Copilot")).Copilot }));
const Exams = lazy(async () => ({ default: (await import("../features/diagnostics/Exams")).Exams }));
const Finance = lazy(async () => ({ default: (await import("../features/finance/Finance")).Finance }));
const Internacao = lazy(async () => ({ default: (await import("../features/hospital/Internacao")).Internacao }));
const Knowledge = lazy(async () => ({ default: (await import("../features/knowledge/Knowledge")).Knowledge }));
const Patients = lazy(async () => ({ default: (await import("../features/patients/Patients")).Patients }));
const Reports = lazy(async () => ({ default: (await import("../features/reports/Reports")).Reports }));
const Stock = lazy(async () => ({ default: (await import("../features/stock/Stock")).Stock }));

function assertUnreachable(value: never): never {
  throw new Error(`View não suportada: ${String(value)}`);
}

export function AppRoutes({ client, actor, context, view, notify, onViewChange, canWrite, composerBuffer, onComposerBufferChange, patientSearchQuery }: { client: ApiClient; actor: User; context: ContextOption; view: View; notify: (message: string) => void; onViewChange: (view: View) => void; canWrite: boolean; composerBuffer: string; onComposerBufferChange: (value: string) => void; patientSearchQuery: string }) {
  const route = (() => {
    switch (view) {
      case "overview":
        return <Overview client={client} context={context} onViewChange={onViewChange} notify={notify} />;
      case "agenda":
        return <Agenda client={client} context={context} notify={notify} />;
      case "patients":
        return <Patients client={client} context={context} notify={notify} initialQuery={patientSearchQuery} />;
      case "clinical":
        return <Clinical client={client} context={context} notify={notify} />;
      case "exams":
        return <section className="surface"><Exams client={client} context={context} notify={notify} /></section>;
      case "hospital":
        return <section className="surface"><Internacao client={client} context={context} notify={notify} /></section>;
      case "communications":
        return <section className="surface"><Communications client={client} context={context} notify={notify} /></section>;
      case "knowledge":
        return <section className="surface"><Knowledge client={client} context={context} notify={notify} /></section>;
      case "reports":
        return <section className="surface"><Reports client={client} context={context} /></section>;
      case "stock":
        return <Stock client={client} context={context} notify={notify} />;
      case "finance":
        return <Finance client={client} context={context} notify={notify} />;
      case "copilot":
        return <Copilot client={client} context={context} notify={notify} canWrite={canWrite} prompt={composerBuffer} onPromptChange={onComposerBufferChange} />;
      case "admin":
        return <Admin client={client} actorId={actor.id} context={context} notify={notify} canWrite={canWrite} />;
      default:
        return assertUnreachable(view);
    }
  })();

  return <Suspense fallback={<StatePanel kind="loading" title="Abrindo a jornada" body="Carregando o módulo autorizado para este contexto." />}>{route}</Suspense>;
}
