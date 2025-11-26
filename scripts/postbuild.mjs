import { execSync } from 'child_process';

execSync('npm --prefix electron run start', { stdio: 'inherit' });
