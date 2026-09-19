import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestHistoryPoint, replayRange } from '../src/helpers/replayHelper';

test('nearestHistoryPoint chooses nearest sample', () => {
  const points = [{ t: 0, v: 10 }, { t: 100, v: 20 }, { t: 200, v: 30 }];
  assert.equal(nearestHistoryPoint(points, 130)?.v, 20);
  assert.equal(nearestHistoryPoint(points, 180)?.v, 30);
});

test('replayRange returns common range', () => {
  const range = replayRange([[{ t: 0, v: 1 }, { t: 200, v: 2 }], [{ t: 50, v: 1 }, { t: 150, v: 2 }]]);
  assert.deepEqual(range, { start: 50, end: 150 });
});
