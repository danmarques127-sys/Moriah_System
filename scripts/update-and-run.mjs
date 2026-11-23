// One command for the test preview: fetch the newest code of the current branch, make sure the PDF reader exists, start the server.
import {spawnSync} from 'node:child_process';
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {stdio: 'inherit', ...opts});
const quiet = (cmd, args) => spawnSync(cmd, args, {encoding: 'utf8'});

const pull = run('git', ['pull', '--ff-only']);
if (pull.status !== 0) console.error('Aviso: não consegui atualizar o código (git pull). Seguindo com a versão que está aqui.');

if (quiet('which', ['pdftotext']).status !== 0) {
  console.log('Instalando o leitor de PDF (poppler-utils)...');
  const sudo = quiet('which', ['sudo']).status === 0 ? ['sudo'] : [];
  run(sudo[0] || 'apt-get', [...sudo.slice(1), ...(sudo.length ? ['apt-get'] : []), 'update', '-qq']);
  run(sudo[0] || 'apt-get', [...sudo.slice(1), ...(sudo.length ? ['apt-get'] : []), 'install', '-y', '-qq', 'poppler-utils']);
}
const server = run('node', ['scripts/test-server.mjs']);
process.exit(server.status ?? 0);
