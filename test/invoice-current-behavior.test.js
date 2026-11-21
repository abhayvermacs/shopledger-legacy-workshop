'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var config = require('../config');
var tax = require('../lib/tax');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

test('billing resolves HSN GST and applies coupon discount before tax', function () {
  var items = [{ id: 1, name: 'Rice', hsn: '1006', price: 600, qty: 1 }];
  var totals = pricing.computeTotals(items, 'SAVE10');

  assert.equal(tax.getRateForItem(items[0]), 0.05);
  assert.equal(totals.subtotal, 600);
  assert.equal(totals.discount, 60);
  assert.equal(totals.tax, 27);
  assert.equal(totals.cgst, 13.5);
  assert.equal(totals.sgst, 13.5);
  assert.equal(totals.total, 567);
});

test('invoice figures match the amount and GST breakdown produced by billing', function () {
  var items = [{ id: 1, name: 'Rice', sku: 'R-1', hsn: '1006', price: 600, qty: 1 }];
  var order = { id: 11, coupon: 'SAVE10', items: items };
  var billed = pricing.computeTotals(items, order.coupon);
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(printed.subtotal, billed.subtotal);
  assert.equal(printed.discount, billed.discount);
  assert.equal(printed.tax, billed.tax);
  assert.equal(printed.cgst, billed.cgst);
  assert.equal(printed.sgst, billed.sgst);
  assert.equal(printed.total, billed.total);
});

test('invoice uses the HSN slab and matches billing when gstRate is absent', function () {
  var order = {
    id: 7,
    coupon: '',
    items: [{ id: 1, name: 'Rice', sku: 'R-1', hsn: '1006', price: 1000, qty: 1 }]
  };
  var billed = pricing.computeTotals(order.items, '');
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(config.tax.hsnSlabs['1006'], 5);
  assert.equal(billed.tax, 50);
  assert.equal(billed.total, 1050);
  assert.equal(printed.rows[0].gstPercent, 5);
  assert.equal(printed.rows[0].lineTax, 50);
  assert.equal(printed.tax, billed.tax);
  assert.equal(printed.cgst, billed.cgst);
  assert.equal(printed.sgst, billed.sgst);
  assert.equal(printed.total, billed.total);
});

test('invoice percentage coupon matches the capped billing discount and post-discount GST', function () {
  var order = {
    id: 8,
    coupon: 'SAVE10',
    items: [{ id: 2, name: 'Item', hsn: '1006', gstRate: 5, price: 2000, qty: 1 }]
  };
  var billed = pricing.computeTotals(order.items, order.coupon);
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(billed.discount, 150);
  assert.equal(billed.tax, 92.5);
  assert.equal(billed.total, 1942.5);
  assert.equal(printed.tax, billed.tax);
  assert.equal(printed.discount, billed.discount);
  assert.equal(printed.total, billed.total);
});

test('invoice does not apply an inactive coupon that billing rejects', function () {
  var order = {
    id: 9,
    coupon: 'DIWALI20',
    items: [{ id: 3, name: 'Small item', gstRate: 5, price: 100, qty: 1 }]
  };
  var validation = require('../lib/coupons').validate(order.coupon, 100);
  var billed = pricing.computeTotals(order.items, order.coupon);
  var printed = invoice.computeInvoiceFigures(order);

  assert.equal(validation.valid, false);
  assert.equal(billed.discount, 0);
  assert.equal(billed.total, 105);
  assert.equal(printed.discount, billed.discount);
  assert.equal(printed.total, billed.total);
});

test('GST reconciliation marks invoice and ledger figures as matched in memory', function () {
  var items = [{ id: 4, name: 'Rice', hsn: '1006', price: 1000, qty: 1 }];
  var billed = pricing.computeTotals(items, '');
  var order = {
    id: 10,
    date: '21/11/2026',
    customer: 'Walk-in',
    coupon: '',
    status: 'completed',
    items: items,
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  };

  var result = reports.getGstReconciliation({ orders: [order], customers: [], products: [] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.rows[0].invoiceTax, billed.tax);
  assert.equal(result.rows[0].ledgerTax, billed.tax);
  assert.equal(result.rows[0].invoiceTotal, billed.total);
  assert.equal(result.rows[0].ledgerTotal, billed.total);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});

