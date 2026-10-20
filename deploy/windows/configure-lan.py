#!/usr/bin/env python3
"""Configure the installed WSL app for a Windows LAN origin; never print secrets."""
import argparse
import datetime
import ipaddress
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def write(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
    try:
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    url = urlsplit(args.origin)
    ip = ipaddress.IPv4Address(url.hostname or "")
    if url.scheme != "http" or url.port != 8080 or not ip.is_private or ip.is_loopback or ip.is_link_local or url.path or url.query or url.fragment or url.username or url.password:
        raise SystemExit("Choose a private Windows IPv4 address on HTTP port 8080.")
    if os.geteuid() != 0:
        raise SystemExit("Run this helper as root inside the installed Ubuntu distro.")
    env = Path("/etc/idcard/idcard.env")
    caddy = Path("/etc/caddy/idcard/app.caddy")
    marker = Path("/etc/idcard/lan-origin")
    old_env, old_caddy = env.read_bytes(), caddy.read_bytes()
    text = old_env.decode()
    matches = re.findall(r"(?m)^APP_ORIGIN=(.*)$", text)
    if len(matches) != 1:
        raise SystemExit("Expected one APP_ORIGIN entry; no changes made.")
    current = shlex.split(matches[0], comments=True)[0]
    previous = marker.read_text().strip() if marker.exists() else ""
    if current not in {"http://localhost", "http://localhost:3000", "http://127.0.0.1", "http://127.0.0.1:3000", previous, args.origin}:
        raise SystemExit("Existing domain configuration preserved. Review the LAN setup before changing it.")
    run("caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
    if args.check:
        print("LAN configuration preflight passed; no changes made.")
        return
    block = (" # BEGIN IDCard managed LAN redirect\n"
             " @idcardLocal host localhost 127.0.0.1\n"
             f" redir @idcardLocal {args.origin}{{uri}} 307\n"
             " # END IDCard managed LAN redirect\n")
    source = old_caddy.decode()
    source = re.sub(r"(?m)^ # BEGIN IDCard managed LAN redirect\n.*?^ # END IDCard managed LAN redirect\n", "", source, flags=re.S)
    if not re.search(r"(?m)^:80\s*\{", source):
        raise SystemExit("Expected the supplied HTTP Caddy site; no changes made.")
    updated_caddy = re.sub(r"(?m)^:80\s*\{\s*\n", ":80 {\n" + block, source, count=1).encode()
    updated_env = re.sub(r"(?m)^APP_ORIGIN=.*$", "APP_ORIGIN=" + args.origin, text).encode()
    if updated_env == old_env and updated_caddy == old_caddy:
        print("LAN application configuration is current.")
        return
    backup = Path("/etc/idcard/lan-backups") / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True, mode=0o700)
    backup.parent.chmod(0o700)
    write(backup / "idcard.env", old_env, 0o600)
    write(backup / "app.caddy", old_caddy, 0o600)
    caddy_mode = caddy.stat().st_mode & 0o777
    try:
        write(caddy, updated_caddy, caddy_mode)
        run("caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
        write(env, updated_env, 0o600)
        run("systemctl", "restart", "idcard-web", "idcard-worker")
        run("systemctl", "reload", "caddy")
        for _ in range(30):
            try:
                with urllib.request.urlopen("http://127.0.0.1:3000/api/health/ready", timeout=2) as response:
                    if response.status == 200:
                        write(marker, (args.origin + "\n").encode(), 0o600)
                        print("LAN application origin configured; localhost redirects to the LAN address.")
                        return
            except OSError:
                pass
            time.sleep(1)
        raise RuntimeError("Services did not become ready.")
    except Exception:
        write(env, old_env, 0o600)
        write(caddy, old_caddy, caddy_mode)
        run("systemctl", "restart", "idcard-web", "idcard-worker")
        run("systemctl", "reload", "caddy")
        raise SystemExit("LAN configuration failed; original application configuration restored.")


if __name__ == "__main__":
    main()
