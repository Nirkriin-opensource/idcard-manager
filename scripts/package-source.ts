import {readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=process.cwd(),parent=path.dirname(root),name=path.basename(root),delivery=path.join(root,'delivery');
const excluded=new Set(['node_modules','.next','dist','.git','storage','test-results']);
async function files(dir:string):Promise<string[]>{
  const list:string[]=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(excluded.has(entry.name)||entry.isSymbolicLink()||entry.name.endsWith('.tsbuildinfo')||(entry.name.startsWith('.env')&&entry.name!=='.env.example'))continue;
    const full=path.join(dir,entry.name);if(entry.isDirectory())list.push(...await files(full));else if(entry.isFile())list.push(path.relative(root,full).split(path.sep).join('/'));
  }
  return list.sort();
}
const phases:{title:string;paths:string[];verify:string}[]=[
  {title:'Repository and native deployment foundation',paths:['package.json','package-lock.json','tsconfig.json','tsconfig.server.json','next.config.ts','.env.example','.gitignore','.gitattributes','install.sh','deploy/systemd/idcard-web.service','deploy/systemd/idcard-worker.service','deploy/caddy/Caddyfile.example','deploy/scripts/idcardctl','src/app/layout.tsx','src/app/page.tsx','src/app/styles.css','src/worker/main.ts','src/cli/main.ts','README.md','docs/INSTALLATION.md','docs/DEPLOYMENT.md'],verify:'npm ci; npm run build. On a fresh Ubuntu staging server: sudo ./install.sh --domain cards.example.org --email admin@example.org; sudo idcardctl test. Ubuntu runtime validation remains outstanding.'},
  {title:'Database and migrations',paths:['src/db/migrations/001_initial.sql','src/core/db.ts','src/core/config.ts','src/core/migrate.ts','tests/integration/workflow.test.ts','docs/ARCHITECTURE.md'],verify:'npm run migrate; repeat without changes. npm run test:integration verifies PostgreSQL 16, migration idempotency, forced RLS and tenant foreign keys.'},
  {title:'Authentication and RBAC',paths:['src/core/auth.ts','src/core/errors.ts','src/core/api.ts','src/components/client.ts','src/components/Workspace.tsx','docs/SECURITY.md'],verify:'npm run admin -- admin@example.org; sign in and replace temporary password. Integration tests verify session/CSRF/Origin controls and Viewer restrictions.'},
  {title:'Organizations, people and fields',paths:['src/core/people.ts','src/core/numbering.ts','src/core/api.ts','src/components/Workspace.tsx','src/components/Numbering.tsx','docs/API.md'],verify:'Create organizations, units, fields and people in the UI. npm run test:integration exercises two tenants, references, numbering and 10,000-record pagination.'},
  {title:'Spreadsheet import',paths:['src/core/imports.ts','src/core/api.ts','src/components/Workspace.tsx','tests/core.test.ts','tests/integration/workflow.test.ts'],verify:'Upload CSV/XLSX, map ID/name, validate, preview and commit. Tests reject duplicate IDs/formulas, prevent repeated commit and read generated Excel error reports.'},
  {title:'Photos and matching',paths:['src/core/storage.ts','src/core/imports.ts','src/core/api.ts','src/components/PhotoTools.tsx','src/components/Workspace.tsx','tests/zip-fixture.ts','tests/integration/workflow.test.ts'],verify:'Upload photos or ZIP with filenames equal to person IDs, inspect automatic matches, crop to a new asset and manually reassign. Integration tests check original preservation, thumbnails and tenant protection.'},
  {title:'Template designer and versioning',paths:['src/core/template.ts','src/components/Designer.tsx','src/components/Workspace.tsx','src/app/styles.css','src/core/api.ts'],verify:'Create front/back, drag/transform elements, test layers/lock/align/grid/rulers/zoom/undo/redo/copy-paste and save. Open the real server preview; integration tests verify immutable versions and browser operation.'},
  {title:'Dynamic binding',paths:['src/core/template.ts','src/core/render.ts','tests/core.test.ts'],verify:'Bind {{name}}, {{external_id}} and configured custom keys. npm test checks missing fields, inherited-key rejection, escaping and overflow errors.'},
  {title:'QR and barcodes',paths:['src/core/template.ts','src/core/render.ts','src/components/Designer.tsx','tests/core.test.ts'],verify:'npm test independently decodes generated QR and Code128/Code39/EAN/UPC images, including equivalent normalized retail identifiers. It also rejects invalid data, insufficient contrast and undersized codes.'},
  {title:'Authoritative card rendering',paths:['src/core/render.ts','src/core/storage.ts','src/core/api.ts','src/core/doctor.ts','src/core/demo.ts','src/components/Workspace.tsx','tests/integration/workflow.test.ts','docs/PHASES.md','docs/VERIFICATION.md','docs/TROUBLESHOOTING.md','docs/BACKUP-RESTORE.md','CHANGELOG.md','THIRD-PARTY-NOTICES.md'],verify:'Choose a real person/template in Cards and generate a DRAFT. Check saved front/back, dimensions and DPI; change the template and confirm historical output stays identical. See recorded build/tests in delivery/.'}
];
async function main(){
  await mkdir(delivery,{recursive:true});
  for(let i=0;i<phases.length;i++){
    const phase=phases[i];let report=`# Phase ${i+1}: ${phase.title}\n\nStatus: implemented in integrated release 0.10.0. See docs/VERIFICATION.md for tested scope and remaining deployment gates.\n\n## Commands and verification\n\n${phase.verify}\n\n## Complete source contents\n\nShared files below show their final integrated phase 1–10 contents.\n\n`;
    for(const file of phase.paths){const text=await readFile(path.join(root,file),'utf8');report+=`### ${file}\n\n~~~~\n${text}\n~~~~\n\n`;}
    await writeFile(path.join(delivery,`phase-${String(i+1).padStart(2,'0')}.md`),report);
  }
  const selected=(await files(root)).filter(f=>!['delivery/source-files.txt','delivery/SHA256SUMS.txt'].includes(f));
  await writeFile(path.join(delivery,'source-files.txt'),selected.map(f=>`${name}/${f}`).join('\n')+'\n');
  const hashes=[];for(const f of selected)hashes.push(`${createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')}  ${f}`);
  await writeFile(path.join(delivery,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
  // Append the manifests after hashing source files, avoiding self-referential checksums.
  await writeFile(path.join(delivery,'source-files.txt'),[...selected,'delivery/source-files.txt','delivery/SHA256SUMS.txt'].map(f=>`${name}/${f}`).join('\n')+'\n');
  const output=path.join(parent,'idcard-phases-01-10.tar.gz');
  const tar=spawnSync('tar',['-czf',output,'-T',path.join(delivery,'source-files.txt')],{cwd:parent,stdio:'inherit'});if(tar.error)throw tar.error;if(tar.status!==0)throw new Error(`Source archive failed with exit ${tar.status}`);
  const digest=createHash('sha256').update(await readFile(output)).digest('hex');await writeFile(output+'.sha256',`${digest}  ${path.basename(output)}\n`);console.log(`Packaged ${(await stat(output)).size} bytes: ${output}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
