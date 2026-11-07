import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { PlaygroundArmControls } from '../src/server/arm-controls.ts';
import { PlaygroundTasks } from '../src/server/tasks.ts';

test('global stop aborts all planning and dispatches a single physical stop without waiting for tasks', async () => {
  const tasks = new PlaygroundTasks({});
  const first = new AbortController();
  const second = new AbortController();
  tasks.entries.set('a', {
    server: { currentTaskId: 'running-a', taskAbortControllers: { a: first } },
  });
  tasks.entries.set('b', {
    server: { currentTaskId: 'running-b', taskAbortControllers: { b: second } },
  });
  let finish;
  let calls = 0;
  let recoveries = 0;
  const controls = new PlaygroundArmControls(
    {
      stop: () => {
        calls++;
        assert.ok(first.signal.aborted && second.signal.aborted);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      recover: async () => {
        recoveries++;
      },
    },
    tasks,
  );
  const stop = controls.stop();
  assert.equal(controls.stop(), stop);
  assert.equal(calls, 1);
  await assert.rejects(controls.recover(), /Wait for stopped tasks/);
  finish();
  await stop;
  await assert.rejects(controls.recover(), /Wait for stopped tasks/);
  tasks.entries.get('a').server.currentTaskId = undefined;
  tasks.entries.get('b').server.currentTaskId = undefined;
  await controls.recover();
  assert.equal(recoveries, 1);
});
test('a failed stop is surfaced and can be retried', async () => {
  let count = 0;
  const controls = new PlaygroundArmControls(
    {
      stop: async () => {
        if (++count === 1) throw new Error('Stop unconfirmed');
      },
      recover: async () => {},
    },
    {
      abortPlanning() {},
      list() {
        return [];
      },
    },
  );
  await assert.rejects(controls.stop(), /Stop unconfirmed/);
  await controls.stop();
  assert.equal(count, 2);
});
