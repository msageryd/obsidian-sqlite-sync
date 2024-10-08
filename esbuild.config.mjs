import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';
import { copyFile, stat, mkdir } from 'fs/promises';
import { join, resolve } from 'path';

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const PLUGIN_NAME = 'obsidian-sqlite-sync';
const VAULT_PATH =
  '/Users/michaelsageryd/Library/Mobile Documents/iCloud~md~obsidian/Documents/the-vault/.obsidian/plugins';

async function copyManifest() {
  await copyFile('src/manifest.json', 'build/manifest.json');
}

async function copyToVault() {
  const pluginDir = join(VAULT_PATH, PLUGIN_NAME);
  const filesToCopy = ['main.js', 'manifest.json'];

  await mkdir(pluginDir, { recursive: true });

  for (const file of filesToCopy) {
    const sourcePath = resolve('build', file);
    const destPath = join(pluginDir, file);
    await copyFile(sourcePath, destPath);
  }
}

const prod = process.argv[2] === 'production';

async function build() {
  console.log('Building plugin...');

  await mkdir('build', { recursive: true });
  await copyManifest();

  const context = await esbuild.context({
    banner: {
      js: banner,
    },
    entryPoints: ['src/main.js'],
    bundle: true,
    external: [
      'obsidian',
      'electron',
      '@codemirror/autocomplete',
      '@codemirror/collab',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      ...builtins,
    ],
    format: 'cjs',
    target: 'es2018',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: 'build/main.js',
  });

  try {
    await context.rebuild();
    await copyToVault();
    console.log('Build completed successfully.');
  } catch (error) {
    console.error('Build failed:', error);
  } finally {
    await context.dispose();
  }
}

if (prod) {
  build().then(() => process.exit(0));
} else {
  build().then(() => console.log('Watching for changes...'));
}
