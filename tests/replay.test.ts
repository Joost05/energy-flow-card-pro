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

test('replayRange accepts synchronized demo-like series', () => {
  const start = 1_000;
  const end = 86_401_000;
  const make = (offset: number) => Array.from({ length: 96 }, (_, i) => ({
    t: start + ((end - start) * i) / 95,
    v: i + offset,
  }));
  assert.deepEqual(replayRange([make(0), make(100), make(200)]), { start, end });
});
