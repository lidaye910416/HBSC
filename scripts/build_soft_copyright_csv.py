#!/usr/bin/env python3
"""合并 hubei-shuchuang 项目所有源代码到 CSV 文件，用于软著申报。"""

import csv
import os
from pathlib import Path

# 项目根目录
ROOT = Path("/Users/jasonlee/hubei-shuchuang")
OUT_CSV = ROOT / "soft-copyright" / "hubei-shuchuang-source-code.csv"

# 要包含的源代码文件扩展名
CODE_EXTS = {".py", ".ts", ".tsx", ".css"}

# 排除目录（内部 agent 状态、构建产物、依赖目录）
EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    ".claude",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    "test-results",
    ".dev-logs",
    ".dev-pids",
    ".superpowers",
    ".worktrees",
    "uploads",
    "design-mockups",
    "tests",
}

# 排除文件
EXCLUDE_FILES = {
    # 已合并，无须单独列
}


def should_skip(path: Path) -> bool:
    """判断路径是否应该跳过。"""
    parts = set(path.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix.lower() not in CODE_EXTS:
        return True
    return False


def collect_files(root: Path) -> list[Path]:
    """收集所有源代码文件。"""
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # 就地裁剪目录，跳过 EXCLUDE_DIRS
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            p = Path(dirpath) / fn
            if not should_skip(p):
                files.append(p)
    return sorted(files)


def to_rel(p: Path) -> str:
    return str(p.relative_to(ROOT))


def main() -> None:
    files = collect_files(ROOT)
    print(f"共收集到 {len(files)} 个源代码文件")

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    # CSV 头：文件相对路径、行号、代码
    rows_total = 0
    with OUT_CSV.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["文件路径", "行号", "源代码"])
        for fp in files:
            rel = to_rel(fp)
            try:
                text = fp.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                print(f"读取失败 {rel}: {e}")
                continue
            lines = text.splitlines()
            for idx, line in enumerate(lines, start=1):
                # 处理 CSV 中需要转义的字符
                writer.writerow([rel, idx, line])
                rows_total += 1
            print(f"  {rel}: {len(lines)} 行")

    print(f"\n✅ 已写入 {rows_total} 行到 {OUT_CSV}")
    print(f"   文件大小: {OUT_CSV.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()