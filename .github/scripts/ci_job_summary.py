#!/usr/bin/env python3
"""
Assemble GitHub Actions job summary: unified Test Results table + Coverage section.
Reads pytest text output, Playwright JSON report, ShellSpec text output.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


def _read_text(path: Path) -> str | None:
    if not path.is_file():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


def parse_pytest_banner(text: str | None) -> tuple[str, str]:
    """Return (count-ish label, result phrase) for the summary table."""
    if not text:
        return ("—", "not run")
    lines = [ln.strip() for ln in text.splitlines() if re.match(r"^=+ .* (passed|failed|error|errors) in ", ln)]
    if not lines:
        return ("—", "no summary line")
    line = lines[-1]
    # e.g. ======= 34 passed in 1.69s ========  or  2 passed, 1 failed in 1s
    inner = re.sub(r"^=+\s*", "", line)
    inner = re.sub(r"\s*=+$", "", inner).strip()
    # Count: prefer total tests from passed+failed+error patterns
    passed = sum(int(m) for m in re.findall(r"(\d+)\s+passed", inner))
    failed = sum(int(m) for m in re.findall(r"(\d+)\s+failed", inner))
    errors = sum(int(m) for m in re.findall(r"(\d+)\s+errors?", inner))
    total = passed + failed + errors
    if total:
        count_col = str(total)
    else:
        count_col = "—"
    result_col = inner if len(inner) < 80 else inner[:77] + "..."
    return (count_col, result_col)


def parse_playwright_list_output(text: str | None) -> tuple[str, str] | None:
    if not text:
        return None
    for ln in reversed(text.splitlines()):
        if re.search(r"\d+\s+passed", ln):
            tail = ln.strip()
            passed = sum(int(m) for m in re.findall(r"(\d+)\s+passed", tail))
            failed = sum(int(m) for m in re.findall(r"(\d+)\s+failed", tail))
            total = passed + failed if (passed or failed) else None
            if total is None:
                m = re.search(r"(\d+)\s+passed", tail)
                if m:
                    total = int(m.group(1))
                    return (str(total), f"{total} passed")
                continue
            if failed:
                return (str(total), f"{passed} passed, {failed} failed")
            return (str(total), f"{passed} passed")
    return None


def parse_playwright_json(path: Path, list_fallback: str | None) -> tuple[str, str]:
    raw = _read_text(path)
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        else:
            stats = data.get("stats") or {}
            if stats:
                exp = int(stats.get("expected") or 0)
                unexp = int(stats.get("unexpected") or 0)
                skip = int(stats.get("skipped") or 0)
                flaky = int(stats.get("flaky") or 0)
                total = exp + unexp + skip + flaky
                if unexp:
                    result = f"{exp} passed, {unexp} failed"
                elif flaky:
                    result = f"{exp} passed, {flaky} flaky"
                elif skip:
                    result = f"{exp} passed, {skip} skipped"
                else:
                    result = f"{exp} passed"
                return (str(total), result)
    fb = parse_playwright_list_output(list_fallback)
    if fb:
        return fb
    if not raw:
        return ("—", "not run")
    return ("—", "no stats in JSON")


def parse_shellspec(text: str | None) -> tuple[str, str]:
    if not text:
        return ("—", "not run")
    for ln in text.splitlines():
        m = re.match(r"^(\d+)\s+examples?,\s+(\d+)\s+failures?", ln.strip())
        if m:
            ex, fail = int(m.group(1)), int(m.group(2))
            total = ex  # examples count
            if fail:
                return (str(total), f"{ex - fail} passed, {fail} failed")
            return (str(total), f"{ex} passed")
    return ("—", "no summary line")


def coverage_section(pytest_text: str | None) -> list[str]:
    lines: list[str] = []
    if not pytest_text:
        return ["## Coverage", "", "_No pytest output._", ""]
    pdf_cov = None
    rows: list[tuple[str, str, str, str]] = []
    for ln in pytest_text.splitlines():
        if not ln.startswith("python/"):
            continue
        parts = ln.split()
        if len(parts) < 4:
            continue
        mod, stmts, miss, cov = parts[0], parts[1], parts[2], parts[3]
        if not stmts.isdigit() or not miss.isdigit() or not re.match(r"^\d+%$", cov):
            continue
        sub = mod[7:] if mod.startswith("python/") else mod
        rows.append((sub, stmts, miss, cov))
        if sub == "pdf_server.py":
            pdf_cov = cov
    lines.append("## Coverage")
    lines.append("")
    if pdf_cov:
        lines.append(f"**`pdf_server.py`:** {pdf_cov} statement coverage (see table below).")
    else:
        lines.append("_Could not read `pdf_server.py` coverage from pytest output._")
    lines.append("")
    lines.append("Per-line *Missing* lists stay in the job log only (pytest `term-missing`).")
    lines.append("")
    if rows:
        lines.append("| Module | Stmts | Miss | Cover |")
        lines.append("|--------|------:|-----:|------:|")
        for sub, stmts, miss, cov in rows:
            lines.append(f"| `{sub}` | {stmts} | {miss} | **{cov}** |")
    else:
        lines.append("_No coverage table rows parsed._")
    lines.append("")
    return lines


def main() -> int:
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    pytest_path = Path(os.environ.get("PYTEST_OUTPUT", "/tmp/pytest-output.txt"))
    pw_json = Path(os.environ.get("PLAYWRIGHT_JSON", "tests/ui/playwright-results.json"))
    pw_list_path = Path(os.environ.get("PLAYWRIGHT_LIST_PATH", "/tmp/ui-output.txt"))
    pw_list_text = _read_text(pw_list_path)
    shell_path = Path(os.environ.get("SHELLSPEC_OUTPUT", "/tmp/shellspec-output.txt"))

    pytest_text = _read_text(pytest_path)
    py_count, py_result = parse_pytest_banner(pytest_text)
    pw_count, pw_result = parse_playwright_json(pw_json, pw_list_text)
    sh_count, sh_result = parse_shellspec(_read_text(shell_path))

    block: list[str] = [
        "## Test Results",
        "",
        "| Suite | Tests | Result |",
        "|-------|-------|--------|",
        f"| Python unit | {py_count} | {py_result} |",
        f"| Playwright UI | {pw_count} | {pw_result} |",
        f"| ShellSpec | {sh_count} | {sh_result} |",
        "",
    ]
    block.extend(coverage_section(pytest_text))

    text = "\n".join(block) + "\n"
    if not summary:
        sys.stdout.write(text)
        return 0
    with open(summary, "a", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
