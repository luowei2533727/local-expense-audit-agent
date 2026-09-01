// Local interview defaults. Rates are deliberately explicit and auditable; production should import an approved finance feed.
const CNY_PER_UNIT: Record<string, number> = {
  CNY: 1,
  USD: 7.2,
  EUR: 7.85,
  GBP: 9.15,
  JPY: 0.048,
  HKD: 0.92,
  SGD: 5.35,
  AUD: 4.72,
  CAD: 5.18,
  CHF: 8.15,
  INR: 0.086,
  KRW: 0.0053,
};

const COUNTRY_CURRENCY: Record<string, string> = {
  china: 'CNY', '中国': 'CNY',
  'united states': 'USD', '美国': 'USD',
  japan: 'JPY', '日本': 'JPY',
  singapore: 'SGD', '新加坡': 'SGD',
  'hong kong': 'HKD', '中国香港': 'HKD',
};

export async function getExchangeRates(baseCurrency = 'CNY'): Promise<Record<string, number>> {
  const base = CNY_PER_UNIT[baseCurrency.toUpperCase()];
  if (!base) throw new Error(`本地汇率表不支持 ${baseCurrency}`);
  return Object.fromEntries(Object.entries(CNY_PER_UNIT).map(([currency, cny]) => [currency, cny / base]));
}

export async function convertAmount(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
  const from = CNY_PER_UNIT[fromCurrency.toUpperCase()];
  const to = CNY_PER_UNIT[toCurrency.toUpperCase()];
  if (!from || !to) throw new Error(`本地汇率表不支持 ${fromCurrency} 或 ${toCurrency}`);
  return Number(((amount * from) / to).toFixed(2));
}

export async function getCurrencyFromCountry(countryName: string): Promise<string> {
  return COUNTRY_CURRENCY[countryName.trim().toLowerCase()] || 'CNY';
}

export const localRateNotice = '本地演示汇率，仅用于审批风险换算，不用于财务入账';
