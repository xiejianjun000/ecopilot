# EcoPilot 数据库迁移方案

## 现状

当前所有数据以 JSON 文件存储在 `~/.ecopilot-home/`：

```
enterprise.json   — 企业信息
permit-data.json  — 许可证数据
user.json         — 用户信息
vault/            — 档案库 manifest + 文件
memory/           — 合规记忆
knowledge/        — 知识库
```

**问题**: 无事务安全、无并发控制、容量限制、备份困难。

## 推荐方案: SQLite

| 考量 | SQLite | PostgreSQL |
|------|--------|------------|
| 部署复杂度 | 零依赖 | 需要独立服务 |
| 桌面应用适配 | 完美 | 过重 |
| 事务支持 | ✅ | ✅ |
| 并发能力 | WAL 模式足够单用户 | 企业级 |
| 迁移成本 | 低 | 高 |
| 备份 | 单文件 cp | pg_dump |

**结论**: 桌面应用选 SQLite（WAL 模式），未来多企业 SaaS 版迁移 PostgreSQL。

## 数据表设计

```sql
-- 企业信息
CREATE TABLE enterprises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credit_code TEXT,
  permit_number TEXT,
  industry TEXT,
  address TEXT,
  data JSON,          -- 完整 JSON 兜底
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 许可证数据
CREATE TABLE permit_data (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT REFERENCES enterprises(id),
  parsed JSON NOT NULL,
  saved_at REAL NOT NULL,
  execution JSON,
  modules JSON,
  ai_analysis JSON
);

-- 用户
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '环保专员',
  phone TEXT,
  data JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 合规记忆
CREATE TABLE compliance_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  risk_level TEXT DEFAULT 'info',
  source_session TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 工作日志
CREATE TABLE work_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title TEXT,
  content TEXT,
  entries_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 会话记录
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT,
  messages JSON,
  summary TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 运维事件
CREATE TABLE ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  user_id TEXT,
  enterprise TEXT,
  data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 迁移策略

### Phase 1: 双写（1天）
- 保持 JSON 文件读写不变
- 新增 SQLite 写入（仅写，不读）
- 验证数据完整性

### Phase 2: 切换读（2天）
- 从 SQLite 读取，JSON 文件作为降级备份
- 向后兼容：缺失表时自动创建
- 全量测试 182+ tests 通过

### Phase 3: 清理（1天）
- 移除 JSON 文件读写代码
- 保留 `core/config.py` 中的 `HERMES_HOME` 路径常量
- 文档更新

## 迁移文件

```
desktop/server/db/
  __init__.py
  connection.py    — get_db() 单例，WAL 模式
  schema.sql       — 建表语句
  migrations/      — 版本化迁移
    001_init.sql
```

## 回滚方案

SQLite 文件路径与 JSON 文件同目录：
- 迁移前备份: `cp ~/.ecopilot-home/vault/manifest.json ~/.ecopilot-home/vault/manifest.json.bak`
- 回滚: 删除 `.db` 文件，代码回退到 Phase 1 前版本
- JSON 文件在 Phase 3 之前始终保留
