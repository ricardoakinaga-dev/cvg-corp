export type ContextOption = {
  organization: { id: string; name: string; slug: string };
  unit: { id: string; name: string; code: string };
  workspace: { id: string; name: string; purpose: string };
  roles: string[];
};

export type ContextReference = {
  unit: { id: string } | null;
  workspace: { id: string } | null;
};

export type User = { id: string; displayName: string; email: string; status: string };

export type View = "overview" | "agenda" | "patients" | "clinical" | "stock" | "finance" | "copilot" | "admin";

export type MeResponse = {
  user: User;
  context: ContextReference;
};
