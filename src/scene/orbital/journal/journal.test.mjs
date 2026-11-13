import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK, coverPose, leafPose, openingStackPose, paperHalfThickness } from './bookModel.ts';
import { journalPages, loadLocalJournal, saveLocalJournal } from './journalStorage.ts';

const todayKey = 'pocketworld:journal:today';
const historyKey = 'pocketworld:journal:entries:v1';
const storage = values => {
  const records = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
};

test('legacy diary pages are kept in order and a newer copy of today replaces only its matching entry', () => {
  const first = { id: 'first', date: '2026-11-12', text: '昨天', updatedAt: '2026-11-12T09:00:00Z' };
  const today = { id: 'today', date: '2026-11-13', text: '草稿', updatedAt: '2026-11-13T09:00:00Z' };
  const legacy = storage({
    [historyKey]: [first, today],
    [todayKey]: { ...today, text: '今天', updatedAt: '2026-11-13T10:00:00Z' },
  });
  const restored = loadLocalJournal(legacy);
  assert.deepEqual(journalPages(restored).map(page => page.text), ['昨天', '今天']);
  saveLocalJournal(legacy, { ...restored, pages: [{ text: '左页', weather: 'rainy' }, { text: '右页', date: today.date }] });
  assert.deepEqual(journalPages(loadLocalJournal(legacy)), [{ text: '左页', weather: 'rainy' }, { text: '右页', date: today.date }]);
  assert.equal(JSON.parse(legacy.getItem(todayKey)).text, '今天');
});

test('a legacy notebook preserves its own page dates, weather and text even with a partial envelope', () => {
  const pages = [{ text: '一', date: '2026-11-12', weather: 'cloudy' }, { text: '二', weather: 'sunny' }];
  assert.deepEqual(journalPages(loadLocalJournal(storage({ [todayKey]: { text: '一', pages } }))), pages);
});

test('expanded legacy books retain their closed cover clearance and turning sheets clear the boards', () => {
  for (const leafCount of [BOOK.leaves, BOOK.leaves * 3]) {
    const closed = coverPose(0);
    const first = leafPose(0, 0, 0, 0, leafCount);
    assert.ok(closed.y - BOOK.board / 2 > first.points[0].y + BOOK.thickness / 2);
    for (const index of [0, Math.floor(leafCount / 2), leafCount - 1]) {
      for (let frame = 0; frame <= 40; frame++) {
        const turn = frame / 40;
        const { points } = leafPose(index, turn, 1, index + turn, leafCount);
        for (let joint = 1; joint < points.length; joint++) {
          const a = points[joint - 1];
          const b = points[joint];
          assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - BOOK.width / BOOK.segments) < 1e-9);
          assert.ok(b.y > BOOK.board, `leaf ${index}, frame ${frame}, joint ${joint}`);
        }
      }
    }
  }
});

test('opening a bookmarked stack moves its leaves together below the cover and settles on the same spread', () => {
  const spread = BOOK.leaves / 2;
  for (let index = 0; index < BOOK.leaves; index++) {
    assert.deepEqual(openingStackPose(index, 0, spread, BOOK.leaves), leafPose(index, 0, 0, 0, BOOK.leaves));
    const settled = openingStackPose(index, 1, spread, BOOK.leaves);
    const expected = leafPose(index, Number(index < spread), 1, spread, BOOK.leaves);
    settled.points.forEach((point, i) => {
      assert.ok(Math.hypot(point.x - expected.points[i].x, point.y - expected.points[i].y) < 1e-9);
    });
  }
  for (let frame = 0; frame <= 80; frame++) {
    const opening = frame / 80, cover = coverPose(opening, true);
    for (let index = 0; index < spread; index++) {
      const leaf = openingStackPose(index, opening, spread, BOOK.leaves);
      leaf.points.forEach((point, joint) => {
        const signedDistance = (point.x - cover.x) * -Math.sin(cover.angle) + (point.y - cover.y) * Math.cos(cover.angle);
        assert.ok(signedDistance + paperHalfThickness(joint / BOOK.segments, BOOK.leaves) < -BOOK.board / 2, `cover clearance at ${opening}, leaf ${index}`);
      });
      // Every leaf in the left stack opens on the same angle, not one after another.
      if (opening === 0.25) assert.equal(leaf.angles[0], Math.PI * (3 * opening ** 2 - 2 * opening ** 3));
    }
  }
});
