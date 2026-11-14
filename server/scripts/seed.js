import 'dotenv/config';
import { seedDemoData } from '../src/demo.js';
const result = await seedDemoData();
console.log('Development demo accounts ready:');
for (const account of result.accounts) console.log(`${account.role}: ${account.email}`);
console.log('Use only the documented development passwords; seeding is disabled in production.');
