# 寄思科技 Design System
> 科技简约美学 — 墨色+金色配色体系设计规范

---

## 1. Color System | 色彩系统

### 1.1 主色 (Primary)
```css
--color-primary: #1a1a2e;
```
深邃墨蓝，是品牌的主色调，用于标题、导航栏、重要文字。沉稳内敛，传递专业感与可信度。

### 1.2 强调色 (Accent)
```css
--color-accent: #2563eb;
--color-accent-hover: #1d4ed8;
--color-accent-light: #dbeafe;
```
科技蓝，是交互的主色调，用于链接、按钮、高亮。明亮活泼，传递创新与活力。

### 1.3 背景色 (Background)
```css
--color-bg: #ffffff;
--color-secondary: #f8f9fc;
```
纯净白底，配合微灰二级背景，营造清爽舒适的阅读体验。

### 1.4 文字色 (Text)
```css
--color-text: #1f2937;           /* 正文深色 */
--color-text-secondary: #6b7280;  /* 辅助文字 */
--color-text-muted: #9ca3af;      /* 弱化文字 */
```

### 1.5 边框与表面
```css
--color-border: #e5e7eb;  /* 淡灰边框 */
--color-muted: #f3f4f6;   /* 微弱背景 */
--color-surface: #ffffff;  /* 卡片/输入框背景 */
--color-card: #ffffff;     /* 卡片纯白 */
```

### 1.6 完整色彩令牌

| Token | 色值 | 用途 |
|-------|------|------|
| `--color-primary` | `#1a1a2e` | 主色/标题/导航 |
| `--color-accent` | `#2563eb` | 强调色/按钮/链接 |
| `--color-accent-hover` | `#1d4ed8` | 按钮悬停态 |
| `--color-accent-light` | `#dbeafe` | 浅色背景/标签 |
| `--color-bg` | `#ffffff` | 全局背景 |
| `--color-secondary` | `#f8f9fc` | 二级背景区块 |
| `--color-text` | `#1f2937` | 正文文字 |
| `--color-text-secondary` | `#6b7280` | 辅助文字 |
| `--color-text-muted` | `#9ca3af` | 时间戳/占位符 |
| `--color-border` | `#e5e7eb` | 边框/分隔线 |
| `--color-muted` | `#f3f4f6` | 微弱背景 |
| `--color-surface` | `#ffffff` | 表面/卡片 |
| `--color-card` | `#ffffff` | 卡片背景 |

---

## 2. Typography | 字体系统

### 2.1 字体家族

```css
--font-serif-cn: 'Noto Serif SC', 'Songti SC', serif;   /* 中文标题 */
--font-sans-cn: 'Noto Sans SC', 'PingFang SC', sans-serif;  /* 中文正文 */
--font-sans-en: 'Inter', -apple-system, sans-serif;      /* 英文/UI */
--font-display: 'Inter', sans-serif;                      /* 展示字体 */
```

### 2.2 字号系统

| 元素 | 字号 | 行高 |
|------|------|------|
| H1 | 2.5rem (40px) | 1.2 |
| H2 | 2rem (32px) | 1.2 |
| H3 | 1.5rem (24px) | 1.3 |
| H4 | 1.25rem (20px) | 1.4 |
| Body | 16px | 1.6 |
| Small | 14px | 1.5 |
| Caption | 12px | 1.5 |

### 2.3 字体使用规范

- **中文标题**: `Noto Serif SC`, weight 700
- **中文正文**: `Noto Sans SC`, weight 400/500
- **英文/UI**: `Inter`, weight 400/500/600
- **Section Label**: `Inter`, 12px, uppercase, letter-spacing: 0.1em

---

## 3. Spacing | 间距系统

### 3.1 基础单位
```css
--space-1: 8px;
--space-2: 16px;
--space-3: 24px;
--space-4: 32px;
--space-5: 40px;
--space-6: 48px;
--space-8: 64px;
--space-10: 80px;
--space-15: 120px;
```

### 3.2 布局间距

| 场景 | 间距 |
|------|------|
| 卡片内边距 | 32px |
| 网格间距 | 24px |
| Section 上下内边距 (Desktop) | 120px |
| Section 上下内边距 (Mobile) | 64px |
| 最大内容宽度 | 1200px |
| 阅读栏最大宽度 | 720px |

---

## 4. Components | 组件样式

### 4.1 按钮 (Button)

```css
/* Primary Button */
.btn-primary {
  background: var(--color-accent);
  color: #ffffff;
}
.btn-primary:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: var(--color-primary);
  color: #ffffff;
}
.btn-secondary:hover {
  background: #2d2d4a;
}

/* Outline Button */
.btn-outline {
  background: transparent;
  color: var(--color-primary);
  border: 1.5px solid var(--color-border);
}
.btn-outline:hover {
  background: var(--color-primary);
  color: #ffffff;
}

/* Ghost Button */
.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}
.btn-ghost:hover {
  color: var(--color-primary);
  background: var(--color-muted);
}
```

**按钮通用属性:**
```css
.btn {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  transition: all var(--transition-fast);
  white-space: nowrap;
}
```

### 4.2 输入框 (Input)

```css
.input {
  padding: 12px 16px;
  font-size: 15px;
  border: 1.5px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: all var(--transition-fast);
}
.input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(99,102,241,.1);
}
```

### 4.3 标签 (Tag)

```css
/* Default Tag */
.tag {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 9999px;
  background: #f3f4f6;
  color: #374151;
  border: 1px solid #e5e7eb;
}

/* Dark Tag */
.tag-dark {
  background: var(--color-accent-light);
  color: var(--color-accent);
  border-color: var(--color-accent-light);
}
```

### 4.4 分隔线 (Divider)

```css
.divider {
  width: 40px;
  height: 3px;
  background: var(--color-accent);
  margin: 24px 0;
}
.divider--center {
  margin-left: auto;
  margin-right: auto;
}
```

---

## 5. Layout | 布局规范

### 5.1 响应式断点

| 设备 | 断点 | 描述 |
|------|------|------|
| Mobile | < 768px | 手机 |
| Tablet | 768px - 1023px | 平板 |
| Desktop | >= 1024px | 桌面 |
| Wide | >= 1280px | 宽屏 |

### 5.2 容器宽度

```css
/* Default */
.container { padding: 0 24px; }

/* Tablet */
@media (min-width: 640px) { .container { padding: 0 32px; } }

/* Desktop */
@media (min-width: 1024px) { .container { padding: 0 32px; } }

/* Wide */
@media (min-width: 1280px) {
  .container { max-width: 1200px; padding: 0 40px; }
}
```

### 5.3 网格系统

```css
.grid { display: grid; gap: 24px; }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }

@media (max-width: 1024px) {
  .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}
```

---

## 6. Motion | 动效规范

### 6.1 过渡时长

```css
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
```

### 6.2 动画效果

```css
/* 淡入上浮动画 */
.animate-fade-up {
  animation: fadeInUp 0.6s ease-out both;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 6.3 交互状态

| 交互 | 效果 | 时长 |
|------|------|------|
| 按钮悬停 | `translateY(-1px)` + 颜色加深 | 150ms |
| 卡片悬停 | `translateY(-4px)` + 阴影增强 | 200ms |
| 页面切换 | 淡入淡出 | 300ms |

---

## 7. Scrollbar | 滚动条样式

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: var(--color-muted); }
::-webkit-scrollbar-thumb {
  background: var(--color-accent);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover { background: var(--color-accent-hover); }
```

---

## 8. CSS Variables | 完整变量列表

```css
:root {
  /* Colors */
  --color-primary: #1a1a2e;
  --color-accent: #2563eb;
  --color-accent-hover: #1d4ed8;
  --color-accent-light: #dbeafe;
  --color-bg: #ffffff;
  --color-secondary: #f8f9fc;
  --color-text: #1f2937;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border: #e5e7eb;
  --color-muted: #f3f4f6;
  --color-surface: #ffffff;
  --color-card: #ffffff;

  /* Spacing */
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 40px;
  --space-6: 48px;
  --space-8: 64px;
  --space-10: 80px;
  --space-15: 120px;

  /* Layout */
  --nav-height: 64px;

  /* Typography */
  --font-serif-cn: 'Noto Serif SC', 'Songti SC', serif;
  --font-sans-cn: 'Noto Sans SC', 'PingFang SC', sans-serif;
  --font-sans-en: 'Inter', -apple-system, sans-serif;
  --font-display: 'Inter', sans-serif;

  /* Motion */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
}
```

---

## 9. Usage Examples | 使用示例

### 9.1 创建卡片

```html
<div class="card">
  <h3>卡片标题</h3>
  <p>卡片内容...</p>
  <button class="btn btn-primary">了解更多</button>
</div>
```

### 9.2 创建表单

```html
<input type="email" class="input" placeholder="输入邮箱" />
<button class="btn btn-primary">提交</button>
```

### 9.3 创建标签

```html
<span class="tag">技术</span>
<span class="tag tag-dark">深度</span>
```

---

## 10. Design Principles | 设计原则

1. **清晰优先** — 所有文字保证清晰可读，对比度充足
2. **克制用色** — 强调色控制在小面积使用，避免视觉疲劳
3. **留白呼吸** — 大量留白营造专业感与呼吸感
4. **一致性** — 所有组件遵循统一的间距、圆角、阴影规范
5. **响应式** — 移动优先，确保各端体验一致

---

*Generated: 2024-05-24*
