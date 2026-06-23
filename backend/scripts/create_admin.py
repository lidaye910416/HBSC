"""生成 bcrypt 密码哈希，用于配置 ADMIN_PASSWORD_HASH。

Usage:
    python -m scripts.create_admin <username> <password>
    # 或交互式：
    python -m scripts.create_admin
"""
import sys
from getpass import getpass

from app.security import hash_password, verify_password


def main():
    if len(sys.argv) >= 3:
        username, password = sys.argv[1], sys.argv[2]
    else:
        username = input("管理员用户名 (默认 admin): ").strip() or "admin"
        password = getpass("管理员密码: ")
        if not password:
            print("错误：密码不能为空", file=sys.stderr)
            sys.exit(1)
        password2 = getpass("再次输入: ")
        if password != password2:
            print("错误：两次输入不一致", file=sys.stderr)
            sys.exit(1)

    if not password:
        print("错误：密码不能为空", file=sys.stderr)
        sys.exit(1)

    hashed = hash_password(password)
    # 自检：避免 bcrypt 边界（空串、>72 字节等）产生"看着合法但登不进去"的 hash
    assert verify_password(password, hashed), "bcrypt 自检失败，请重试"
    print()
    print("=" * 60)
    print("将以下两行写入 backend/.env（或部署环境变量）：")
    print("=" * 60)
    print(f"ADMIN_USERNAME={username}")
    print(f"ADMIN_PASSWORD_HASH={hashed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
