"""命令行入口：``python -m eco_permit_enterprise_mcp``。"""

from __future__ import annotations

from .server import PermitMcpServer


def main() -> None:
    server = PermitMcpServer()
    try:
        server.run()
    except KeyboardInterrupt:
        server.close()


if __name__ == "__main__":
    main()
