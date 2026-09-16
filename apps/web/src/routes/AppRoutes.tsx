import type { ApiClient } from "../api/client";
import { Agenda } from "../features/agenda/Agenda";
import { Admin } from "../features/admin/Admin";
import { Clinical } from "../features/clinical/Clinical";
import { Communications } from "../features/communications/Communications";
import { Copilot } from "../features/copilot/Copilot";
import { Exams } from "../features/diagnostics/Exams";
import { Finance } from "../features/finance/Finance";
import { Internacao } from "../features/hospital/Internacao";
import { Knowledge } from "../features/knowledge/Knowledge";
import { Overview } from "../features/overview/Overview";
import { Patients } from "../features/patients/Patients";
import { Reports } from "../features/reports/Reports";
import { Stock } from "../features/stock/Stock";
import type { ContextOption, User, View } from "../state/types";

function assertUnreachable(value: never): never {
  throw new Error(`View não suportada: ${String(value)}`);
}

export function AppRoutes({ client, actor, context, view, notify, onViewChange, canWrite, composerBuffer, onComposerBufferChange, patientSearchQuery }: { client: ApiClient; actor: User; context: ContextOption; view: View; notify: (message: string) => void; onViewChange: (view: View) => void; canWrite: boolean; composerBuffer: string; onComposerBufferChange: (value: string) => void; patientSearchQuery: string }) {
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
}
