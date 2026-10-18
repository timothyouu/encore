import test from 'node:test';
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/browser';
import {
  beginTelemetrySpan, endTelemetrySpan, initializeSentry, markTelemetryErrorReported,
  recordTelemetryFailure,
} from '../src/telemetry.ts';

test('real Sentry envelopes contain only approved failures and bounded span data', async () => {
  const envelopes = [];
  const transport = () => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  });
  try {
    assert.equal(initializeSentry({
      VITE_SENTRY_ENABLED: 'true',
      VITE_SENTRY_DSN: 'https://public@telemetry.invalid/1',
      VITE_SENTRY_ENVIRONMENT: 'test',
    }, transport), true);
    Sentry.setUser({ email: 'USER_SENTINEL@example.invalid' });
    Sentry.setTag('raw.url', 'URL_TAG_SENTINEL');
    Sentry.setContext('raw', { audio: 'AUDIO_CONTEXT_SENTINEL' });
    Sentry.setExtra('token', 'EXTRA_SENTINEL');
    Sentry.addBreadcrumb({ message: 'BREADCRUMB_SENTINEL' });
    Sentry.captureException(new Error('RAW_ERROR_SENTINEL'));
    Sentry.captureMessage('RAW_MESSAGE_SENTINEL');
    const root = beginTelemetrySpan('demo.stop_to_result', undefined, 'demo');
    recordTelemetryFailure('analysis', 'invalid_response', 'demo', root);
    const child = root.child('phone.analysis_request');
    root.sentrySpan.setAttribute('audio.raw', 'AUDIO_SENTINEL');
    root.sentrySpan.setAttribute('http.url', 'URL_SENTINEL');
    child.sentrySpan.setAttribute('coach.payload', 'COACHING_SENTINEL');
    endTelemetrySpan(child, 'ok');
    endTelemetrySpan(root, 'ok');
    const secondRoot = beginTelemetrySpan('phone.stop_to_result', undefined, 'phone');
    recordTelemetryFailure('upload', 'service_error', 'phone', secondRoot);
    endTelemetrySpan(secondRoot, 'error');
    Sentry.startInactiveSpan({ name: 'unapproved trace', attributes: { raw: 'OTHER_SENTINEL' } }).end();
    assert.equal(await Sentry.flush(2_000), true);
    assert.ok(envelopes.length > 0, 'the local transport should receive an envelope');
    const text = JSON.stringify(envelopes);
    assert.match(text, /invalid_response/);
    assert.match(text, /demo.stop_to_result/);
    assert.doesNotMatch(text, /RAW_ERROR_SENTINEL|RAW_MESSAGE_SENTINEL|USER_SENTINEL|AUDIO_SENTINEL|URL_SENTINEL|COACHING_SENTINEL|OTHER_SENTINEL|URL_TAG_SENTINEL|AUDIO_CONTEXT_SENTINEL|EXTRA_SENTINEL|BREADCRUMB_SENTINEL|unapproved trace|telemetry\.invalid/);
    const events = envelopes.flatMap(([, items]) => items.map(([, payload]) => payload));
    const errorEvents = events.filter((event) => event.type === 'error' || event.exception);
    assert.equal(errorEvents.length, 2, 'automatic/raw exceptions must be dropped');
    const transactions = events.filter((event) => event.type === 'transaction');
    assert.equal(transactions.length, 2);
    const demoTransaction = transactions.find((event) => event.transaction === 'demo.stop_to_result');
    const phoneTransaction = transactions.find((event) => event.transaction === 'phone.stop_to_result');
    assert.ok(demoTransaction);
    assert.ok(phoneTransaction);
    assert.equal(demoTransaction.tags.source, 'demo');
    assert.equal(demoTransaction.tags.simulated, 'true');
    assert.equal(phoneTransaction.tags.simulated, 'false');
    assert.equal(demoTransaction.spans.length, 1);
    const childSpan = demoTransaction.spans[0];
    assert.equal(childSpan.description, 'phone.analysis_request');
    assert.equal(childSpan.parent_span_id, demoTransaction.contexts.trace.span_id);
    assert.equal(childSpan.trace_id, demoTransaction.contexts.trace.trace_id);
    assert.equal(childSpan.status, 'ok');
    assert.ok(childSpan.timestamp >= childSpan.start_timestamp);
    assert.equal(phoneTransaction.contexts.trace.status, 'internal_error');
    assert.notEqual(demoTransaction.contexts.trace.trace_id, phoneTransaction.contexts.trace.trace_id,
      'separate processing attempts need distinct trace IDs');
    const demoError = errorEvents.find((event) => event.tags.stage === 'analysis');
    const phoneError = errorEvents.find((event) => event.tags.stage === 'upload');
    assert.deepEqual(demoError.tags, {
      app: 'encore', stage: 'analysis', code: 'invalid_response', source: 'demo',
    });
    assert.equal(demoError.contexts.trace.trace_id, demoTransaction.contexts.trace.trace_id);
    assert.equal(phoneError.contexts.trace.trace_id, phoneTransaction.contexts.trace.trace_id);
    for (const event of [...errorEvents, ...transactions]) {
      assert.equal(event.request, undefined);
      assert.equal(event.user, undefined);
      assert.equal(event.breadcrumbs, undefined);
      assert.equal(event.extra, undefined);
    }
    const sentBeforeOptOut = envelopes.length;
    assert.equal(initializeSentry({ VITE_SENTRY_ENABLED: 'false', VITE_SENTRY_DSN: 'https://public@telemetry.invalid/1' }), false);
    const disabledTrace = beginTelemetrySpan('phone.stop_to_result');
    recordTelemetryFailure('analysis', 'invalid_response');
    endTelemetrySpan(disabledTrace, 'error');
    await Sentry.flush(2_000);
    assert.equal(envelopes.length, sentBeforeOptOut, 'explicit opt-out must disable an earlier successful initialization');
  } finally {
    await Sentry.close(2_000);
  }
});

test('browser global errors use fixed runtime events and exclude duplicates and expected denials', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  const envelopes = [];
  const transport = () => ({
    send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
    flush: async () => true,
  });
  try {
    assert.equal(initializeSentry({
      VITE_SENTRY_ENABLED: 'true',
      VITE_SENTRY_DSN: 'https://public@telemetry.invalid/1',
      VITE_SENTRY_ENVIRONMENT: 'test',
    }, transport), true);
    const collection = Sentry.getClient().getOptions().dataCollection;
    assert.equal(collection.userInfo, false);
    assert.equal(collection.cookies, false);
    assert.equal(collection.httpHeaders, false);
    assert.deepEqual(collection.httpBodies, []);
    assert.equal(collection.urlQueryParams, false);
    assert.equal(collection.genAI.inputs, false);
    assert.equal(collection.genAI.outputs, false);

    const dispatchError = (cause) => window.dispatchEvent(Object.assign(new Event('error'), { error: cause }));
    const dispatchRejection = (cause) => window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: cause }));
    const alreadyReported = new Error('KNOWN_ERROR_SENTINEL');
    markTelemetryErrorReported(alreadyReported);
    dispatchError(alreadyReported);
    dispatchError(new DOMException('ABORT_SENTINEL', 'AbortError'));
    dispatchRejection(new DOMException('DENIAL_SENTINEL', 'NotAllowedError'));
    const unexpected = new Error('RAW_RUNTIME_SENTINEL');
    dispatchError(unexpected);
    dispatchError(unexpected);
    dispatchRejection(new Error('RAW_PROMISE_SENTINEL'));
    assert.equal(await Sentry.flush(2_000), true);

    const payloads = envelopes.flatMap(([, items]) => items.map(([, payload]) => payload));
    const errors = payloads.filter((payload) => payload.exception);
    assert.equal(errors.length, 2, 'one event per unexpected error object');
    for (const error of errors) {
      assert.deepEqual(error.tags, {
        app: 'encore', stage: 'runtime', code: 'unexpected_error', source: 'app',
      });
      assert.equal(error.message, 'Encore runtime failure');
      assert.equal(error.user, undefined);
      assert.equal(error.request, undefined);
    }
    assert.doesNotMatch(JSON.stringify(envelopes),
      /KNOWN_ERROR_SENTINEL|ABORT_SENTINEL|DENIAL_SENTINEL|RAW_RUNTIME_SENTINEL|RAW_PROMISE_SENTINEL/);
  } finally {
    await Sentry.close(2_000);
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});
