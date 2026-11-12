import test from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, interpolate, scopeFor, validateExpr, PAGE_TOKENS } from '../shared/expr.js';
import { formatValue } from '../shared/format.js';

const data = {
  customer: { name: 'דני', vip: 'true', 'first-name': 'Dan' },
  vat: '17',
  items: [{ price: '10', qty: 2, '@code': 'A' }, { price: 5.5, qty: '3', '@code': 'B' }],
};
const s = scopeFor(data);

test('paths and arithmetic with numeric strings', () => {
  assert.equal(evalExpr('customer.name', s), 'דני');
  assert.equal(evalExpr('vat * 2', s), 34);
  assert.equal(evalExpr('customer["first-name"]', s), 'Dan');
  assert.equal(evalExpr('items[1].price', s), 5.5);
  assert.deepEqual(evalExpr('items.code', s), ['A', 'B']); // @attribute without the @
});

test('aggregates with per-item expressions', () => {
  assert.equal(evalExpr('sum(items, price * qty)', s), 36.5);
  assert.equal(evalExpr('sum(items.qty)', s), 5);
  assert.equal(evalExpr('count(items, qty > 2)', s), 1);
  assert.equal(evalExpr('max(items, price)', s), 10);
  assert.equal(evalExpr('round(avg(items, price), 2)', s), 7.75);
  assert.equal(evalExpr('join(items, "/", @code)', s), 'A/B');
});

test('conditionals, logic and strings', () => {
  assert.equal(evalExpr('if(vat > 10, "high", "low")', s), 'high');
  assert.equal(evalExpr('vat > 20 ? 1 : 2', s), 2);
  assert.equal(evalExpr('customer.vip == true and vat == 17', s), true);
  assert.equal(evalExpr('"שלום " & customer.name', s), 'שלום דני');
  assert.equal(evalExpr('coalesce(missing, customer.name)', s), 'דני');
  assert.equal(evalExpr('1 / 0', s), 0);
});

test('dates', () => {
  assert.equal(formatValue(evalExpr('addDays("2026-01-31", 1)', s), 'date:dd/MM/yyyy'), '01/02/2026');
  assert.equal(evalExpr('diffDays("01/01/2026", "11/01/2026")', s), 10);
});

test('no access to JavaScript internals', () => {
  assert.equal(evalExpr('constructor', s), undefined);
  assert.equal(evalExpr('customer.constructor', s), undefined);
  assert.equal(evalExpr('customer.__proto__', s), undefined);
  assert.throws(() => evalExpr('eval("1")', s));
});

test('syntax errors are reported', () => {
  assert.ok(validateExpr('price * '));
  assert.ok(validateExpr('sum(items'));
  assert.equal(validateExpr('a + b'), null);
});

test('interpolation with formats and page tokens', () => {
  const out = interpolate('{{customer.name}}: {{sum(items, price*qty) | number:2}} {{page}}/{{pages}}', s);
  assert.equal(out, `דני: 36.50 ${PAGE_TOKENS.page}/${PAGE_TOKENS.pages}`);
  assert.equal(interpolate('{{ vat | percent }}', s), '17%');
  assert.equal(interpolate('{{ bad( }}', s), '#שגיאה');
});

test('formats', () => {
  assert.equal(formatValue('1234.5', 'number:2'), '1,234.50');
  assert.equal(formatValue('1234.5', 'plain:1'), '1234.5');
  assert.equal(formatValue('2026-11-12', 'date:d MMMM yyyy'), '12 נובמבר 2026');
  assert.match(formatValue(10, 'currency'), /10\.00/);
  assert.equal(formatValue('Y', 'bool'), 'כן');
});
