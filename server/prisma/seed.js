const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed Plans
  const plans = [
    { code: 'FREE', name: 'Free', monthly_price: 19.99, trial_days: 30, max_company_admins: 1, max_project_managers: 1, max_employees: 15 },
    { code: 'BASIC', name: 'Basic', monthly_price: 44.99, trial_days: 0, max_company_admins: 1, max_project_managers: 2, max_employees: 25 },
    { code: 'PRO', name: 'Pro', monthly_price: 79.99, trial_days: 0, max_company_admins: 2, max_project_managers: 5, max_employees: 50 },
    { code: 'ADVANCE', name: 'Advance', monthly_price: 119.99, trial_days: 0, max_company_admins: 3, max_project_managers: 5, max_employees: 100 },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
  console.log('Plans seeded');

  // Seed Settings
  const settings = [
    { key: 'overtime_settings', value: JSON.stringify({ enabled: false, threshold: 6 }) },
    { key: 'dev_tools_settings', value: JSON.stringify({ enabled: true }) },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log('Settings seeded');

  // Seed Superadmin
  const hashedPassword = await bcrypt.hash('sadmin', 10);
  const superadmin = await prisma.user.upsert({
    where: { username: 'sadmin' },
    update: {},
    create: {
      full_name: 'System Admin',
      username: 'sadmin',
      email: 'sadmin@local',
      password_hash: hashedPassword,
      role: 'SUPERADMIN',
      status: 'active',
      is_active: true,
    },
  });
  console.log('Superadmin seeded');

  console.log('Database seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });