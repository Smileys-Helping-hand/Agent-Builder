import { execSync } from 'child_process';

if (process.env.SKIP_PREPARE !== '1') {
  console.log('🔧 Preparing app assets...');
  execSync('npm run prepare-build-env', { stdio: 'inherit' });
}

console.log('📦 Building Linux installer...');
execSync('npx electron-builder --linux --config electron-builder.yml', { stdio: 'inherit' });
