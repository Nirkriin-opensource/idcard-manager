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
 {title:'PNG/JPG exports',paths:['src/core/exports.ts','src/core/render.ts','src/core/storage.ts','src/core/workflows-api.ts'],verify:'Generate a card, then download PNG at 300/600 DPI and JPG at quality 95. Verify frozen content after template changes. Codes reject JPEG quality below 85. Integration tests decode exported images and check metadata.'},
 {title:'PDF exports',paths:['src/core/exports.ts','package.json','package-lock.json'],verify:'Export exact-size PDF or a bulk PDF job. Integration tests parse page geometry with PDF.js, render the PDF to PNG and independently decode its QR. The printed sheet has been visually inspected; physical printer acceptance remains outstanding.'},
 {title:'Printing and profiles',paths:['src/core/exports.ts','src/components/Workflows.tsx','tests/workflows.test.ts'],verify:'Choose A4/A3/Letter/custom paper and columns/rows/margins/spacing/bleed/crop marks. Save a profile. Duplex back positions mirror columns for long edge and rows for short edge. Print at 100%/actual size and calibrate with two distinct cards before production stock.'},
 {title:'Bulk generation and durable jobs',paths:['src/core/jobs.ts','src/core/cards.ts','src/worker/main.ts','src/db/migrations/002_workflows.sql','src/components/Workflows.tsx'],verify:'Submit selected/filtered people from Jobs, close the browser and reopen progress. The real-worker integration test completes generation and ZIP export; resubmission returns the same job. Retry transient failures, cancel pending items; stable IDs prevent duplicate cards. Correcting invalid frozen source data requires a fresh job.'},
 {title:'Live public verification',paths:['src/core/verification.ts','src/app/verify/[token]/page.tsx','src/core/api.ts','src/core/workflows-api.ts'],verify:'Activate a card, configure approved non-private public fields, scan/open its verify URL, mark LOST and confirm fields disappear and state changes. Default public allowlist is empty. Live routes use no-store and public rate limits.'},
 {title:'Optional location and maps',paths:['src/core/locations.ts','src/components/LocationMap.tsx','src/components/Designer.tsx','src/components/Workflows.tsx','src/core/render.ts'],verify:'Enable Locations in Privacy, store org/unit coordinates and a licensed static map asset, bind location.url/address or add a Map element. Disable and confirm new location use is denied. Interactive Leaflet tiles require explicit loading; no bulk public tile download or geocoding occurs.'},
 {title:'History and card lifecycle',paths:['src/core/cards.ts','src/core/workflows-api.ts','src/db/migrations/003_audit_guards.sql','src/components/Workflows.tsx'],verify:'Use Cards history to activate/print/suspend/report lost, extend to a later expiry, renew or reissue. Replacement creates a new active token and preserves old REPLACED history. Existing expiry is preserved unless explicitly changed. History and cards cannot be deleted.'},
 {title:'Dashboard and reports',paths:['src/components/Workflows.tsx','src/components/Workspace.tsx','src/app/styles.css','src/core/workflows-api.ts'],verify:'Dashboard displays tenant totals, generation/status/department/import charts and recent work. Download CSV status counts. Integration/browser tests check real database results and every new screen.'},
  {title:'Audit and security hardening',paths:['src/core/auth.ts','src/core/api.ts','src/core/verification.ts','src/core/workflows-api.ts','src/db/migrations/003_audit_guards.sql','src/proxy.ts','src/app/layout.tsx','next.config.ts','docs/SECURITY.md'],verify:'Test tenant and exact bearer scope restrictions, expiry/revocation, CSRF/Origin, immutable audit and secret exclusion. Browser hydration runs under nonce/strict-dynamic CSP. Persistent API/verify/login throttles apply. Review dependency-audit-20.json. Independent security and final production hardening are later acceptance gates.'},
 {title:'Native backup/restore/update/rollback operations',paths:['src/core/archive.ts','src/core/database-files.ts','src/core/operations.ts','src/core/migrate.ts','src/core/doctor.ts','src/cli/main.ts','deploy/scripts/idcardctl','deploy/systemd/idcard-backup.service','deploy/systemd/idcard-backup.timer','install.sh','release.json','docs/BACKUP-RESTORE.md','docs/DEPLOYMENT.md'],verify:'On fresh Ubuntu: install, doctor/test, backup; validate a separate-server staged restore; update from trusted source; inspect rollback compatibility and three-release retention; inspect daily timer/14-day backup retention. Source/unit/archive checks pass locally. Root/systemd/Caddy/real native dump restore execution is unverified in Windows and must not be represented as certified.'},
];
async function main(){
await mkdir(delivery,{recursive:true});
for(let i=0;i<phases.length;i++){
 const p=phases[i];let text=`# Phase ${i+11}: ${p.title}\n\nStatus: implementation integrated in release 0.20.0. Target-platform acceptance limits are recorded below and in docs/VERIFICATION.md.\n\n## Run and verify\n\nBuild: npm ci; npm run build. Checks: npm test; npm run test:integration.\n\n${p.verify}\n\n## Complete relevant source contents\n\nShared files show current integrated phase 1–20 contents. Historical phase 1–10 reports remain separately labeled.\n\n`;
 for(const f of p.paths)text+=`### ${f}\n\n~~~~\n${await readFile(path.join(root,f),'utf8')}\n~~~~\n\n`;
 await writeFile(path.join(delivery,`phase-${i+11}.md`),text);
}
let selected=(await files(root)).filter(f=>!['delivery/source-files.txt','delivery/SHA256SUMS.txt'].includes(f));
const hashes=[];for(const f of selected)hashes.push(`${createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')}  ${f}`);
await writeFile(path.join(delivery,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
selected=[...selected,'delivery/source-files.txt','delivery/SHA256SUMS.txt'];
await writeFile(path.join(delivery,'source-files.txt'),selected.map(f=>`${name}/${f}`).join('\n')+'\n');
const output=path.join(parent,'idcard-phases-01-20.tar.gz');
await tar.c({file:output,gzip:true,cwd:parent,portable:true},selected.map(f=>`${name}/${f}`));
const digest=createHash('sha256').update(await readFile(output)).digest('hex');await writeFile(output+'.sha256',`${digest}  ${path.basename(output)}\n`);
console.log(`Packaged ${(await stat(output)).size} bytes: ${output}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
