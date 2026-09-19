import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveL1History, deriveL1Power } from '../src/helpers/phaseHelper';

describe('L1 fallback calculation', () => {
  it('derives L1 from total minus L2 minus L3', () => {
    assert.equal(deriveL1Power(470, 119, -49), 400);
  });

  it('returns null when one input is missing', () => {
    assert.equal(deriveL1Power(470, null, -49), null);
  });

  it('derives aligned history buckets', () => {
    const total = [{ t: 1, v: 470 }, { t: 2, v: 600 }];
    const l2 = [{ t: 1, v: 119 }, { t: 2, v: 150 }];
    const l3 = [{ t: 1, v: -49 }, { t: 2, v: 50 }];
    assert.deepEqual(deriveL1History(total, l2, l3), [{ t: 1, v: 400 }, { t: 2, v: 400 }]);
  });
});
