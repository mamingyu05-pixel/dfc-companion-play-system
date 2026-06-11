from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "agent_pipeline" / "agents.json"
REPORT_DIR = ROOT / "agent_pipeline" / "reports"


KEY_FILES = {
    "project_manager": ["docs/PROJECT_PLAN.md", "docs/CHANGELOG.md", "docs/KNOWN_ISSUES.md"],
    "database": ["packages/database/prisma/schema.prisma", "scripts/init-admin.ts"],
    "customer": ["apps/customer-web/app/page.tsx", "apps/customer-web/app/order/page.tsx", "apps/customer-web/app/recharge/page.tsx"],
    "companion": ["apps/companion-web/app/page.tsx", "apps/companion-web/app/earnings/page.tsx", "apps/companion-web/app/withdrawals/page.tsx"],
    "admin": ["apps/admin-web/app/page.tsx", "apps/admin-web/app/dispatch/page.tsx", "apps/admin-web/app/recharges/page.tsx"],
    "order": ["apps/api-server/src/modules/orders/orders.service.ts", "docs/ORDER_FLOW.md"],
    "wallet": ["apps/api-server/src/modules/wallet/wallet.controller.ts", "docs/WALLET_FLOW.md"],
    "discord": ["apps/discord-bot/src/index.ts", "apps/api-server/src/modules/discord/discord-webhook.controller.ts"],
    "kook": ["apps/kook-adapter/src/index.ts", "apps/api-server/src/modules/kook/kook-webhook.controller.ts"],
    "ui_ux_design": ["docs/UI_STYLE_GUIDE.md", "docs/UI_COMPONENTS.md", "packages/ui/tailwind-preset.ts"],
    "devops": ["docker-compose.yml", "scripts/deploy.sh", "scripts/enable-https.sh", "scripts/backup-postgres.sh"],
    "qa": ["docs/TEST_CHECKLIST.md", "docs/TEST_REPORT.md"]
}


PATTERNS = {
    "database": ["model User", "model Order", "model Wallet", "model UserExternalAccount", "enum OrderStatus"],
    "order": ["updateMany", "OrderStatus.ASSIGNED", "OrderStatus.ACCEPTED", "voiceTrialRequested"],
    "wallet": ["recharge", "withdrawal", "wallet"],
    "discord": ["x-bot-token", "order.accept"],
    "kook": ["KOOK_VERIFY_TOKEN", "challenge", "createVoiceRoom"],
    "ui_ux_design": ["dfcTailwindPreset", "bg-dfc", "UI 风格指南"],
    "devops": ["docker compose", "letsencrypt", "backup"],
    "qa": ["双平台重复接单", "wallet_transactions", "order_status_logs"]
}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(errors="ignore")


def file_status(paths: list[str]) -> list[tuple[str, bool]]:
    return [(path, (ROOT / path).exists()) for path in paths]


def pattern_status(agent_id: str, paths: list[str]) -> list[tuple[str, bool]]:
    haystack = "\n".join(read_text(ROOT / path) for path in paths if (ROOT / path).exists())
    return [(pattern, pattern in haystack) for pattern in PATTERNS.get(agent_id, [])]


def render_agent(agent: dict) -> str:
    agent_id = agent["id"]
    paths = KEY_FILES.get(agent_id, list(agent.get("scope", [])))
    files = file_status(paths)
    patterns = pattern_status(agent_id, paths)
    missing_files = [path for path, exists in files if not exists]
    missing_patterns = [pattern for pattern, exists in patterns if not exists]
    status = "PASS" if not missing_files and not missing_patterns else "NEEDS_REVIEW"

    lines = [
        f"## {agent['name']}",
        "",
        f"- Status: {status}",
        f"- Responsibilities: {', '.join(agent['responsibilities'])}",
        f"- Required outputs: {', '.join(agent['required_outputs'])}",
        "",
        "### File checks"
    ]

    for path, exists in files:
        marker = "OK" if exists else "MISSING"
        lines.append(f"- [{marker}] {path}")

    if patterns:
        lines.extend(["", "### Pattern checks"])
        for pattern, exists in patterns:
            marker = "OK" if exists else "MISSING"
            lines.append(f"- [{marker}] {pattern}")

    if missing_files or missing_patterns:
        lines.extend(["", "### Required follow-up"])
        for path in missing_files:
            lines.append(f"- Add or verify required file: {path}")
        for pattern in missing_patterns:
            lines.append(f"- Verify implementation evidence for: {pattern}")

    return "\n".join(lines)


def main() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sections = [
        "# DFC Multi-Agent Audit Report",
        "",
        f"Generated at: {timestamp}",
        "",
        f"Mode: {config['mode']}",
        "",
        f"Rule: {config['rule']}",
        ""
    ]

    for agent in config["agents"]:
        sections.append(render_agent(agent))
        sections.append("")

    report = "\n".join(sections)
    report_path = REPORT_DIR / "latest.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"Wrote {report_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
