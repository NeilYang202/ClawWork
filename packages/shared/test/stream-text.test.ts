import { test, expect } from 'vitest';
import { mergeGatewayStreamText } from '../src/constants';

test('mergeGatewayStreamText upgrades a partial snapshot to the longer snapshot', () => {
  expect(
    mergeGatewayStreamText('[[main] Yes, online.', '[[main] Yes, online. Are you testing whether I am alive?'),
  ).toBe('[[main] Yes, online. Are you testing whether I am alive?');
});

test('mergeGatewayStreamText ignores identical snapshots', () => {
  expect(mergeGatewayStreamText('same reply', 'same reply')).toBe('same reply');
});

test('mergeGatewayStreamText appends genuine incremental chunks', () => {
  expect(mergeGatewayStreamText('hello', ' world')).toBe('hello world');
});

test('mergeGatewayStreamText ignores an older snapshot replayed after a newer one', () => {
  expect(mergeGatewayStreamText('newer reply', 'newer')).toBe('newer reply');
});
