import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComment, floorFromApt } from '../src/parse.js';

// Mock data only: 9xx apartment numbers do not exist at The Park.
const cases = [
  ['T3, ap. 984', { block: 'T3', floor: 98, apt: 984, floorStated: false }],
  ['T2, et 9, 999', { block: 'T2', floor: 9, apt: 999, floorStated: true }],
  ['T1 ap 917 etaj 12', { block: 'T1', floor: 12, apt: 917, floorStated: true }],
  ['T2, et1,ap911', { block: 'T2', floor: 1, apt: 911, floorStated: true }],
  ['Yuhuuuu! T2, ap 923', { block: 'T2', floor: 92, apt: 923, floorStated: false }],
  ['T2, 7, 973', { block: 'T2', floor: 7, apt: 973, floorStated: true }],
  ['T2,et12,Ap922', { block: 'T2', floor: 12, apt: 922, floorStated: true }],
  ['Bloc 1, etaj 1, ap 913.', { block: 'T1', floor: 1, apt: 913, floorStated: true }],
  ['Blocul Galben, Etaj 6, ap 938', { block: 'TP', floor: 6, apt: 938, floorStated: true }],
  ['Blocul Galben - parter - ap 901', { block: 'TP', floor: 0, apt: 901, floorStated: true }],
  ['T3, et -1, ap 930', { block: 'T3', floor: -1, apt: 930, floorStated: true }],
  ['T1 subsol ap 902', { block: 'T1', floor: -1, apt: 902, floorStated: true }],
  ['T3, et. 5, ap. 950', { block: 'T3', floor: 5, apt: 950, floorStated: true }],
];

for (const [text, expected] of cases) {
  test(text, () => assert.deepEqual(parseComment(text), expected));
}

test('floor deduced from the apartment number', () => {
  assert.equal(floorFromApt(4), 0);
  assert.equal(floorFromApt(45), 4);
});

test('ignores discussion comments', () => {
  assert.equal(parseComment('Ce ziceți de 1 noiembrie, duminică?'), null);
  assert.equal(parseComment('Done.'), null);
});

test('opt-out comments', async () => {
  const { isOptOut } = await import('../src/parse.js');
  assert.equal(isOptOut('Hey! Din pacate noi sambata nu vom mai fi acasa \n t2,et1,ap911'), true);
  assert.equal(isOptOut('Nu mai participam, T1 ap 910'), true);
  assert.equal(isOptOut('Scoateti-ne va rog, T3 ap 984'), true);
  assert.equal(isOptOut('T2, et 5, Ap 953'), false);
  assert.equal(isOptOut('Bloc T2, ap 959, votez pt 31 oct'), false);
  assert.equal(isOptOut('Yuhuuuu! T2, ap 923'), false);
});
