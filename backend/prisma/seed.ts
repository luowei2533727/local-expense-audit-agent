import { PrismaClient } from '@prisma/client';
import { Role, ExpenseStatus, ApprovalStatus, type RuleType } from '../src/domain/constants';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// All seed identities and companies are synthetic and use reserved domains.
const COMPANIES = [
  { name: 'Demo US Operations',     country: 'United States', currency_code: 'USD' },
  { name: 'Demo Europe Operations', country: 'Germany',       currency_code: 'EUR' },
  { name: 'Demo India Operations',  country: 'India',         currency_code: 'INR' },
];

// ─── Expense categories & sample data ────────────────────────────────────────
const CATEGORIES = ['Travel', 'Meals', 'Accommodation', 'Office Supplies', 'Software', 'Equipment', 'Marketing', 'Training'];

interface SeedExpense {
  merchant: string;
  category: string;
  description: string;
  amountFactor: number; // multiply by currency base amount
}

const EXPENSE_TEMPLATES: SeedExpense[] = [
  { merchant: 'Example Air',          category: 'Travel',          description: '前往客户现场参加第一季度复盘会议的机票', amountFactor: 4.5 },
  { merchant: 'Example Hotel',        category: 'Accommodation',   description: '合作伙伴会议期间住宿三晚', amountFactor: 3.2 },
  { merchant: 'Example Mobility',     category: 'Travel',          description: '团队负责人往返机场交通费', amountFactor: 0.8 },
  { merchant: 'Example Cafe',         category: 'Meals',           description: '客户早餐会议餐费', amountFactor: 0.3 },
  { merchant: 'Cloud Service',        category: 'Software',        description: '月度云基础设施账单', amountFactor: 6.0 },
  { merchant: 'Productivity Suite',   category: 'Software',        description: '十个账号的年度许可证续费', amountFactor: 2.5 },
  { merchant: 'Logistics Service',    category: 'Office Supplies', description: '将演示设备寄送至展会的运费', amountFactor: 0.6 },
  { merchant: 'Training Hotel',       category: 'Accommodation',   description: '销售培训工作坊期间住宿费', amountFactor: 2.8 },
  { merchant: 'Advertising Platform', category: 'Marketing',       description: '产品发布推广活动费用', amountFactor: 5.0 },
  { merchant: 'Learning Platform',    category: 'Training',        description: '第二季度团队在线课程订阅', amountFactor: 1.5 },
  { merchant: 'Hardware Store',       category: 'Equipment',       description: '为新入职工程师更换笔记本电脑', amountFactor: 12.0 },
  { merchant: 'Meal Delivery',        category: 'Meals',           description: '迭代复盘期间团队午餐', amountFactor: 0.4 },
  { merchant: 'Video Conference',     category: 'Software',        description: '季度视频会议软件订阅', amountFactor: 0.9 },
  { merchant: 'Office Supply Store',  category: 'Office Supplies', description: '文具和打印机墨盒采购', amountFactor: 0.5 },
  { merchant: 'Search Advertising',   category: 'Marketing',       description: '新市场进入的付费搜索推广', amountFactor: 7.0 },
];

// Base amounts per currency (realistic local values)
const BASE_AMOUNTS: Record<string, number> = {
  USD: 100, EUR: 95, INR: 8000, MXN: 1700, SAR: 375, CHF: 92,
};

function getAmount(currency: string, factor: number): number {
  const base = BASE_AMOUNTS[currency] || 100;
  return Math.round(base * factor * (0.85 + Math.random() * 0.3) * 100) / 100;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  console.log('🌱 Starting ExpensePilot seed...');

  // Clean existing data (except companies/users from manual signup)
  await prisma.auditLog.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.approvalStep.deleteMany();
  await prisma.approvalPolicy.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  console.log('🗑️  Cleared existing data');

  const demoPassword = process.env.DEMO_SEED_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) {
    throw new Error('DEMO_SEED_PASSWORD must contain at least 12 characters');
  }
  const hash = await bcrypt.hash(demoPassword, 12);

  for (const companyData of COMPANIES) {
    // ── Create Company ──────────────────────────────────────────────────────
    const company = await prisma.company.create({ data: companyData });
    console.log(`\n🏢 ${company.name} (${company.country} · ${company.currency_code})`);

    // ── Create Users ────────────────────────────────────────────────────────
    const slug = company.name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 24);

    const admin = await prisma.user.create({
      data: { email: `admin@${slug}.example`, password_hash: hash, role: 'ADMIN', company_id: company.id },
    });

    const manager1 = await prisma.user.create({
      data: { email: `manager1@${slug}.example`, password_hash: hash, role: 'MANAGER', company_id: company.id, is_manager_approver: true },
    });

    const manager2 = await prisma.user.create({
      data: { email: `manager2@${slug}.example`, password_hash: hash, role: 'MANAGER', company_id: company.id, is_manager_approver: false },
    });

    const emp1 = await prisma.user.create({
      data: { email: `employee1@${slug}.example`, password_hash: hash, role: 'EMPLOYEE', company_id: company.id, manager_id: manager1.id },
    });

    const emp2 = await prisma.user.create({
      data: { email: `employee2@${slug}.example`, password_hash: hash, role: 'EMPLOYEE', company_id: company.id, manager_id: manager1.id },
    });

    const emp3 = await prisma.user.create({
      data: { email: `employee3@${slug}.example`, password_hash: hash, role: 'EMPLOYEE', company_id: company.id, manager_id: manager2.id },
    });

    console.log(`   👤 Admin: admin@${slug}.example`);
    console.log(`   👤 Managers: manager1, manager2`);
    console.log(`   👤 Employees: alice, bob, carol`);

    // ── Create Approval Policy (Sequential + Conditional) ───────────────────
    const policy = await prisma.approvalPolicy.create({
      data: {
        company_id: company.id,
        name: '标准报销审批策略',
        rule_type: 'SEQUENTIAL' as RuleType,
      },
    });

    const step1 = await prisma.approvalStep.create({
      data: { policy_id: policy.id, step_order: 1, approver_role: 'MANAGER' as Role },
    });

    const step2 = await prisma.approvalStep.create({
      data: { policy_id: policy.id, step_order: 2, approver_user_id: admin.id },
    });

    // ── Create Expenses with various statuses ───────────────────────────────
    const employees = [emp1, emp2, emp3];
    const cur = company.currency_code;

    // 1. FULLY APPROVED expense (emp1)
    const approvedExp = await prisma.expense.create({
      data: {
        employee_id: emp1.id,
        amount: getAmount(cur, 2.5),
        currency: cur,
        converted_amount: getAmount(cur, 2.5),
        base_currency: cur,
        category: 'Travel',
        description: '前往总部参加年度战略复盘会议的机票',
        expense_date: daysAgo(20),
        status: 'APPROVED' as ExpenseStatus,
        merchant_name: 'Example Airways',
        created_at: daysAgo(20),
      },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: approvedExp.id, step_id: step1.id, approver_id: manager1.id, status: 'APPROVED' as ApprovalStatus, comment: '已通过，本次会议的差旅支出合理。', decided_at: daysAgo(19) },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: approvedExp.id, step_id: step2.id, approver_id: admin.id, status: 'APPROVED' as ApprovalStatus, comment: '最终审批已通过。', decided_at: daysAgo(18) },
    });
    await prisma.auditLog.create({ data: { expense_id: approvedExp.id, actor_id: emp1.id,    action: 'SUBMITTED', metadata: JSON.stringify({ amount: approvedExp.amount, currency: cur }), ip_address: '192.0.2.10', created_at: daysAgo(20) } });
    await prisma.auditLog.create({ data: { expense_id: approvedExp.id, actor_id: manager1.id, action: 'APPROVED',  metadata: JSON.stringify({ step: 1, comment: '已通过，本次差旅支出合理。' }), ip_address: '192.0.2.21', created_at: daysAgo(19) } });
    await prisma.auditLog.create({ data: { expense_id: approvedExp.id, actor_id: admin.id,    action: 'APPROVED',  metadata: JSON.stringify({ step: 2, comment: '最终审批已通过。' }), ip_address: '192.0.2.1',  created_at: daysAgo(18) } });

    // 2. REJECTED expense (emp2)
    const rejectedExp = await prisma.expense.create({
      data: {
        employee_id: emp2.id,
        amount: getAmount(cur, 8.0),
        currency: cur,
        converted_amount: getAmount(cur, 8.0),
        base_currency: cur,
        category: 'Equipment',
        description: '申请采购高端显示器，疑似存在个人用途',
        expense_date: daysAgo(15),
        status: 'REJECTED' as ExpenseStatus,
        merchant_name: 'Apple Store',
        created_at: daysAgo(15),
      },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: rejectedExp.id, step_id: step1.id, approver_id: manager1.id, status: 'REJECTED' as ApprovalStatus, comment: '本季度设备预算已超出，无法通过；请在下季度取得经理预批准后重新提交。', decided_at: daysAgo(14) },
    });
    await prisma.auditLog.create({ data: { expense_id: rejectedExp.id, actor_id: emp2.id,    action: 'SUBMITTED', metadata: JSON.stringify({ amount: rejectedExp.amount, currency: cur }), ip_address: '192.0.2.11', created_at: daysAgo(15) } });
    await prisma.auditLog.create({ data: { expense_id: rejectedExp.id, actor_id: manager1.id, action: 'REJECTED',  metadata: JSON.stringify({ step: 1, comment: '已超出设备预算。' }), ip_address: '192.0.2.21', created_at: daysAgo(14) } });

    // 3. PENDING (awaiting manager1) — emp3
    const pending1 = await prisma.expense.create({
      data: {
        employee_id: emp3.id,
        amount: getAmount(cur, 1.2),
        currency: cur,
        converted_amount: getAmount(cur, 1.2),
        base_currency: cur,
        category: 'Meals',
        description: '合同谈判期间在高档餐厅招待客户晚餐',
        expense_date: daysAgo(3),
        status: 'PENDING' as ExpenseStatus,
        merchant_name: 'Example Restaurant',
        created_at: daysAgo(3),
      },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: pending1.id, step_id: step1.id, approver_id: manager2.id, status: 'PENDING' as ApprovalStatus },
    });
    await prisma.auditLog.create({ data: { expense_id: pending1.id, actor_id: emp3.id, action: 'SUBMITTED', metadata: JSON.stringify({ amount: pending1.amount, currency: cur }), ip_address: '192.0.2.12', created_at: daysAgo(3) } });

    // 4. UNDER_REVIEW (manager approved, pending admin) — emp1
    const underReview = await prisma.expense.create({
      data: {
        employee_id: emp1.id,
        amount: getAmount(cur, 5.5),
        currency: cur,
        converted_amount: getAmount(cur, 5.5),
        base_currency: cur,
        category: 'Marketing',
        description: '行业展会赞助展位费用，需要预付全款',
        expense_date: daysAgo(7),
        status: 'UNDER_REVIEW' as ExpenseStatus,
        merchant_name: 'Example Events',
        created_at: daysAgo(7),
      },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: underReview.id, step_id: step1.id, approver_id: manager1.id, status: 'APPROVED' as ApprovalStatus, comment: '该市场支出符合第二季度计划。', decided_at: daysAgo(6) },
    });
    await prisma.approvalRequest.create({
      data: { expense_id: underReview.id, step_id: step2.id, approver_id: admin.id, status: 'PENDING' as ApprovalStatus },
    });
    await prisma.auditLog.create({ data: { expense_id: underReview.id, actor_id: emp1.id,    action: 'SUBMITTED', metadata: JSON.stringify({ amount: underReview.amount, currency: cur }), ip_address: '192.0.2.10', created_at: daysAgo(7) } });
    await prisma.auditLog.create({ data: { expense_id: underReview.id, actor_id: manager1.id, action: 'APPROVED',  metadata: JSON.stringify({ step: 1 }), ip_address: '192.0.2.21', created_at: daysAgo(6) } });

    // 5–9. More APPROVED expenses (varied employees, older dates)
    const moreExpenses = [
      { emp: emp1, t: EXPENSE_TEMPLATES[5],  dago: 45, factor: 1.8, status: 'APPROVED' as ExpenseStatus },
      { emp: emp2, t: EXPENSE_TEMPLATES[9],  dago: 38, factor: 1.2, status: 'APPROVED' as ExpenseStatus },
      { emp: emp3, t: EXPENSE_TEMPLATES[12], dago: 30, factor: 0.7, status: 'APPROVED' as ExpenseStatus },
      { emp: emp1, t: EXPENSE_TEMPLATES[2],  dago: 22, factor: 0.9, status: 'APPROVED' as ExpenseStatus },
      { emp: emp2, t: EXPENSE_TEMPLATES[6],  dago: 10, factor: 0.5, status: 'PENDING'  as ExpenseStatus },
    ];

    for (const e of moreExpenses) {
      const exp = await prisma.expense.create({
        data: {
          employee_id: e.emp.id,
          amount: getAmount(cur, e.factor),
          currency: cur,
          converted_amount: getAmount(cur, e.factor),
          base_currency: cur,
          category: e.t.category,
          description: e.t.description,
          expense_date: daysAgo(e.dago),
          status: e.status,
          merchant_name: e.t.merchant,
          created_at: daysAgo(e.dago),
        },
      });

      await prisma.auditLog.create({
        data: { expense_id: exp.id, actor_id: e.emp.id, action: 'SUBMITTED', metadata: JSON.stringify({ amount: exp.amount, currency: cur }), ip_address: '192.0.2.10', created_at: daysAgo(e.dago) },
      });

      if (e.status === 'APPROVED') {
        await prisma.approvalRequest.create({
          data: { expense_id: exp.id, step_id: step1.id, approver_id: manager1.id, status: 'APPROVED' as ApprovalStatus, comment: '已通过。', decided_at: daysAgo(e.dago - 1) },
        });
        await prisma.approvalRequest.create({
          data: { expense_id: exp.id, step_id: step2.id, approver_id: admin.id, status: 'APPROVED' as ApprovalStatus, comment: '已确认。', decided_at: daysAgo(e.dago - 2) },
        });
        await prisma.auditLog.create({ data: { expense_id: exp.id, actor_id: manager1.id, action: 'APPROVED', metadata: JSON.stringify({ step: 1 }), ip_address: '192.0.2.21', created_at: daysAgo(e.dago - 1) } });
        await prisma.auditLog.create({ data: { expense_id: exp.id, actor_id: admin.id, action: 'APPROVED', metadata: JSON.stringify({ step: 2 }), ip_address: '192.0.2.1', created_at: daysAgo(e.dago - 2) } });
      } else {
        await prisma.approvalRequest.create({
          data: { expense_id: exp.id, step_id: step1.id, approver_id: manager1.id, status: 'PENDING' as ApprovalStatus },
        });
      }
    }

    console.log(`   ✅ Created 9 expenses (APPROVED/REJECTED/PENDING/UNDER_REVIEW)`);
  }

  console.log('\n✅ Seed complete! Summary:');
  console.log(`   Companies : ${COMPANIES.length}`);
  console.log(`   Users/co  : 6 (1 admin + 2 managers + 3 employees)`);
  console.log(`   Expenses  : ~9 per company`);
  console.log('\n🔑 Demo password: configured through DEMO_SEED_PASSWORD');
  console.log('\n📧 Example logins (synthetic US company):');
  console.log('   admin@demousoperations.example     → ADMIN');
  console.log('   manager1@demousoperations.example  → MANAGER');
  console.log('   employee1@demousoperations.example → EMPLOYEE');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
