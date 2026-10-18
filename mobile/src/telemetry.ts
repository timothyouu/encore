import * as Sentry from '@sentry/browser';

export type TelemetryName =
  | 'phone.stop_to_result' | 'phone.recorder_stop' | 'phone.analysis_request'
  | 'phone.analysis_validation' | 'phone.coaching_request' | 'phone.coaching_validation'
  | 'phone.normalization' | 'phone.audio_persist' | 'phone.upload_request' | 'phone.upload_validation'
  | 'app.history_persist' | 'app.render' | 'demo.stop_to_result';
export type TelemetryOutcome = 'ok' | 'error' | 'cancelled' | 'interrupted';
export type FailureStage = 'capture' | 'normalization' | 'storage' | 'upload' | 'analysis' | 'coaching' | 'history' | 'render' | 'runtime';
export type FailureCode =
  | 'recorder_stop_failed' | 'empty_audio' | 'request_failed' | 'invalid_json'
  | 'invalid_response' | 'service_error' | 'passage_unavailable'
  | 'microphone_unavailable' | 'capture_failed' | 'normalization_failed' | 'storage_failed' | 'render_failed' | 'unexpected_error';
export type TelemetrySource = 'phone' | 'demo' | 'app';

export interface TelemetrySpan {
  child(name: TelemetryName): TelemetrySpan;
  end(outcome: TelemetryOutcome): void;
}
export interface TelemetrySink {
  start(name: TelemetryName, parent?: TelemetrySpan, source?: TelemetrySource): TelemetrySpan;
  failure(stage: FailureStage, code: FailureCode, source: TelemetrySource, parent?: TelemetrySpan): void;
}

const SPAN_NAMES = new Set<TelemetryName>([
  'phone.stop_to_result', 'phone.recorder_stop', 'phone.analysis_request',
  'phone.analysis_validation', 'phone.coaching_request', 'phone.coaching_validation',
  'phone.normalization', 'phone.audio_persist', 'phone.upload_request', 'phone.upload_validation',
  'app.history_persist', 'app.render', 'demo.stop_to_result',
]);
const STAGES = new Set<FailureStage>(['capture', 'normalization', 'storage', 'upload', 'analysis', 'coaching', 'history', 'render', 'runtime']);
const CODES = new Set<FailureCode>([
  'recorder_stop_failed', 'empty_audio', 'request_failed', 'invalid_json',
  'invalid_response', 'service_error', 'passage_unavailable',
  'microphone_unavailable', 'capture_failed', 'normalization_failed', 'storage_failed', 'render_failed', 'unexpected_error',
]);

const noopSpan: TelemetrySpan = { child: () => noopSpan, end: () => undefined };
const noopSink: TelemetrySink = { start: () => noopSpan, failure: () => undefined };
let activeSink: TelemetrySink = noopSink;
const reportedErrors = new WeakSet<object>();

/** Track only object identity locally; never send original errors to Sentry. */
export function markTelemetryErrorReported(cause: unknown): void {
  if (cause !== null && (typeof cause === 'object' || typeof cause === 'function')) reportedErrors.add(cause);
}

function reportUnexpected(cause: unknown): void {
  if (cause !== null && (typeof cause === 'object' || typeof cause === 'function') && reportedErrors.has(cause)) return;
  if (cause instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(cause.name)) return;
  markTelemetryErrorReported(cause);
  recordTelemetryFailure('runtime', 'unexpected_error', 'app');
}

/** Test seam; production calls initializeSentry once at startup. */
export function setTelemetrySink(sink: TelemetrySink): void { activeSink = sink; }

export function beginTelemetrySpan(
  name: TelemetryName, parent?: TelemetrySpan | null, source: TelemetrySource = 'phone',
): TelemetrySpan {
  try { return activeSink.start(name, parent ?? undefined, source); } catch { return noopSpan; }
}

export function endTelemetrySpan(span: TelemetrySpan | null | undefined, outcome: TelemetryOutcome): void {
  try { span?.end(outcome); } catch { /* telemetry must not affect capture */ }
}

export function recordTelemetryFailure(
  stage: FailureStage, code: FailureCode, source: TelemetrySource = 'phone', parent?: TelemetrySpan | null,
): void {
  try { activeSink.failure(stage, code, source, parent ?? undefined); } catch { /* telemetry must not affect capture */ }
}

export function measureTelemetry<T>(name: TelemetryName, work: () => T): T {
  const span = beginTelemetrySpan(name, undefined, 'app');
  try {
    const value = work();
    endTelemetrySpan(span, 'ok');
    return value;
  } catch (cause) {
    endTelemetrySpan(span, 'error');
    throw cause;
  }
}

type SentryEnv = { VITE_SENTRY_ENABLED?: string; VITE_SENTRY_DSN?: string; VITE_SENTRY_ENVIRONMENT?: string };

function safeEnvironment(value: string | undefined): string {
  return value && /^[a-zA-Z0-9_-]{1,32}$/.test(value) ? value : 'local';
}

function safeTraceContext(trace: Record<string, unknown> | undefined): {
  trace_id: string; span_id: string; parent_span_id?: string; op: string; status?: string;
  data?: { 'encore.outcome': TelemetryOutcome };
} | undefined {
  if (!trace) return undefined;
  if (typeof trace.trace_id !== 'string' || !/^[a-f0-9]{32}$/i.test(trace.trace_id) ||
      typeof trace.span_id !== 'string' || !/^[a-f0-9]{16}$/i.test(trace.span_id)) return undefined;
  const safe = { trace_id: trace.trace_id, span_id: trace.span_id, op: 'encore.workflow',
    parent_span_id: undefined as string | undefined, status: undefined as string | undefined,
    data: undefined as { 'encore.outcome': TelemetryOutcome } | undefined };
  if (typeof trace.parent_span_id === 'string' && /^[a-f0-9]{16}$/i.test(trace.parent_span_id))
    safe.parent_span_id = trace.parent_span_id;
  if (typeof trace.status === 'string' &&
      ['ok', 'deadline_exceeded', 'internal_error', 'unknown_error', 'cancelled', 'error'].includes(trace.status))
    safe.status = trace.status;
  const data = trace.data as Record<string, unknown> | undefined;
  const outcome = data?.['encore.outcome'];
  if (outcome === 'ok' || outcome === 'error' || outcome === 'cancelled' || outcome === 'interrupted')
    safe.data = { 'encore.outcome': outcome };
  return safe;
}

let listenersInstalled = false;

export function initializeSentry(
  env: SentryEnv,
  transport?: NonNullable<Parameters<typeof Sentry.init>[0]>['transport'],
): boolean {
  if (env.VITE_SENTRY_ENABLED !== 'true' || !env.VITE_SENTRY_DSN) {
    activeSink = noopSink;
    if (Sentry.isInitialized()) void Sentry.close(0);
    return false;
  }
  try {
    Sentry.init({
      dsn: env.VITE_SENTRY_DSN,
      transport,
      environment: safeEnvironment(env.VITE_SENTRY_ENVIRONMENT),
      defaultIntegrations: false,
      integrations: [],
      dataCollection: {
        userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
        urlQueryParams: false, genAI: { inputs: false, outputs: false },
        graphQL: { document: false, variables: false }, databaseQueryData: false,
        queues: false, stackFrameVariables: false, frameContextLines: 0,
      },
      traceLifecycle: 'static',
      tracesSampleRate: 1,
      attachStacktrace: false,
      tracePropagationTargets: [],
      beforeSend(event) {
        if (event.tags?.['encore.safe'] !== 'true') return null;
        const stage = event.tags['encore.stage'];
        const code = event.tags['encore.code'];
        const source = event.tags['encore.source'];
        if (typeof stage !== 'string' || typeof code !== 'string' ||
            !STAGES.has(stage as FailureStage) || !CODES.has(code as FailureCode) ||
            (source !== 'phone' && source !== 'demo' && source !== 'app')) return null;
        event.message = `Encore ${stage} failure`;
        event.exception = { values: [{ type: 'EncoreFailure', value: `${stage}:${code}` }] };
        event.request = undefined;
        event.user = undefined;
        const trace = safeTraceContext(event.contexts?.trace as Record<string, unknown> | undefined);
        event.contexts = trace ? { trace } : undefined;
        event.extra = undefined;
        event.breadcrumbs = undefined;
        event.tags = { app: 'encore', stage, code, source };
        event.fingerprint = ['encore', stage, code, source];
        return {
          type: undefined, event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
          environment: safeEnvironment(env.VITE_SENTRY_ENVIRONMENT), level: 'error',
          message: event.message, exception: event.exception, contexts: event.contexts,
          tags: event.tags, fingerprint: event.fingerprint,
        };
      },
      beforeSendTransaction(event) {
        if (!event.transaction || !SPAN_NAMES.has(event.transaction as TelemetryName)) return null;
        const name = event.transaction;
        event.request = undefined;
        event.user = undefined;
        const trace = safeTraceContext(event.contexts?.trace as Record<string, unknown> | undefined);
        event.contexts = trace ? { trace } : undefined;
        event.extra = undefined;
        event.breadcrumbs = undefined;
        event.tags = { app: 'encore', source: name.startsWith('demo.') ? 'demo' : name.startsWith('app.') ? 'app' : 'phone',
          simulated: name.startsWith('demo.') ? 'true' : 'false' };
        event.spans = event.spans?.filter((span) =>
          span.description && SPAN_NAMES.has(span.description as TelemetryName),
        ).map((span) => ({ span_id: span.span_id, trace_id: span.trace_id,
          parent_span_id: span.parent_span_id, start_timestamp: span.start_timestamp,
          timestamp: span.timestamp, description: span.description, status: span.status,
          op: 'encore.workflow',
          data: ['ok', 'error', 'cancelled', 'interrupted'].includes(String(span.data?.['encore.outcome']))
            ? { 'encore.outcome': span.data['encore.outcome'] } : {}, links: undefined }));
        event.transaction = name;
        return {
          type: 'transaction', event_id: event.event_id, timestamp: event.timestamp,
          start_timestamp: event.start_timestamp, platform: event.platform,
          environment: safeEnvironment(env.VITE_SENTRY_ENVIRONMENT),
          transaction: event.transaction, contexts: event.contexts,
          spans: event.spans, tags: event.tags,
        };
      },
    });
    activeSink = sentrySink;
    if (!listenersInstalled && typeof window !== 'undefined') {
      window.addEventListener('error', (event: ErrorEvent) => reportUnexpected(event.error));
      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportUnexpected(event.reason));
      listenersInstalled = true;
    }
    return true;
  } catch {
    activeSink = noopSink;
    return false;
  }
}

type SentryBackedSpan = TelemetrySpan & { sentrySpan: Sentry.Span };

function sentrySpan(name: TelemetryName, parent?: TelemetrySpan, source: TelemetrySource = 'phone'): TelemetrySpan {
  const parentSpan = parent && 'sentrySpan' in parent ? (parent as SentryBackedSpan).sentrySpan : null;
  const start = (): Sentry.Span => Sentry.startInactiveSpan({
    name, op: 'encore.workflow', parentSpan,
    attributes: { 'encore.source': source, 'encore.simulated': source === 'demo' },
  });
  const span = parentSpan ? start() : Sentry.startNewTrace(start);
  let ended = false;
  const wrapped: SentryBackedSpan = {
    sentrySpan: span,
    child: (childName) => sentrySpan(childName, wrapped, source),
    end(outcome) {
      if (ended) return;
      ended = true;
      span.setAttribute('encore.outcome', outcome);
      span.setStatus(outcome === 'ok' ? { code: 1 } : {
        code: 2, message: outcome === 'error' ? 'internal_error' : 'cancelled',
      });
      span.end();
    },
  };
  return wrapped;
}

const sentrySink: TelemetrySink = {
  start: sentrySpan,
  failure(stage, code, source, parent) {
    // A new fixed Error is deliberate: service error text and original stacks stay local.
    const capture = (): void => {
      Sentry.captureException(new Error('Encore processing failure'), {
        tags: { 'encore.safe': 'true', 'encore.stage': stage, 'encore.code': code, 'encore.source': source },
      });
    };
    if (parent && 'sentrySpan' in parent) Sentry.withActiveSpan((parent as SentryBackedSpan).sentrySpan, capture);
    else capture();
  },
};
