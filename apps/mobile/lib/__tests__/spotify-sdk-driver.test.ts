import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSpotifySdkDriver,
  type ShowbookSpotifySdkLike,
} from '../spotify-sdk-driver';
import {
  setMobileTelemetryLogger,
  __resetTelemetryForTests,
  type ClientEventPayload,
} from '../telemetry';

interface MockSdk extends ShowbookSpotifySdkLike {
  connectShouldThrow: Error | null;
  playShouldThrow: (Error & { code?: string }) | null;
  pauseShouldThrow: Error | null;
  connectCalls: string[];
  playCalls: string[];
  pauseCalls: number;
  disconnectCalls: number;
}

function makeMockSdk(): MockSdk {
  const mock: MockSdk = {
    connectShouldThrow: null,
    playShouldThrow: null,
    pauseShouldThrow: null,
    connectCalls: [],
    playCalls: [],
    pauseCalls: 0,
    disconnectCalls: 0,
    async isAvailable() {
      return true;
    },
    async connect(token: string) {
      mock.connectCalls.push(token);
      if (mock.connectShouldThrow) throw mock.connectShouldThrow;
    },
    async play(id: string) {
      mock.playCalls.push(id);
      if (mock.playShouldThrow) throw mock.playShouldThrow;
    },
    async pause() {
      mock.pauseCalls += 1;
      if (mock.pauseShouldThrow) throw mock.pauseShouldThrow;
    },
    async disconnect() {
      mock.disconnectCalls += 1;
    },
  };
  return mock;
}

function captureEvents(): ClientEventPayload[] {
  const events: ClientEventPayload[] = [];
  setMobileTelemetryLogger((payload) => events.push(payload));
  return events;
}

describe('spotify-sdk-driver', () => {
  beforeEach(() => {
    __resetTelemetryForTests();
  });

  it('emits spotify.mobile_sdk.connected on successful connect', async () => {
    const events = captureEvents();
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    const ok = await driver.connect('access-token-x');
    assert.equal(ok, true);
    assert.deepEqual(sdk.connectCalls, ['access-token-x']);
    assert.ok(events.some((e) => e.event === 'spotify.mobile_sdk.connected'));
  });

  it('emits connect_failed and returns false when the native side throws', async () => {
    const events = captureEvents();
    const sdk = makeMockSdk();
    sdk.connectShouldThrow = new Error('no app');
    const driver = createSpotifySdkDriver(sdk);
    const ok = await driver.connect('access-token-x');
    assert.equal(ok, false);
    const failed = events.find(
      (e) => e.event === 'spotify.mobile_sdk.connect_failed',
    );
    assert.ok(failed);
    assert.equal(failed?.message, 'no app');
  });

  it('rejects play() when not connected — caller falls back to deep-link', async () => {
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    await assert.rejects(() => driver.play('2QsoVMTKj5m5kgztTOep98'), /not connected/);
    assert.deepEqual(sdk.playCalls, [], 'native play() never invoked when disconnected');
  });

  it('routes play() to the native module and emits a structured event', async () => {
    const events = captureEvents();
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    await driver.connect('access-token-x');
    await driver.play('2QsoVMTKj5m5kgztTOep98');
    assert.deepEqual(sdk.playCalls, ['2QsoVMTKj5m5kgztTOep98']);
    const playEvent = events.find((e) => e.event === 'spotify.mobile_sdk.play');
    assert.ok(playEvent);
    assert.equal(
      (playEvent?.context as { spotifyTrackId?: string } | undefined)
        ?.spotifyTrackId,
      '2QsoVMTKj5m5kgztTOep98',
    );
  });

  it('flips connected=false when play fails with ERR_NOT_CONNECTED', async () => {
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    await driver.connect('access-token-x');
    const err = new Error('ipc dropped') as Error & { code?: string };
    err.code = 'ERR_NOT_CONNECTED';
    sdk.playShouldThrow = err;
    await assert.rejects(() => driver.play('2QsoVMTKj5m5kgztTOep98'));
    // Even after we clear the play-throw, the driver should still
    // reject because the connected flag was reset by the previous
    // ERR_NOT_CONNECTED. This is what prompts FullTrackDriverMount to
    // attempt a reconnect on next foreground.
    sdk.playShouldThrow = null;
    await assert.rejects(() => driver.play('2QsoVMTKj5m5kgztTOep98'), /not connected/);
  });

  it('stop() is a no-op when not connected', async () => {
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    await driver.stop();
    assert.equal(sdk.pauseCalls, 0);
  });

  it('disconnect() emits the lifecycle event and clears connected', async () => {
    const events = captureEvents();
    const sdk = makeMockSdk();
    const driver = createSpotifySdkDriver(sdk);
    await driver.connect('access-token-x');
    await driver.disconnect();
    assert.equal(sdk.disconnectCalls, 1);
    assert.ok(events.some((e) => e.event === 'spotify.mobile_sdk.disconnected'));
    // Subsequent play() should reject since disconnect flipped the
    // flag — proves the cleanup path actually clears state.
    await assert.rejects(() => driver.play('x'), /not connected/);
  });
});
