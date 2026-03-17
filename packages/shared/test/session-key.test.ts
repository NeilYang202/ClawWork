import { test, expect } from 'vitest';
import { buildSessionKey, parseTaskIdFromSessionKey } from '../src/constants';

test('parseTaskIdFromSessionKey parses current ClawWork session keys', () => {
  const taskId = 'task-current';
  const sessionKey = buildSessionKey(taskId);
  expect(parseTaskIdFromSessionKey(sessionKey)).toBe(taskId);
});

test('parseTaskIdFromSessionKey keeps accepting legacy task session keys', () => {
  expect(parseTaskIdFromSessionKey('agent:main:task-task-legacy')).toBe('task-legacy');
});
