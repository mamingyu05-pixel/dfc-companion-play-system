# MaycatPlay security and operations tooling

This project now has three baseline protections:

1. GitHub Actions CI build
   - Runs TypeScript checks, builds, and package tests.
   - Uses `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to avoid the Node 20 GitHub Action deprecation path.

2. Secret scan
   - Runs Gitleaks on every pull request and push to `main`.
   - Blocks commits if a real token, password, API key, or private secret is detected.
   - Output is redacted, so detected secrets are not printed in logs.

3. Vulnerability scan
   - Runs Trivy filesystem scan on every pull request, push to `main`, weekly schedule, and manual trigger.
   - Reports high and critical dependency/config risks.
   - Current mode is report-only (`exit-code: 0`) so new work is not blocked by old baseline findings.

## Production smoke check

After every server update, run:

```bash
cd /opt/companion-play-system
bash scripts/smoke-production.sh https://maycatplay.com
```

It checks:

- `/api/health`
- `/customer/`
- `/admin/`
- `/companion/`

Any 502, closed connection, timeout, or 5xx response fails the script.

## Future tightening

After current high/critical Trivy findings are reviewed, change `.github/workflows/security.yml`:

```yaml
exit-code: "1"
```

Then high and critical security findings will block merges.
