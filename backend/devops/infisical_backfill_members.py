#!/usr/bin/env python3
"""One-off: add human members to EVERY Infisical project.

Fixes "devops@seven-gen.com can't see all secrets" — projects created
by the machine identity (before the auto-invite fix, or outside the
Pulse form flow) have zero human members and are invisible in the UI.

Run where the Infisical API is reachable (office VPN, or inside the
cluster). Reads creds from pulse/backend/.env unless overridden by env
vars. Idempotent — already-members are no-ops.

    # dry run — list projects + membership gaps, no writes
    python3 devops/infisical_backfill_members.py --check

    # apply — add the emails to every project
    python3 devops/infisical_backfill_members.py --apply

    # custom recipients (default: INFISICAL_AUTO_INVITE_EMAILS or devops@)
    python3 devops/infisical_backfill_members.py --apply --emails a@x.com,b@x.com
"""
from __future__ import annotations

import argparse
import os
import sys

import httpx


def _load_env(path: str) -> dict:
    env = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    # Process env wins over file.
    for k in ("INFISICAL_HOST_API", "INFISICAL_ADMIN_CLIENT_ID",
              "INFISICAL_ADMIN_CLIENT_SECRET", "INFISICAL_AUTO_INVITE_EMAILS"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def _login(c: httpx.Client, cid: str, csec: str) -> str:
    r = c.post("/v1/auth/universal-auth/login",
               json={"clientId": cid, "clientSecret": csec})
    r.raise_for_status()
    return r.json()["accessToken"]


def _list_projects(c: httpx.Client, h: dict) -> list[dict]:
    org_id = None
    for path in ("/v2/organizations", "/v1/organization"):
        r = c.get(path, headers=h)
        if r.status_code == 200:
            body = r.json()
            orgs = body.get("organizations") or body.get("organization") or []
            if isinstance(orgs, dict):
                orgs = [orgs]
            if orgs:
                org_id = orgs[0].get("id") or orgs[0].get("_id")
                break
    projects = []
    if org_id:
        r = c.get(f"/v2/organizations/{org_id}/workspaces", headers=h)
        if r.status_code == 200:
            projects = r.json().get("workspaces") or []
    if not projects:
        r = c.get("/v1/workspace", headers=h)
        if r.status_code == 200:
            projects = r.json().get("workspaces") or []
    return [
        {"id": w.get("id") or w.get("_id"), "slug": w.get("slug"), "name": w.get("name")}
        for w in projects
        if (w.get("id") or w.get("_id"))
    ]


def _members(c: httpx.Client, h: dict, pid: str) -> list[str]:
    r = c.get(f"/v2/workspace/{pid}/memberships", headers=h)
    if r.status_code != 200:
        return []
    out = []
    for m in (r.json().get("memberships") or []):
        user = m.get("user") or {}
        email = user.get("email")
        if email:
            out.append(email.lower())
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="list projects + gaps, no writes")
    ap.add_argument("--apply", action="store_true", help="add emails to every project")
    ap.add_argument("--emails", default=None, help="comma-separated override")
    ap.add_argument("--env", default=os.path.join(os.path.dirname(__file__), "..", ".env"))
    args = ap.parse_args()
    if not (args.check or args.apply):
        ap.error("pass --check or --apply")

    env = _load_env(os.path.abspath(args.env))
    base = env.get("INFISICAL_HOST_API")
    cid = env.get("INFISICAL_ADMIN_CLIENT_ID")
    csec = env.get("INFISICAL_ADMIN_CLIENT_SECRET")
    if not (base and cid and csec):
        print("ERROR: INFISICAL_HOST_API / CLIENT_ID / CLIENT_SECRET not found", file=sys.stderr)
        return 2

    emails = [e.strip().lower() for e in
              (args.emails or env.get("INFISICAL_AUTO_INVITE_EMAILS", "devops@seven-gen.com")).split(",")
              if e.strip()]
    if not emails:
        print("ERROR: no emails to add", file=sys.stderr)
        return 2

    c = httpx.Client(base_url=base, timeout=20)
    tok = _login(c, cid, csec)
    h = {"Authorization": f"Bearer {tok}"}
    projects = _list_projects(c, h)
    print(f"projects visible to machine identity: {len(projects)}")
    print(f"ensuring members: {', '.join(emails)}\n")

    missing_total = 0
    for p in projects:
        current = _members(c, h, p["id"])
        gap = [e for e in emails if e not in current]
        tag = "OK" if not gap else f"MISSING {','.join(gap)}"
        print(f"  [{tag}] {p.get('slug') or p['id']}  ({p.get('name')})")
        if gap:
            missing_total += 1
            if args.apply:
                r = c.post(f"/v2/workspace/{p['id']}/memberships",
                           headers=h, json={"emails": gap})
                if r.status_code >= 400 and r.status_code not in (400, 409):
                    print(f"      -> add FAILED HTTP {r.status_code}: {r.text[:200]}")
                else:
                    print(f"      -> added")

    print(f"\nprojects with gaps: {missing_total} / {len(projects)}")
    if args.check and missing_total:
        print("run again with --apply to add the missing members")
    return 0


if __name__ == "__main__":
    sys.exit(main())
