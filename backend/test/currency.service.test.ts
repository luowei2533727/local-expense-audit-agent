import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrencyFromCountry } from '../src/services/currency.service';

test('国家或地区使用本地币种映射', async () => {
  const cases: Array<[string, string]> = [
    ['China', 'CNY'],
    ['United States', 'USD'],
    ['United Kingdom', 'GBP'],
    ['Germany', 'EUR'],
    ['Japan', 'JPY'],
    ['South Korea', 'KRW'],
    ['Singapore', 'SGD'],
    ['Hong Kong', 'HKD'],
    ['Australia', 'AUD'],
    ['Canada', 'CAD'],
    ['Switzerland', 'CHF'],
    ['India', 'INR'],
  ];

  for (const [country, expected] of cases) {
    assert.equal(await getCurrencyFromCountry(country), expected);
  }
});

test('未知地区回退到人民币', async () => {
  assert.equal(await getCurrencyFromCountry('Unknown Region'), 'CNY');
});
