import test from 'node:test';
import assert from 'node:assert/strict';
import { parseData, describeData } from '../server/data.js';

const xml = `<?xml version="1.0"?>
<invoice number="7"><customer><name>א</name></customer>
<items><item><sku>1</sku></item><item><sku>2</sku></item></items></invoice>`;

test('XML: root unwrapped, attributes with @, repeated elements become arrays', () => {
  const r = describeData(xml);
  assert.equal(r.format, 'xml');
  assert.equal(r.data['@number'], '7');
  assert.equal(r.data.customer.name, 'א');
  assert.equal(r.data.items.item.length, 2);
  assert.deepEqual(r.arrays, ['items.item']);
  const items = r.tree.children.find((c) => c.name === 'items').children[0];
  assert.equal(items.kind, 'array');
  assert.equal(items.children[0].path, 'sku');
});

test('XML: known array paths stay arrays with a single item', () => {
  const one = '<invoice><items><item><sku>1</sku></item></items></invoice>';
  assert.ok(!Array.isArray(parseData(one).items.item));
  assert.ok(Array.isArray(parseData(one, { arrays: ['items.item'] }).items.item));
});

test('values are kept as text (leading zeros survive)', () => {
  assert.equal(parseData('<a><id>00123</id></a>').id, '00123');
});

test('JSON and errors', () => {
  assert.deepEqual(parseData('{"a":[1,2]}'), { a: [1, 2] });
  assert.throws(() => parseData('{bad'), /JSON/);
  assert.throws(() => parseData('<a><b></a>'), /XML/);
});
