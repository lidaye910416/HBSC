import { useState } from 'react'
import './EditorialCommittee.css'

interface CommitteeRow {
  /** 职位名称 */
  role: string
  /** 成员名单 */
  members: string[]
  /** 排序说明 */
  note?: string
}

/**
 * 湖北数创 · 2026 年第 1 期 编委会
 * 数据来源：期刊内页编委名单（2026-Q1 印刷版）
 */
const COMMITTEE: CommitteeRow[] = [
  { role: '主　　任', members: ['李晓宇'] },
  { role: '主　　编', members: ['陈顺安'] },
  { role: '副 主 编', members: ['范崇来', '干志文', '熊运伟', '缪　锴'] },
  {
    role: '编　　委',
    members: [
      '谭丽娟', '曾　勇', '彭　杉', '黄　玮',
      '袁　勇', '钟奇思', '赵邦强', '陈　涵',
      '闫培培', '李　瑞', '王　鹏', '王正臣',
    ],
    note: '（按姓氏笔画排序）',
  },
  {
    role: '执行编委',
    members: [
      '黄振宇', '黄　为', '涂　瑶', '赵　越',
      '胡社平', '张玉敏', '李玉琳', '李云飞',
      '朱永强', '刘亚奇', '匡　俊', '卢越曦',
      '付　裕', '王　磊', '王　维', '尤振胜',
    ],
    note: '（按姓氏笔画排序）',
  },
  { role: '责任编辑', members: ['李博闻', '孙文生'] },
  { role: '版面设计', members: ['程小娇'] },
]

const TOTAL = COMMITTEE.reduce((n, r) => n + r.members.length, 0)

type Filter = 'all' | string

export function EditorialCommittee() {
  // null = 默认折叠，不显示 card
  const [filter, setFilter] = useState<Filter | null>(null)

  const handlePill = (next: Filter) => {
    // 同一 pill 再次点击 → 收起
    setFilter(prev => (prev === next ? null : next))
  }

  const activeRow =
    filter && filter !== 'all' ? COMMITTEE.find(r => r.role === filter) ?? null : null
  const isOpen = filter !== null

  return (
    <section className="ecb-section">
      <div className="container">
        {/* 章节标题 */}
        <div className="ecb-heading-wrap observe">
          <h3 className="ecb-heading">编　委　会</h3>
          <span className="ecb-heading__en">Editorial Committee</span>
        </div>

        {/* 药丸过滤器（始终可见，作为导航） */}
        <div className="ecb-pills observe" role="tablist" aria-label="编委角色筛选">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`ecb-pill ${filter === 'all' ? 'ecb-pill--active' : ''}`}
            onClick={() => handlePill('all')}
          >
            全部
            <span className="ecb-pill__count">{TOTAL}</span>
          </button>
          {COMMITTEE.map(row => (
            <button
              key={row.role}
              type="button"
              role="tab"
              aria-selected={filter === row.role}
              className={`ecb-pill ${filter === row.role ? 'ecb-pill--active' : ''}`}
              onClick={() => handlePill(row.role)}
            >
              {row.role}
              <span className="ecb-pill__count">{row.members.length}</span>
            </button>
          ))}
        </div>

        {/* Card 容器：用 grid-template-rows 0fr → 1fr 实现开/合高度过渡 */}
        <div className={`ecb-card-wrap ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
          <div className="ecb-card" role="region" aria-label="编委成员">
            <div className="ecb-card__body">
              {filter === 'all' && <AllView />}
              {activeRow && <SingleView row={activeRow} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- 全部视图 ---------- */
function AllView() {
  return (
    <div className="ecb-all">
      <div className="ecb-all__head">
        <span className="ecb-all__total">共 {TOTAL} 位 · {COMMITTEE.length} 个角色</span>
      </div>
      <div className="ecb-all__grid">
        {COMMITTEE.map((row, i) => (
          <div
            key={row.role}
            className={`ecb-all__row ${i < 3 ? 'ecb-all__row--lead' : ''}`}
            style={{ '--ecb-i': i } as React.CSSProperties}
          >
            <div className="ecb-all__role">{row.role}</div>
            <div className="ecb-all__members">
              {row.members.map((name, idx) => (
                <span
                  key={`${row.role}-${idx}`}
                  className="ecb-all__name"
                  style={{ '--ecb-j': idx } as React.CSSProperties}
                >
                  {name}
                </span>
              ))}
              {row.note && <span className="ecb-all__note">{row.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 单角色视图 ---------- */
function SingleView({ row }: { row: { role: string; members: string[]; note?: string } }) {
  return (
    <div className="ecb-single">
      <div className="ecb-single__head">
        <span className="ecb-single__role">{row.role}</span>
        <span className="ecb-single__count">{row.members.length} 位成员</span>
      </div>
      <div className="ecb-single__members">
        {row.members.map((name, idx) => (
          <span
            key={idx}
            className="ecb-single__name"
            style={{ '--ecb-j': idx } as React.CSSProperties}
          >
            {name}
          </span>
        ))}
        {row.note && <span className="ecb-single__note">{row.note}</span>}
      </div>
    </div>
  )
}