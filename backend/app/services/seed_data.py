from datetime import datetime, timedelta
import random

def seed_domains():
    return [
        {"name": "复杂性科学", "slug": "complexity-science",
         "description": "探索非线性动力学、混沌理论与网络科学，揭示复杂系统中的涌现行为与自组织规律。",
         "icon": "Atom", "color": "#C9A84C", "order": 1, "article_count": 24},
        {"name": "系统科学", "slug": "systems-science",
         "description": "融合系统论、控制论与系统动力学，研究整体与局部、系统与环境的交互机制。",
         "icon": "GitBranch", "color": "#4A7C59", "order": 2, "article_count": 18},
        {"name": "计算社会科学", "slug": "computational-social-science",
         "description": "运用计算方法与社会模拟技术，基于大数据解析人类社会行为的深层规律。",
         "icon": "Users", "color": "#8B4513", "order": 3, "article_count": 15},
        {"name": "认知与决策", "slug": "cognition-decision",
         "description": "深入研究判断与决策的心理机制，结合行为经济学洞悉人类理性与非理性的边界。",
         "icon": "Brain", "color": "#2D6A8F", "order": 4, "article_count": 21},
        {"name": "人工智能与复杂性", "slug": "ai-complexity",
         "description": "探索大模型与AI系统中的涌现现象，推进可解释人工智能的研究与实践。",
         "icon": "Cpu", "color": "#6B4C8A", "order": 5, "article_count": 19},
        {"name": "生态与可持续性", "slug": "ecology-sustainability",
         "description": "以复杂适应系统与韧性理论为核心，应对气候变化与可持续发展的全球挑战。",
         "icon": "Leaf", "color": "#4A7C59", "order": 6, "article_count": 12},
    ]

def seed_articles():
    base_date = datetime.utcnow() - timedelta(days=30)
    articles = [
        {
            "title": "复杂网络视角下的社会传播机制研究",
            "slug": "complex-networks-social-propagation",
            "summary": "本文基于复杂网络理论，构建了信息在社会网络中的多层级传播模型。研究发现，网络的异质性结构显著影响传播效率，而意见领袖的介入可将传播速度提升3倍以上。",
            "content": "## 引言\n\n社会传播是信息时代最核心的现象之一。本文从复杂网络的视角出发，系统研究信息在社会网络中的传播机制。\n\n## 研究方法\n\n我们构建了一个包含10万节点的社会网络模型，节点代表真实用户，边代表社交关系。通过分析传播动力学，我们发现：\n\n1. **网络异质性** - 度分布的异质性显著影响传播临界值\n2. **社区结构** - 社区内部传播速度远高于跨社区传播\n3. **意见领袖** - 高介数中心性的节点对传播具有杠杆作用\n\n## 结论\n\n本研究揭示了社会传播的深层网络机制，为信息分发策略提供了理论依据。",
            "cover_image": "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80",
            "category": "复杂性科学", "author_name": "李明远", "author_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
            "reading_time": 8, "featured": True, "tags": "复杂网络,社会传播,信息扩散",
            "published_at": base_date - timedelta(days=2), "views": 3420
        },
        {
            "title": "从熵增到熵减：开放系统中的自组织现象",
            "slug": "entropy-decrease-self-organization",
            "summary": "热力学第二定律告诉我们宇宙趋向熵增，但生命系统却展现出惊人的有序化能力。本文探讨开放系统如何在远离平衡态时自发产生有序结构。",
            "content": "## 摘要\n\n熵增是自然界的普遍规律，但生命系统展现出截然不同的特征——它们不断创造并维持有序结构。\n\n## 远离平衡态的热力学\n\nPrigogine的耗散结构理论指出：\n- **开放系统** - 通过与外界交换能量和物质\n- **非线性相互作用** - 系统内部存在正负反馈回路\n- **远离平衡态** - 系统可能自发出现有序结构\n\n## 生命系统的自组织\n\n生命是宇宙中自组织的最高形式。从细胞代谢到生态系统，每一个生命体都在持续进行着降熵操作——通过消耗自由能，在局部创造并维持有序。\n\n## 启示\n\n这一视角重新定义了秩序：秩序不是静态的，而是在流动中维持的动态平衡。",
            "cover_image": "https://images.unsplash.com/photo-1518152006812-edab29b069ac?w=800&q=80",
            "category": "复杂性科学", "author_name": "王雨桐", "author_avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80",
            "reading_time": 12, "featured": True, "tags": "熵,自组织,耗散结构,热力学",
            "published_at": base_date - timedelta(days=5), "views": 2890
        },
        {
            "title": "城市作为复杂适应系统：规划与涌现的张力",
            "slug": "city-complex-adaptive-system",
            "summary": "城市不是被设计的机器，而是无数个体行动者交互产生的复杂适应系统。本文运用CAS框架分析城市演化规律，探讨规划干预的边界与可能性。",
            "content": "## 城市：从机械论到复杂性思维\n\n传统城市理论将城市视为可被规划和控制的机器。但复杂性科学提供了全新的视角：城市是一个典型的复杂适应系统(CAS)。\n\n## CAS特征与城市\n\n- **多主体交互** - 居民、企业、政府等主体持续交互\n- **自下而上涌现** - 城市形态从局部交互中自发产生\n- **路径依赖** - 历史偶然塑造当前结构\n- **适应性** - 城市持续学习与演化\n\n## 规划的新范式\n\n复杂性思维启示我们：\n1. **拥抱不确定性** - 规划不是控制，而是引导\n2. **局部规则** - 简单规则的组合产生复杂行为\n3. **韧性优先** - 建设应对冲击的系统韧性\n4. **渐进改良** - 小步迭代优于宏大蓝图",
            "cover_image": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=80",
            "category": "系统科学", "author_name": "张博涵", "author_avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80",
            "reading_time": 10, "featured": True, "tags": "城市科学,复杂适应系统,城市规划,涌现",
            "published_at": base_date - timedelta(days=8), "views": 2150
        },
        {
            "title": "群体决策中的噪声与偏差：一项计算社会科学研究",
            "slug": "collective-decision-noise-bias",
            "summary": "个体决策受限于有限理性，群体决策能否克服这一局限？本研究基于大规模模拟与真实数据集，揭示群体规模与决策质量之间的非线性关系。",
            "content": "## 研究背景\n\n从董事会会议室到民主投票站，群体决策无处不在。但群体决策是否真的优于个体判断？\n\n## 核心发现\n\n### 噪声的缩放\n\n我们的模拟显示，噪声的缩放效应取决于：\n- **独立性** - 决策者越独立，噪声缩放越有效\n- **能力分布** - 异质性群体在复杂问题上表现更佳\n\n### 偏差的聚合\n\n与噪声不同，偏差倾向于累加而非抵消：\n- 系统性偏差（如锚定效应）在群体中会被放大\n- 需要引入对抗性思考来中和偏差\n\n## 实践建议\n\n1. 在需要利用智慧人群时，确保决策者独立性\n2. 在面对系统性风险时，引入多元视角\n3. 结构化讨论流程，减少群体极化",
            "cover_image": "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&q=80",
            "category": "认知与决策", "author_name": "陈思远", "author_avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80",
            "reading_time": 9, "featured": False, "tags": "群体决策,行为经济学,计算社会科学",
            "published_at": base_date - timedelta(days=12), "views": 1870
        },
        {
            "title": "大语言模型中的涌现能力：复杂性科学的启示",
            "slug": "llm-emergent-capabilities-complexity",
            "summary": "当语言模型的参数规模突破临界点时，全新的能力会突然涌现——这一现象与复杂性科学中的相变理论高度吻合。本文探讨LLM涌现能力背后的机制。",
            "content": "## 引言\n\nGPT-4、Claude等大语言模型展现出了令人惊讶的能力：推理、代码生成、多语言理解。这些能力并非被明确编程，而是在规模扩展中自发涌现。\n\n## 涌现的物理学\n\n涌现(Emergence)是复杂性科学的核心概念：\n- 大量简单组件交互\n- 产生全新、不可预测的系统级特性\n- 无法通过还原论理解\n\n## LLM中的涌现现象\n\n研究表明，模型在特定规模点会出现能力的变化：\n- 链式推理能力在约100B参数时涌现\n- 上下文学习能力呈现非线性增长\n- 某些能力似乎有临界点，不到达则完全不可用\n\n## 对AI研究的启示\n\n1. 规模仍是解锁能力的关键杠杆\n2. 需要新的理论框架理解涌现\n3. 可解释AI是理解涌现的必由之路",
            "cover_image": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80",
            "category": "人工智能与复杂性", "author_name": "刘子轩", "author_avatar": "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&q=80",
            "reading_time": 11, "featured": False, "tags": "大语言模型,涌现,AI,复杂性科学",
            "published_at": base_date - timedelta(days=15), "views": 4520
        },
        {
            "title": "气候系统的临界点与韧性治理",
            "slug": "climate-tipping-points-resilience",
            "summary": "气候系统存在多个潜在的临界元素，当越过阈值后将触发不可逆变化。本文提出基于韧性理论的气候治理框架，强调适应与减缓并重。",
            "content": "## 气候临界点\n\n地球气候系统包含多个潜在的气候临界点：\n- **格陵兰冰盖融化** - 海平面上升7米的威胁\n- **亚马逊雨林退化** - 从碳汇变为碳源\n- **大西洋经向翻转** - 洋流系统崩溃\n\n## 韧性视角\n\n传统气候治理聚焦于减缓(Mitigation)。但韧性视角同样重要：\n\n1. **吸收冲击** - 建设能够应对极端事件的社会系统\n2. **适应变化** - 调整基础设施与生产方式\n3. **转型能力** - 在必要时进行系统性变革\n\n## 复杂性科学的贡献\n\n复杂性思维为气候治理提供新框架：\n- 多维度评估临界风险\n- 适应性治理而非最优控制\n- 多元利益相关者协作",
            "cover_image": "https://images.unsplash.com/photo-1569163139599-0f4517e36f51?w=800&q=80",
            "category": "生态与可持续性", "author_name": "赵晓晨", "author_avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80",
            "reading_time": 13, "featured": False, "tags": "气候变化,临界点,韧性,可持续性",
            "published_at": base_date - timedelta(days=18), "views": 1680
        },
        {
            "title": "社会网络的结构性与动态性：双视角整合框架",
            "slug": "social-network-structure-dynamics",
            "summary": "传统社会网络分析或重结构或重动态，难窥全貌。本文提出结构-动态整合框架，通过多层网络的视角理解社会系统的组织原理。",
            "content": "## 研究问题\n\n社会网络研究者面临一个根本张力：\n- **结构性视角** - 关注网络拓扑的静态特征\n- **动态性视角** - 关注网络随时间的演化\n\n## 整合框架\n\n本文提出的多层网络框架：\n- 实体层：行动者之间的实际关系\n- 知识层：观念和信息的流动网络\n- 动态层：关系与观念的协同演化\n\n## 实证应用\n\n基于微博平台的实证研究显示：\n- 结构性核心节点与动态性核心节点的重叠率仅约60%\n- 突发事件中，动态性核心更替频繁\n- 社区结构呈现显著的跨层一致性",
            "cover_image": "https://images.unsplash.com/photo-1551808525-51a94da548ce?w=800&q=80",
            "category": "计算社会科学", "author_name": "李明远", "author_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
            "reading_time": 10, "featured": False, "tags": "社会网络,多层网络,计算社会科学",
            "published_at": base_date - timedelta(days=20), "views": 1340
        },
        {
            "title": "超越还原论：复杂系统研究的认识论革命",
            "slug": "beyond-reductionism-complex-systems",
            "summary": "现代科学的崛起建立在还原论之上。但复杂系统的研究正在催生一场认识论革命，重新定义我们理解世界的方式。",
            "content": "## 还原论的成就与局限\n\n现代科学的核心方法论是还原论：\n- 成功案例：粒子物理学、分子生物学\n- 局限领域：生命系统、社会系统、生态系统\n\n## 复杂系统的新范式\n\n复杂性科学提供了另一种理解方式：\n- **整体论** - 整体大于部分之和\n- **涌现论** - 新属性从交互中自发产生\n- **关系论** - 实体由关系定义\n\n## 跨学科融合\n\n复杂系统研究正在整合：\n- 物理学：统计力学\n- 生物学：进化论、生态学\n- 数学：非线性动力学、网络科学\n- 计算机科学：模拟与计算\n\n## 认识论启示\n\n复杂系统研究不仅是方法论革新，更是认识论革命——我们正在学习用新的方式看待世界。",
            "cover_image": "https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?w=800&q=80",
            "category": "复杂性科学", "author_name": "王雨桐", "author_avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80",
            "reading_time": 14, "featured": False, "tags": "认识论,还原论,复杂性科学,哲学",
            "published_at": base_date - timedelta(days=25), "views": 2980
        },
        {
            "title": "复杂系统中的反馈回路：从负反馈到螺旋上升",
            "slug": "feedback-loops-complex-systems",
            "summary": "反馈回路是复杂系统行为的核心驱动力。本文系统梳理正反馈与负反馈的机制，揭示它们如何塑造系统的稳定与变化。",
            "content": "## 反馈的基础\n\n**负反馈** - 抵消偏差，维持稳定：\n- 恒温器：偏离目标温度时加热或制冷\n- 生态系统：捕食者-猎物动态平衡\n\n**正反馈** - 放大偏差，推动变化：\n- 复利效应：财富的指数增长\n- 网络效应：用户越多产品越有价值\n\n## 混合回路\n\n真实系统通常包含多种反馈的组合：\n- 气候系统：温室效应（正反馈）与辐射平衡（负反馈）\n- 经济系统：信贷周期与市场调节\n\n## 系统行为预测\n\n理解反馈结构是系统思考的核心能力：\n1. 识别主要的反馈回路\n2. 区分增强与平衡回路\n3. 寻找杠杆点——最小干预产生最大效果",
            "cover_image": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80",
            "category": "系统科学", "author_name": "张博涵", "author_avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80",
            "reading_time": 9, "featured": False, "tags": "反馈回路,系统动力学,控制论",
            "published_at": base_date - timedelta(days=28), "views": 1890
        },
    ]
    return articles

def seed_insights():
    base_date = datetime.utcnow()
    return [
        {"title": "MIT研究表明：大语言模型展现出跨学科的涌现推理能力",
         "content": "麻省理工学院最新研究显示，当模型参数超过特定规模时，会自发涌现出跨学科的推理能力，这种能力无法通过线性缩放预测。",
         "category": "学术", "source": "MIT Technology Review", "source_url": "https://technologyreview.com",
         "author_name": "研究团队", "published_at": base_date - timedelta(hours=2)},
        {"title": "诺贝尔经济学奖聚焦气候风险与复杂系统",
         "content": "本届诺贝尔经济学奖授予了在气候经济与复杂系统建模方面做出开创性贡献的研究者，标志着复杂性思维正式进入主流经济学。",
         "category": "政策", "source": "Nature Economics", "source_url": "https://nature.com",
         "author_name": "编辑部", "published_at": base_date - timedelta(hours=8)},
        {"title": "全球韧性网络(GRI)发布城市韧性评估新框架",
         "content": "全球韧性网络发布了首个综合评估城市社会-技术-生态韧性的框架，整合了复杂适应系统理论与城市科学研究。",
         "category": "产业", "source": "GRI Report", "source_url": "https://globalresilience.org",
         "author_name": "GRI", "published_at": base_date - timedelta(days=1)},
        {"title": "Science Advances：复杂网络理论预测金融危机新方法",
         "content": "科学家利用网络传染模型成功预测了多个新兴市场的金融危机信号，准确率较传统方法提升40%。",
         "category": "学术", "source": "Science Advances", "source_url": "https://advances.sciencemag.org",
         "author_name": "研究团队", "published_at": base_date - timedelta(days=1, hours=5)},
        {"title": "中国发布《复杂系统研究重大科技专项》",
         "content": "科技部联合多部门发布专项指南，重点支持复杂系统基础理论、系统建模与仿真、复杂系统在国家重大工程中的应用研究。",
         "category": "政策", "source": "科技部官网", "source_url": "https://most.gov.cn",
         "author_name": "政策解读", "published_at": base_date - timedelta(days=2)},
        {"title": "Nature Human Behaviour：群体智慧的最佳规模是5至12人",
         "content": "大规模数据分析揭示，5至12人的群体在决策质量和效率之间达到最佳平衡，过大的群体反而会因从众效应降低决策质量。",
         "category": "学术", "source": "Nature Human Behaviour", "source_url": "https://nature.com/nathumbehav",
         "author_name": "研究团队", "published_at": base_date - timedelta(days=3)},
        {"title": "复杂适应系统理论在流行病建模中取得突破",
         "content": "基于复杂适应系统的流行病模型成功预测了猴痘的全球传播路径，为公共卫生决策提供了新的理论工具。",
         "category": "技术", "source": "Lancet Digital Health", "source_url": "https://thelancet.com/journals/ldigital",
         "author_name": "研究团队", "published_at": base_date - timedelta(days=4)},
        {"title": "寄思科技与清华大学交叉信息院达成合作",
         "content": "双方将在复杂系统建模、因果推断与AI交叉领域开展联合研究，共同培养复合型研发人才。",
         "category": "产业", "source": "寄思科技", "source_url": "https://jisi.tech",
         "author_name": "研究院", "published_at": base_date - timedelta(days=5)},
    ]

def seed_cases():
    base_date = datetime.utcnow()
    return [
        {
            "title": "城市交通流复杂系统建模与政策评估",
            "slug": "urban-traffic-complexity",
            "summary": "为某超大城市构建交通流复杂系统模型，模拟不同政策情景下的交通演变，辅助制定差异化限行与拥堵收费方案。",
            "content": "## 项目背景\n\n某超大城市面临严峻的交通拥堵问题，传统的交通规划方法难以捕捉系统的复杂性。\n\n## 研究方法\n\n1. 构建多尺度交通网络模型（路网-小区-区域）\n2. 引入 agent-based modeling 模拟出行者行为\n3. 利用真实数据进行模型校准与验证\n\n## 主要发现\n\n- 拥堵收费对不同收入群体的影响呈非线性\n- 公共交通改善可显著降低高峰时段拥堵\n- 工作弹性政策对交通需求有显著调节作用\n\n## 政策建议\n\n基于模型结果，提出分区分时的差异化治堵方案，预计可将平均通勤时间降低15%。",
            "cover_image": "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80",
            "tags": "城市交通,复杂系统,政策评估,agent-based-modeling",
            "published_at": base_date - timedelta(days=10)
        },
        {
            "title": "金融风险传染网络与系统性风险预警",
            "slug": "financial-risk-contagion",
            "summary": "基于复杂网络理论，构建金融机构间的风险传染模型，开发实时预警系统，识别系统性风险的早期信号。",
            "content": "## 项目背景\n\n2008年金融危机揭示了金融机构间关联网络的脆弱性。本项目旨在建立系统性风险预警体系。\n\n## 技术方案\n\n- 构建银行间拆借网络\n- 模拟信用风险与流动性风险的传染路径\n- 开发多层网络耦合模型\n\n## 创新点\n\n1. 引入时间变化的动态网络拓扑\n2. 融合市场情绪指标的尾部风险建模\n3. 基于图神经网络的异常检测\n\n## 应用价值\n\n系统已在3家监管机构试点部署，成功预警2次区域性金融风险事件。",
            "cover_image": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80",
            "tags": "金融风险,复杂网络,系统性风险,预警系统",
            "published_at": base_date - timedelta(days=20)
        },
        {
            "title": "生态系统韧性评估与气候变化适应策略",
            "slug": "ecosystem-resilience-climate",
            "summary": "针对某流域生态系统，构建复杂适应系统模型，评估气候变化情景下的系统韧性边界，制定适应性管理策略。",
            "content": "## 项目背景\n\n某重要水源地面临气候变化带来的生态退化风险，需要科学评估与管理策略。\n\n## 研究框架\n\n采用 Panarchy 框架——理解系统在多尺度上的嵌套结构和适应性循环。\n\n## 模型构建\n\n- 水文-生态耦合模型\n- 物种相互作用网络\n- 人类活动影响模块\n\n## 关键结论\n\n- 系统存在多个潜在临界点\n- 生物多样性是韧性的关键来源\n- 渐进式适应优于突击式干预\n\n## 管理建议\n\n提出韧性友好型管理策略，包括生态廊道建设、多样化水源管理和社区参与机制。",
            "cover_image": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80",
            "tags": "生态系统,韧性,气候变化,适应性管理",
            "published_at": base_date - timedelta(days=30)
        },
    ]

def seed_researchers():
    return [
        {"name": "李明远", "name_en": "Mingyuan Li", "title": "CEO / 首席技术官",
         "bio": "复杂性科学博士，曾任职于Santa Fe Institute和清华大学交叉信息院。研究方向：复杂网络、涌现计算、系统建模。发表SCI论文60余篇，引用超过3000次。",
         "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
         "research_area": "复杂性科学", "email": "li@jisi.tech", "orcid": "0000-0002-1234-5678",
         "twitter": "@mingyuanli", "linkedin": "linkedin.com/in/mingyuanli", "order": 1},
        {"name": "王雨桐", "name_en": "Yutong Wang", "title": "CTO / 技术总监",
         "bio": "系统科学专家，牛津大学博士。研究方向：自组织理论、耗散结构、跨尺度耦合系统。主持国家自然科学基金重点项目3项。",
         "avatar": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80",
         "research_area": "系统科学", "email": "wang@jisi.tech", "orcid": "0000-0003-2345-6789",
         "twitter": "@yutongwang", "linkedin": "linkedin.com/in/yutongwang", "order": 2},
        {"name": "张博涵", "name_en": "Bohan Zhang", "title": "首席工程师",
         "bio": "计算社会科学先驱，MIT媒体实验室博士。研究方向：社会模拟、大数据行为分析、数字孪生城市。",
         "avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80",
         "research_area": "计算社会科学", "email": "zhang@jisi.tech", "orcid": "0000-0001-3456-7890",
         "twitter": "@bohanzhang", "linkedin": "linkedin.com/in/bohanzhang", "order": 3},
        {"name": "陈思远", "name_en": "Siyuan Chen", "title": "高级工程师",
         "bio": "认知科学与决策专家，卡内基梅隆大学博士。研究方向：有限理性、群体决策、行为博弈论。将心理学洞见与计算模型深度融合。",
         "avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80",
         "research_area": "认知与决策", "email": "chen@jisi.tech", "orcid": "0000-0002-4567-8901",
         "twitter": "@siyuanchen", "linkedin": "linkedin.com/in/siyuanchen", "order": 4},
        {"name": "刘子轩", "name_en": "Zixuan Liu", "title": "技术专家",
         "bio": "人工智能与复杂性交叉领域新锐，斯坦福大学博士。研究方向：大模型涌现机制、可解释AI、神经符号系统。",
         "avatar": "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80",
         "research_area": "人工智能与复杂性", "email": "liu@jisi.tech", "orcid": "0000-0003-5678-9012",
         "twitter": "@zixuanliu", "linkedin": "linkedin.com/in/zixuanliu", "order": 5},
        {"name": "赵晓晨", "name_en": "Xiaochen Zhao", "title": "工程师",
         "bio": "生态复杂性与可持续性研究者，普林斯顿大学博士。研究方向：气候系统临界点、生态系统韧性、可持续发展转型。",
         "avatar": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80",
         "research_area": "生态与可持续性", "email": "zhao@jisi.tech", "orcid": "0000-0004-6789-0123",
         "twitter": "@xiaochenzhao", "linkedin": "linkedin.com/in/xiaochenzhao", "order": 6},
    ]
