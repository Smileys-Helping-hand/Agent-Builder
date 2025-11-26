import { execSync } from 'child_process';

if (process.env.SKIP_PREPARE !== '1') {
  console.log('🔧 Preparing app assets...');
  execSync('npm run prepare-build-env', { stdio: 'inherit' });
}

console.log('📦 Building Windows installer...');
execSync('npx electron-builder --win --config electron-builder.yml', {
  stdio: 'inherit',
});
