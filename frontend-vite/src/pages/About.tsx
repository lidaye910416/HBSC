import { useQuery } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { api } from '../services/api'
import './About.css'

const timeline = [
  { year: '2024', event: '湖北数创创刊，聚焦湖北数字产业创新研究' },
  { year: '2025', event: '发布首期《湖北数字产业创新研究》期刊' },
  { year: '2026', event: '第二期期刊发布，拓展四大内容板块' },
]

const partners = [
  { name: '湖北省经济和信息化厅', logo: 'HBEI' },
  { name: '武汉东湖新技术开发区', logo: 'WHDL' },
  { name: '华中科技大学', logo: 'HUST' },
  { name: '武汉大学', logo: 'WHU' },
  { name: '中国信通院', logo: 'CAICT' },
  { name: '湖北省软件行业协会', logo: 'HBSIA' },
]

export function About() {
  const { data: team } = useQuery({ queryKey: ['team'], queryFn: api.team })

  return (
    <main className="about-page">
      {/* Hero */}
      <div className="about-hero">
        <div className="about-hero__bg" />
        <div className="about-hero__content">
          <p className="section-label">ABOUT US</p>
          <h1>关于湖北数创</h1>
          <p className="about-hero__lead">
            在数字经济时代，我们致力于研究湖北数字产业发展趋势——<br />
            用专业的视角解读政策、推动创新、服务产业。
          </p>
        </div>
      </div>

      {/* Mission */}
      <section className="section">
        <div className="container about-mission">
          <div className="about-mission__text">
            <p className="section-label">使命与愿景</p>
            <h2>记录数字变革<br /><span className="text-accent">赋能产业升级</span></h2>
            <div className="divider" />
            <p>湖北数创创立于2024年，是湖北数字产业创新研究的内部期刊。我们的核心使命是：记录湖北数字产业发展变革、传播前沿理念、推动产业升级。</p>
            <p>我们关注数字经济政策解读、技术创新趋势、数字化转型案例等内容，旨在用专业的视角和严谨的方法，为湖北产业数字化转型提供有价值的参考。</p>
            <p>我们相信，数字经济是推动湖北高质量发展的重要引擎。通过这本期刊，我们希望汇聚各方力量，共同推动湖北数字产业的繁荣发展。</p>
          </div>
          <div className="about-mission__principles">
            {[
              { title: '专业严谨', desc: '每一个分析都基于充分的调研与审慎的论证' },
              { title: '服务产业', desc: '以服务湖北产业数字化转型为核心目标' },
              { title: '开放共享', desc: '研究内容公开分享，促进知识的广泛传播' },
              { title: '创新驱动', desc: '关注技术创新与模式创新，推动产业升级' },
            ].map((p, i) => (
              <div key={i} className="principle-item">
                <div className="principle-item__num">{String(i+1).padStart(2, '0')}</div>
                <div>
                  <h4>{p.title}</h4>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="section section--secondary">
        <div className="container">
          <div className="text-center" style={{marginBottom:'48px'}}>
            <p className="section-label">发展历程</p>
            <h2>我们的足迹</h2>
            <div className="divider divider--center" />
          </div>
          <div className="about-timeline">
            {timeline.map((item, i) => (
              <div key={i} className="about-timeline__item">
                <div className="about-timeline__year">{item.year}</div>
                <div className="about-timeline__dot" />
                <div className="about-timeline__event">{item.event}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      {team && team.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="text-center" style={{marginBottom:'48px'}}>
              <p className="section-label">研究团队</p>
              <h2>核心研究者</h2>
              <div className="divider divider--center" />
            </div>
            <div className="grid grid-3">
              {team.map(member => (
                <div key={member.id} className="about-member-card">
                  <div className="about-member-card__avatar-wrap">
                    <img
                      src={member.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${member.name}`}
                      alt={member.name}
                      className="about-member-card__avatar"
                    />
                  </div>
                  <div className="about-member-card__body">
                    <h4>{member.name}</h4>
                    {member.name_en && <p className="about-member-card__en text-en">{member.name_en}</p>}
                    <p className="about-member-card__title">{member.title}</p>
                    <p className="about-member-card__bio">{member.bio}</p>
                    <div className="about-member-card__contact">
                      {member.email && (
                        <a href={`mailto:${member.email}`} aria-label="邮箱">
                          <Mail size={14} strokeWidth={1.5}/>
                        </a>
                      )}
                      {member.twitter && (
                        <a href={`https://twitter.com/${member.twitter.replace('@','')}`} target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Partners */}
      <section className="section section--secondary">
        <div className="container">
          <div className="text-center" style={{marginBottom:'48px'}}>
            <p className="section-label">合作机构</p>
            <h2>研究伙伴</h2>
            <div className="divider divider--center" />
          </div>
          <div className="partners-grid">
            {partners.map((p, i) => (
              <div key={i} className="partner-card">
                <div className="partner-card__logo">{p.logo}</div>
                <p className="partner-card__name">{p.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
