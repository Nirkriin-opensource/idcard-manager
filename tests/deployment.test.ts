import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("web and worker restrict privileges while allowing staged restored storage", async () => {
  for (const name of ["idcard-web", "idcard-worker"]) {
    const source = await readFile(`deploy/systemd/${name}.service`, "utf8");
    for (const setting of [
      "User=idcard",
      "NoNewPrivileges=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "PrivateDevices=true",
      "CapabilityBoundingSet=",
      "RestrictNamespaces=true",
      "-/var/lib/idcard/restored",
    ])
      assert.ok(source.includes(setting), `${name}: ${setting}`);
    assert.ok(
      !source.includes("MemoryDenyWriteExecute=true"),
      "V8 JIT must remain usable",
    );
  }
});
test("hardening retains SSH access and does not reset shared firewall rules", async () => {
  const source = await readFile("deploy/scripts/harden.sh", "utf8");
  assert.ok(
    source.indexOf("for port in") < source.indexOf("ufw --force enable"),
  );
  assert.ok(source.includes("sshd -T"));
  assert.ok(source.includes("SSH_CONNECTION"));
  assert.ok(source.includes("ufw default deny incoming"));
  assert.ok(!/ufw\s+(reset|delete)/.test(source));
  assert.ok(!source.includes("PasswordAuthentication no"));
  const config = await readFile("deploy/security/52idcard-upgrades", "utf8");
  assert.ok(config.includes('Automatic-Reboot "false"'));
  assert.ok(config.includes("${distro_codename}-security"));
});
test("production entrypoints include real diagnostics and preserve data by default", async () => {
  const installer = await readFile("install.sh", "utf8"),
    control = await readFile("deploy/scripts/idcardctl", "utf8");
  assert.ok(installer.includes("deploy/scripts/harden.sh"));
  assert.ok(control.includes("deploy/scripts/security-check.sh"));
  assert.ok(!/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)/.test(installer));
  const operations = await readFile("src/core/operations.ts", "utf8");
  assert.ok(operations.includes("installRuntime(release)"));
  assert.ok(operations.includes("installRuntime(target)"));
});

test("native entrypoints have Unix newlines in source archives", async () => {
  for (const file of [
    "install.sh",
    "deploy/scripts/idcardctl",
    "deploy/scripts/harden.sh",
    "deploy/scripts/security-check.sh",
    "scripts/linux-check.sh",
  ]) {
    assert.ok(
      !(await readFile(file, "utf8")).includes("\r"),
      file + " must use LF newlines",
    );
  }
});

test('installer makes non-secret PostgreSQL config readable before starting the cluster', async () => {
 const source = await readFile('install.sh', 'utf8');
 const create = source.indexOf('>/etc/postgresql/16/main/conf.d/idcard.conf');
 const permissions = source.indexOf('chmod 644 /etc/postgresql/16/main/conf.d/idcard.conf', create);
 const restart = source.indexOf('systemctl restart postgresql@16-main', create);
 assert.ok(create >= 0 && permissions > create && permissions < restart);
});

test('root-owned releases remain readable before service activation', async () => {
 const installer = await readFile('install.sh', 'utf8');
 const own = installer.indexOf('chown -R root:root "$release"');
 const access = installer.indexOf('chmod -R a+rX "$release"', own);
 const activate = installer.indexOf("step='switching application release'", own);
 assert.ok(own >= 0 && access > own && activate > access);
 const operations = await readFile('src/core/operations.ts','utf8');
 const updateOwn = operations.indexOf('run("chown", ["-R", "root:root", release]);');
 const updateAccess = operations.indexOf('run("chmod", ["-R", "a+rX", release]);',updateOwn);
 const switchCode = operations.indexOf('await switchRelease(release)',updateOwn);
 assert.ok(updateOwn >= 0 && updateAccess > updateOwn && switchCode > updateAccess);
});
test('upgrade-policy check reads the exact apt value without an early-exit pipe', async () => {
 const source = await readFile('deploy/scripts/security-check.sh','utf8');
 const check = source.match(/^updates\(\) \{.*\}$/m)?.[0] || '';
 assert.ok(check.includes('apt-config shell IDCARD_UPGRADE_PERIOD APT::Periodic::Unattended-Upgrade'));
 assert.ok(!check.includes('grep -q'));
});
