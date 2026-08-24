# EcoPilot 注册回调链路时序图

## 1. 当前状态（断裂的链路）

```mermaid
sequenceDiagram
    autonumber
    actor 用户
    participant Auth as auth_service<br/>:8091
    participant Sub as subscription_service<br/>:8092
    participant Pool as api_pool<br/>:8095
    participant DB as Data Files

    用户->>Auth: POST /api/auth/register<br/>{company,name,phone,email,password}
    activate Auth

    Auth->>Auth: 邮箱/手机唯一性校验
    Auth->>Auth: bcrypt 密码哈希 (rounds=12)

    Auth->>DB: 写入 users.json<br/>{uid,plan:"free",...}
    DB-->>Auth: OK

    Note over Auth,Pool: 🔴 链路断裂 — 不调用任何下游服务

    Auth-->>用户: 201 {success, message:"注册成功", user}

    Note over Sub: subscription_service 完全不知情
    Note over Pool: api_pool 完全不知情

    deactivate Auth
```

## 2. 目标状态（闭合的回调链路）

```mermaid
sequenceDiagram
    autonumber
    actor 用户
    participant Auth as auth_service<br/>:8091
    participant Sub as subscription_service<br/>:8092
    participant Pool as api_pool<br/>:8095
    participant DB as Data Files

    用户->>Auth: POST /api/auth/register<br/>{company,name,phone,email,password}
    activate Auth

    Auth->>Auth: 邮箱/手机唯一性校验
    Auth->>Auth: bcrypt 密码哈希 (rounds=12)

    Auth->>DB: 写入 users.json<br/>{uid,plan:"free",...}
    DB-->>Auth: OK

    par 注册后并行回调
        Auth->>Sub: POST /api/subscription/create-free<br/>x-internal-key: ***<br/>{user_id,email,plan:"free"}
        activate Sub
        Sub->>DB: 写入 subscriptions.json<br/>{sub_id,user_id,plan:"free",status:"active"}
        DB-->>Sub: OK
        Sub-->>Auth: 200 {subscription_id,plan,stats}
        deactivate Sub
    and
        Auth->>Pool: POST /api/pool/license/issue<br/>x-internal-key: ***<br/>{user_id,tier:"free",expire_days:3650}
        activate Pool
        Pool->>DB: 签发许可证<br/>{license_key,fingerprint:null,tier:"free"}
        DB-->>Pool: OK
        Pool-->>Auth: 200 {license_key,expires_at}
        deactivate Pool
    end

    Auth-->>用户: 201 {success, user, subscription_id, license_key}

    deactivate Auth
```

## 3. 共享邮箱生成（可选增强）

```mermaid
sequenceDiagram
    autonumber
    actor 用户
    participant Auth as auth_service<br/>:8091

    用户->>Auth: POST /api/auth/register<br/>{company,name,phone,email,password}
    activate Auth

    Auth->>Auth: 生成 EcoPilot 邮箱<br/>格式: {拼音缩写}.{用户名}@ecopilot.ai<br/>例: cshb.zhangsan@ecopilot.ai

    Note over Auth: 该邮箱用于:<br/>1. 人类登录 EcoPilot<br/>2. AI 代操作合规事务<br/>3. 邮件通知收件地址

    Auth->>Auth: 存入 user.ecopilot_email 字段

    deactivate Auth
```

## 关键设计决策

| 项目 | 决策 |
|------|------|
| 回调方式 | HTTP POST + `x-internal-key` 鉴权 |
| 失败处理 | 写日志但不阻塞注册（最终一致性） |
| 重试机制 | 异步重试队列（后续迭代） |
| 共享邮箱 | `{拼音缩写}.{用户名}@ecopilot.ai`，注册后自动生成 |
| 回调顺序 | subscription → license（可并行） |
