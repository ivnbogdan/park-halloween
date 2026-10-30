import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComment } from '../src/parse.js';

const cases = [
  ['T3, ap. 84', { block: 'T3', floor: 8, apt: 84, floorStated: false }],
  ['T2, et 9, 99', { block: 'T2', floor: 9, apt: 99, floorStated: true }],
  ['T1 ap 117 etaj 12', { block: 'T1', floor: 12, apt: 117, floorStated: true }],
  ['T2, et1,ap11', { block: 'T2', floor: 1, apt: 11, floorStated: true }],
  ['Yuhuuuu! T2, ap 23', { block: 'T2', floor: 2, apt: 23, floorStated: false }],
  ['T2, 7, 73', { block: 'T2', floor: 7, apt: 73, floorStated: true }],
  ['T2,et12,Ap122', { block: 'T2', floor: 12, apt: 122, floorStated: true }],
  ['Bloc 1, etaj 1, ap 13.', { block: 'T1', floor: 1, apt: 13, floorStated: true }],
  ['Blocul Galben, Etaj 6, ap 38', { block: 'TP', floor: 6, apt: 38, floorStated: true }],
  ['Blocul Galben - parter - ap 1', { block: 'TP', floor: 0, apt: 1, floorStated: true }],
  ['TP ap 4', { block: 'TP', floor: 0, apt: 4, floorStated: false }],
  ['T3, et -1, ap 130', { block: 'T3', floor: -1, apt: 130, floorStated: true }],
  ['T1 subsol ap 2', { block: 'T1', floor: -1, apt: 2, floorStated: true }],
  ['T3, et. 5, ap. 50', { block: 'T3', floor: 5, apt: 50, floorStated: true }],
];

for (const [text, expected] of cases) {
  test(text, () => assert.deepEqual(parseComment(text), expected));
}

test('ignores discussion comments', () => {
  assert.equal(parseComment('Ce ziceți de 1 noiembrie, duminică?'), null);
  assert.equal(parseComment('Done.'), null);
});

test('opt-out comments', async () => {
  const { isOptOut } = await import('../src/parse.js');
  assert.equal(isOptOut('Hey! Din pacate noi sambata nu vom mai fi acasa \n t2,et1,ap11'), true);
  assert.equal(isOptOut('Nu mai participam, T1 ap 10'), true);
  assert.equal(isOptOut('Scoateti-ne va rog, T3 ap 84'), true);
  assert.equal(isOptOut('T2, et 5, Ap 53'), false);
  assert.equal(isOptOut('Bloc T2, ap 59, votez pt 31 oct'), false);
  assert.equal(isOptOut('Yuhuuuu! T2, ap 23'), false);
});
