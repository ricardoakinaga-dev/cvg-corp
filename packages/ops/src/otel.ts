import { SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import type { OtelSpan, OtelSpanStart, TelemetryAttribute, TelemetryExporter } from "./index.ts";

const TRACE_PATH = "/v1/traces";

export class OpenTelemetryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenTelemetryConfigurationError";
  }
}

export interface OpenTelemetryRuntimeOptions {
  environment?: NodeJS.ProcessEnv;
  serviceName?: string;
  requireTls?: boolean;
}

export interface OpenTelemetryRuntime {
  readonly status: "NOT_CONFIGURED" | "DISABLED" | "READY";
  readonly endpoint: string | null;
  readonly exporter: TelemetryExporter | null;
  shutdown(): Promise<void>;
}

function endpointFromEnvironment(environment: NodeJS.ProcessEnv): { value: string; specific: boolean } | null {
  const specific = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (specific) return { value: specific, specific: true };
  const generic = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return generic ? { value: generic, specific: false } : null;
}

function traceEndpoint(raw: { value: string; specific: boolean }, requireTls: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.value);
  } catch {
    throw new OpenTelemetryConfigurationError("OTEL exporter endpoint must be an absolute HTTP(S) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OpenTelemetryConfigurationError("OTEL exporter endpoint must use HTTP or HTTPS.");
  }
  if (requireTls && parsed.protocol !== "https:") {
    throw new OpenTelemetryConfigurationError("Production OTLP export requires HTTPS/TLS.");
  }
  if (raw.specific) return parsed.toString();
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith(TRACE_PATH)) return parsed.toString();
  const base = parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`;
  return new URL("v1/traces", base).toString();
}

function safeAttributes(attributes: Record<string, TelemetryAttribute>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null));
}

/** Bridges the repository's redacted span seam to real OTLP spans. */
export class OpenTelemetryTelemetryExporter implements TelemetryExporter {
  private readonly openSpans = new Map<string, Span>();

  constructor(private readonly tracer: Tracer) {}

  startSpan(span: OtelSpanStart): { traceId: string; spanId: string } {
    const created = this.tracer.startSpan(span.name, {
      startTime: new Date(span.startedAt),
      attributes: safeAttributes(span.attributes)
    });
    const context = created.spanContext();
    this.openSpans.set(context.spanId, created);
    return { traceId: context.traceId, spanId: context.spanId };
  }

  finishSpan(span: OtelSpan): void {
    const created = this.openSpans.get(span.spanId);
    if (!created) {
      this.export(span);
      return;
    }
    this.openSpans.delete(span.spanId);
    created.setAttribute("http.response.status_code", span.statusCode);
    created.setStatus({ code: span.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET });
    created.end(new Date(span.finishedAt));
  }

  export(span: OtelSpan): void {
    const created = this.tracer.startSpan(span.name, {
      startTime: new Date(span.startedAt),
      attributes: safeAttributes(span.attributes)
    });
    created.setAttribute("http.response.status_code", span.statusCode);
    created.setStatus({ code: span.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET });
    created.end(new Date(span.finishedAt));
  }
}

export function createOpenTelemetryRuntime(options: OpenTelemetryRuntimeOptions = {}): OpenTelemetryRuntime {
  const environment = options.environment ?? process.env;
  const configured = endpointFromEnvironment(environment);
  if (!configured) return { status: "NOT_CONFIGURED", endpoint: null, exporter: null, shutdown: async () => {} };
  if (environment.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return { status: "DISABLED", endpoint: null, exporter: null, shutdown: async () => {} };

  const endpoint = traceEndpoint(configured, options.requireTls === true);
  const serviceName = environment.OTEL_SERVICE_NAME?.trim() || options.serviceName || "cvg-corp";
  const resource = defaultResource().merge(resourceFromAttributes({
    "service.name": serviceName,
    "service.namespace": "cvg",
    "service.version": "0.1.0"
  }));
  const otlpExporter = new OTLPTraceExporter({ url: endpoint });
  const provider = new TracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor({ exporter: otlpExporter, scheduledDelayMillis: 1_000, exportTimeoutMillis: 5_000 })]
  });
  const exporter = new OpenTelemetryTelemetryExporter(provider.getTracer("cvg-corp", "0.1.0"));
  return { status: "READY", endpoint, exporter, shutdown: () => provider.shutdown() };
}
