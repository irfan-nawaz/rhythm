import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pushPayload } from '../src/worker/channels.js';

const message = { id: 'n1', title: '💊 BP tablet', body: 'Due now (09:00).', url: '/today' };

describe('pushPayload', () => {
  it('gives reminders Done and Snooze buttons that know their task and day', () => {
    const payload = pushPayload(message, { taskId: 't1', date: '2026-11-18', labels: { done: 'Done', snooze: 'Snooze 15 min' } });
    assert.equal(payload.tag, 'n1');
    assert.equal(payload.taskId, 't1');
    assert.equal(payload.date, '2026-11-18');
    assert.deepEqual(
      payload.actions?.map((a) => a.action),
      ['done', 'snooze'],
    );
  });

  it('leaves buttons off notifications that are not about a task', () => {
    const payload = pushPayload(message);
    assert.equal('actions' in payload, false);
    assert.equal('taskId' in payload, false);
  });
});
