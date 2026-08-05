# EcoPilot + Hermes 后端接入方案

## 架构总览

```
┌──────────────────────────────────────────────────────┐
│  前端 (Next.js + React)                                │
│  ├── 用户对话界面                                       │
│  ├── 合规自检/许可证/环评等功能模块                        │
│  ├── 营销团队工作台（企业画像/精准触达）                    │
│  └── 技术团队工作台（远程支持/知识库）                      │
└──────────────┬───────────────────────────────────────┘
               │ SSE / WebSocket
┌──────────────▼───────────────────────────────────────┐
│  FastAPI 网关层 (chat_api.py)                           │
│  ├── 路由分发 / 鉴权 / 限流                               │
│  ├── 文件管理 / 授权管理                                   │
│  └── 工具调用代理                                        │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Hermes AI 引擎                                        │
│  ├── 四层记忆系统                                        │
│  │   ├── 短期记忆: 当前会话上下文                          │
│  │   ├── 中期记忆: 企业信息/行业/许可证/排放口               │
│  │   ├── 长期记忆: 合规历史/整改记录/经验教训                │
│  │   └── 技能库: 成功案例/行业指南/法规解读                 │
│  ├── 自我学习闭环                                        │
│  │   ├── 每次对话后自动反思                               │
│  │   ├── 提炼经验 → 写入技能库                             │
│  │   └── 评估建议质量 → 优化后续输出                        │
│  ├── 进化系统 (GEPA)                                    │
│  │   ├── 行业指南自动精炼                                 │
│  │   ├── 法规更新自动消化                                 │
│  │   └── 合规检查清单自适应                                │
│  └── 多 Agent 协作                                       │
│      ├── 环评 Agent                                     │
│      ├── 许可证 Agent                                    │
│      ├── 税务 Agent                                      │
│      ├── 风险 Agent                                      │
│      └── 危废 Agent                                      │
└──────────────────────────────────────────────────────┘
```

## 接入步骤

### 第一阶段：记忆系统接入（1-2周）

**目标**: 实现"越用越懂企业"核心体验

1. **Hermes 部署**
   ```bash
   git clone https://github.com/NousResearch/Hermes.git
   cd Hermes
   pip install -e .
   ```

2. **修改 `chat_api.py` 的对话路由**
   ```python
   # 原来的直接调大模型 API:
   # response = await call_llm(messages, model, stream=True)
   
   # 改为通过 Hermes:
   from hermes import HermesEngine
   
   engine = HermesEngine(
       enterprise_id=enterprise_id,  # 企业标识
       memory_persistence="local",   # 本地存储
       model=os.getenv("ECOPILOT_TEXT_MODEL"),
   )
   
   async for chunk in engine.chat_stream(messages):
       yield chunk
   ```

3. **企业记忆初始化**
   首次对话时，从企业信息中提取关键数据写入中期记忆：
   ```python
   engine.update_midterm_memory({
       "industry": "水泥制造",
       "scale": "年产200万吨",
       "permit_number": "P-XXXX-2024",
       "emission_outlets": 3,
       "waste_water": "有",
       "key_pollutants": ["COD", "氨氮", "SO2", "NOx"],
   })
   ```

### 第二阶段：自我学习闭环（2-3周）

**目标**: 每次对话后自动反思优化

1. **对话后钩子**
   ```python
   async def after_chat(engine, messages, response):
       # Hermes 自动执行:
       # 1. 反思本次回答质量
       # 2. 提取有价值的经验
       # 3. 更新技能库
       await engine.self_reflect(messages, response)
   ```

2. **技能库管理**
   - 成功解决环评问题的对话 → 自动生成"环评辅助"技能
   - 多次处理排污许可证 → 优化"许可证管理"技能
   - 行业特有问题 → 生成行业专属技能

### 第三阶段：多 Agent 协作（3-4周）

**目标**: 领域专家 Agent 独立进化

1. **Agent 定义**
   ```python
   agents = {
       "eia": HermesAgent(
           name="环评专家",
           expertise="环境影响评价编制与审查",
           skills=["eia_checklist", "eia_law_match", "eia_approval_check"],
       ),
       "permit": HermesAgent(
           name="许可证专家", 
           expertise="排污许可证申报与证后管理",
           skills=["permit_apply", "permit_record", "permit_report"],
       ),
       "tax": HermesAgent(
           name="税务专家",
           expertise="环境保护税核算与申报",
           skills=["tax_calc", "tax_exemption", "tax_filing"],
       ),
       "risk": HermesAgent(
           name="风险专家",
           expertise="环境风险评估与刑事合规",
           skills=["risk_criminal", "risk_penalty", "risk_double_penalty"],
       ),
   }
   ```

2. **智能路由**
   用户提问自动路由到对应 Agent:
   ```python
   def route_to_agent(user_message: str) -> str:
       # Hermes 内置路由逻辑
       # "环评" → eia agent
       # "许可证" → permit agent  
       # "环保税" → tax agent
       # "刑事/处罚" → risk agent
       # "危废" → waste agent
       pass
   ```

### 第四阶段：营销/技术工作台（4-6周）

**目标**: 团队前端化，精准销售+技术服务

1. **企业画像系统**
   - 基于记忆数据，自动生成每家企业的合规画像
   - 标注: 排污许可证到期日、高风险项、待整改项

2. **精准触达**
   - 筛选: "许可证30天内到期 + 水泥行业"
   - 自动生成个性化触达内容
   - "张总，您的排污许可证将于X月X日到期，法典第XXX条规定..."

3. **远程技术支持**
   - 技术员通过前端工作台接入企业 EcoPilot
   - Hermes 技能库自动匹配解决方案
   - 标准化问题由 Agent 自动处理

## 数据存储

```
~/.ecopilot-home/
├── .env                    # API Key 配置
├── memory/
│   ├── short_term/          # 会话级记忆（自动清理）
│   ├── mid_term/            # 企业信息记忆（持久化）
│   ├── long_term/           # 合规经验记忆（持久化）
│   └── skill_library/       # 技能库（持续进化）
├── agents/
│   ├── eia/                 # 环评 Agent 技能
│   ├── permit/              # 许可证 Agent 技能
│   ├── tax/                 # 税务 Agent 技能
│   ├── risk/                # 风险 Agent 技能
│   └── waste/               # 危废 Agent 技能
├── enterprises/
│   └── {enterprise_id}/     # 每家企业独立记忆空间
│       ├── profile.json     # 企业基础信息
│       ├── compliance.json  # 合规状态
│       ├── history.json     # 对话历史
│       └── risks.json       # 风险评估
└── analytics/
    ├── contacts.json         # 联系表单
    ├── visits.json          # 访客统计
    └── downloads.json       # 下载统计
```

## 环境变量

```bash
# ~/.ecopilot-home/.env
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=http://localhost:20128/v1  # 或 OmniRoute
ECOPILOT_TEXT_MODEL=deepseek-v4-flash
ECOPILOT_VISION_MODEL=qwen3.6-plus
HERMES_ENABLED=true
HERMES_MEMORY_PATH=~/.ecopilot-home/memory
HERMES_SKILL_PATH=~/.ecopilot-home/skill_library
```

## 启动命令

```bash
# 一键启动（网站 + 后端 + Hermes）
cd ~/.ecopilot-home
python website_api.py &        # 网站后端 :8090
python chat_api.py &          # EcoPilot 主服务 :8002
# Hermes 集成在 chat_api.py 内部
```
