import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaddleVatCase, parseVatDate, parseVatMoney } from '../scripts/lib/paddle-vat-adapter';

test('解析增值税发票金额和日期', () => {
  assert.equal(parseVatMoney('¥ 2,689.00'), 2689);
  assert.equal(parseVatDate('2026年02月05日'), '2026-02-05');
  assert.equal(parseVatDate('2026-13-40'), null);
});

test('根据 question-answer linking 还原关键字段', () => {
  const tokens = [
    { transcription: 'No', label: 'question', points: [[0, 0], [10, 0], [10, 10], [0, 10]], id: 0, linking: [[0, 1]] },
    { transcription: '12269563', label: 'answer', points: [[20, 0], [40, 0], [40, 10], [20, 10]], id: 1, linking: [[0, 1]] },
    { transcription: '开票日期', label: 'question', points: [[0, 20], [10, 20], [10, 30], [0, 30]], id: 2, linking: [[2, 3]] },
    { transcription: '2026年02月05日', label: 'answer', points: [[20, 20], [60, 20], [60, 30], [20, 30]], id: 3, linking: [[2, 3]] },
    { transcription: '销售方名称', label: 'question', points: [[0, 40], [20, 40], [20, 50], [0, 50]], id: 4, linking: [[4, 5]] },
    { transcription: '示例科技有限公司', label: 'answer', points: [[30, 40], [90, 40], [90, 50], [30, 50]], id: 5, linking: [[4, 5]] },
    { transcription: '价税合计（小写）', label: 'question', points: [[0, 60], [30, 60], [30, 70], [0, 70]], id: 6, linking: [[6, 7]] },
    { transcription: '￥2689.00', label: 'answer', points: [[40, 60], [90, 60], [90, 70], [40, 70]], id: 7, linking: [[6, 7]] },
  ];
  const result = buildPaddleVatCase(`b33.jpg\t${JSON.stringify(tokens)}`, 'val', 'C:/tmp/imgs');
  assert.equal(result.invoiceNumber, '12269563');
  assert.equal(result.date, '2026-02-05');
  assert.equal(result.sellerName, '示例科技有限公司');
  assert.equal(result.amount, 2689);
  assert.equal(result.pairs.length, 4);
});

test('兼容官方标注中的简称和相近字', () => {
  const tokens = [
    { transcription: '名称', label: 'question', points: [[0, 0], [10, 0], [10, 10], [0, 10]], id: 0, linking: [[0, 1]] },
    { transcription: '深圳市购机汇网络有限公司', label: 'answer', points: [[20, 0], [80, 0], [80, 10], [20, 10]], id: 1, linking: [[0, 1]] },
    { transcription: '税颜', label: 'question', points: [[0, 20], [10, 20], [10, 30], [0, 30]], id: 2, linking: [[2, 3]] },
    { transcription: '￥507.82', label: 'answer', points: [[20, 20], [60, 20], [60, 30], [20, 30]], id: 3, linking: [[2, 3]] },
    { transcription: '开叠日期：', label: 'question', points: [[0, 40], [20, 40], [20, 50], [0, 50]], id: 4, linking: [[4, 5]] },
    { transcription: '2016年06月12日', label: 'answer', points: [[30, 40], [90, 40], [90, 50], [30, 50]], id: 5, linking: [[4, 5]] },
  ];
  const result = buildPaddleVatCase(`b0.jpg\t${JSON.stringify(tokens)}`, 'train', 'C:/tmp/imgs');
  assert.equal(result.buyerName, '深圳市购机汇网络有限公司');
  assert.equal(result.taxAmount, 507.82);
  assert.equal(result.date, '2016-06-12');
});
