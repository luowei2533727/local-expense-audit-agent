import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const descriptionTranslations: Record<string, string> = {
  'Flight to client site for Q1 review meeting': '前往客户现场参加第一季度复盘会议的机票',
  'Three nights during partner conference': '合作伙伴会议期间住宿三晚',
  'Airport transfers for team lead': '团队负责人往返机场交通费',
  'Client breakfast meeting': '客户早餐会议餐费',
  'Monthly cloud infrastructure bill': '月度云基础设施账单',
  'Annual license renewal for 10 seats': '十个账号的年度许可证续费',
  'Shipment of demo equipment to trade show': '将演示设备寄送至展会的运费',
  'Hotel during sales training workshop': '销售培训工作坊期间住宿费',
  'Product launch campaign': '产品发布推广活动费用',
  'Team subscription for online courses Q2': '第二季度团队在线课程订阅',
  'Laptop replacement for new engineer': '为新入职工程师更换笔记本电脑',
  'Team lunch during sprint retrospective': '迭代复盘期间团队午餐',
  'Quarterly video conferencing subscription': '季度视频会议软件订阅',
  'Stationery and printer cartridges': '文具和打印机墨盒采购',
  'Paid search campaign for new market entry': '新市场进入的付费搜索推广',
  'Flight to headquarters for annual strategy review': '前往总部参加年度战略复盘会议的机票',
  'Requested high-end monitor — personal use suspected': '申请采购高端显示器，疑似存在个人用途',
  'Client dinner at premium restaurant during contract negotiation': '合同谈判期间在高档餐厅招待客户晚餐',
  'Sponsored booth at industry expo — full payment upfront': '行业展会赞助展位费用，需要预付全款',
};

const approvalCommentTranslations: Record<string, string> = {
  'Approved — travel is justified for this meeting.': '已通过，本次会议的差旅支出合理。',
  'Final approval granted.': '最终审批已通过。',
  'Rejected: equipment budget exceeded for this quarter. Please resubmit next quarter with manager pre-approval.':
    '本季度设备预算已超出，无法通过；请在下季度取得经理预批准后重新提交。',
  'Marketing spend aligns with our Q2 plan.': '该市场支出符合第二季度计划。',
  'Approved.': '已通过。',
  'Confirmed.': '已确认。',
};

const auditCommentTranslations: Record<string, string> = {
  'Approved — travel is justified.': '已通过，本次差旅支出合理。',
  'Final approval granted.': '最终审批已通过。',
  'Exceeds equipment budget.': '已超出设备预算。',
};

async function main() {
  let expenses = 0;
  let approvals = 0;
  let policies = 0;
  let auditLogs = 0;

  for (const [english, chinese] of Object.entries(descriptionTranslations)) {
    const result = await prisma.expense.updateMany({
      where: { description: english },
      data: { description: chinese },
    });
    expenses += result.count;
  }

  for (const [english, chinese] of Object.entries(approvalCommentTranslations)) {
    const result = await prisma.approvalRequest.updateMany({
      where: { comment: english },
      data: { comment: chinese },
    });
    approvals += result.count;
  }

  const policyResult = await prisma.approvalPolicy.updateMany({
    where: { name: 'Standard Approval Policy' },
    data: { name: '标准报销审批策略' },
  });
  policies += policyResult.count;

  const logs = await prisma.auditLog.findMany({ select: { id: true, metadata: true } });
  for (const log of logs) {
    try {
      const metadata = JSON.parse(log.metadata) as Record<string, unknown>;
      const comment = typeof metadata.comment === 'string' ? metadata.comment : undefined;
      if (!comment || !auditCommentTranslations[comment]) continue;
      metadata.comment = auditCommentTranslations[comment];
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { metadata: JSON.stringify(metadata) },
      });
      auditLogs += 1;
    } catch {
      // 历史记录可能包含非 JSON 文本；保留原值，不影响其他数据的本地化。
    }
  }

  console.log(`本地化完成：报销 ${expenses} 条，审批意见 ${approvals} 条，策略 ${policies} 条，审计日志 ${auditLogs} 条。`);
}

main()
  .catch((error) => {
    console.error('本地化演示数据失败：', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
