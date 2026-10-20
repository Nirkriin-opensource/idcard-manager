import {readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as tar from 'tar';
const root=process.cwd(),parent=path.dirname(root),name=path.basename(root),delivery=path.join(root,'delivery');
const excluded=new Set(['node_modules','.next','dist','.git','storage','test-results']);
async function files(dir:string):Promise<string[]>{
 const out:string[]=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(excluded.has(entry.name)||entry.isSymbolicLink()||entry.name.endsWith('.tsbuildinfo')||(entry.name.startsWith('.env')&&entry.name!=='.env.example'))continue;
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())out.push(...await files(full));
  else if(entry.isFile())out.push(path.relative(root,full).split(path.sep).join('/'));
 }return out.sort();
}
const phases=[
 {title:'Automated acceptance, Linux checks and first-card setup',paths:['package.json','package-lock.json','.github/workflows/ci.yml','src/components/Setup.tsx','src/components/client.ts','src/components/Workspace.tsx','src/core/starter.ts','src/core/version.ts','src/core/api.ts','tests/core.test.ts','tests/workflows.test.ts','tests/setup.test.ts','tests/deployment.test.ts','tests/integration/workflow.test.ts','scripts/linux-check.sh','docs/ACCEPTANCE.md','docs/VERIFICATION.md'],verify:'Run npm run check. Windows: 38 unit tests and 20 integration/browser tests pass. Native Ubuntu 24.04 WSL: build and 35 unit tests pass; 19 API/worker/PDF/volume tests pass and one browser test is explicitly skipped. The 100-row Excel/100-portrait workflow survives an interrupted worker without duplicate numbers and exports 26 duplex pages. Starter rendering/QR and wizard persistence are verified. CI matrix is pinned to official commits but not dispatched. Fresh-server root and physical printer acceptance is documented, not claimed complete.'},
 {title:'Production hardening and recovery integration',paths:['install.sh','deploy/scripts/idcardctl','deploy/scripts/harden.sh','deploy/scripts/security-check.sh','deploy/security/52idcard-upgrades','deploy/systemd/idcard-web.service','deploy/systemd/idcard-worker.service','deploy/systemd/idcard-backup.service','deploy/systemd/idcard-backup.timer','src/core/operations.ts','src/core/doctor.ts','release.json','src/app/styles.css','README.md','docs/HARDENING.md','docs/BACKUP-RESTORE.md','docs/DEPLOYMENT.md','docs/INSTALLATION.md','docs/SECURITY.md','docs/PHASES.md','CHANGELOG.md'],verify:'On a dedicated Ubuntu server run installer, idcardctl harden (optional --fail2ban), security, doctor and test. UFW preserves SSH ports and existing explicit rules; Ubuntu unattended security updates are enabled without automatic reboot. Services are unprivileged/sandboxed and can access staged restored storage; update/rollback refresh runtime definitions. Native Bash syntax and read-only systemd offline analysis pass; both units score 2.9 OK. Root policy activation/TLS/real dump restore and physical print/scan are unverified and require the exact ACCEPTANCE.md rehearsal.'}
];
async function main(){
await mkdir(delivery,{recursive:true});
for(let i=0;i<phases.length;i++){
 const p=phases[i];let text=`# Phase ${i+21}: ${p.title}\n\nStatus: implementation integrated in release 0.22.0. Target-platform acceptance limits are recorded below and in docs/VERIFICATION.md.\n\n## Run and verify\n\nBuild: npm ci; npm run build. Checks: npm test; npm run test:integration.\n\n${p.verify}\n\n## Complete relevant source contents\n\nShared files show current integrated phase 1–22 contents. Historical phase 1–20 reports remain separately labeled.\n\n`;
 for(const f of p.paths)text+=`### ${f}\n\n~~~~\n${await readFile(path.join(root,f),'utf8')}\n~~~~\n\n`;
 await writeFile(path.join(delivery,`phase-${i+21}.md`),text);
}
let selected=(await files(root)).filter(f=>!['delivery/source-files.txt','delivery/SHA256SUMS.txt'].includes(f));
const hashes=[];for(const f of selected)hashes.push(`${createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')}  ${f}`);
await writeFile(path.join(delivery,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
selected=[...selected,'delivery/source-files.txt','delivery/SHA256SUMS.txt'];
await writeFile(path.join(delivery,'source-files.txt'),selected.map(f=>`${name}/${f}`).join('\n')+'\n');
const output=path.join(parent,'idcard-phases-01-22.tar.gz');
await tar.c({file:output,gzip:true,cwd:parent,portable:true},selected.map(f=>`${name}/${f}`));
const digest=createHash('sha256').update(await readFile(output)).digest('hex');await writeFile(output+'.sha256',`${digest}  ${path.basename(output)}\n`);
console.log(`Packaged ${(await stat(output)).size} bytes: ${output}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
