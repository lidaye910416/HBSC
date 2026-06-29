#!/usr/bin/env python3
"""Cover-image 评估：技术分 + 主题分；达标者通过 admin API 写入。"""
import re, json, requests, sys
from pathlib import Path

API = "http://localhost:8000"
ADMIN_API = f"{API}/api/admin"

CATEGORY_KEYWORDS = {
    "战略与政策": ["政策", "规划", "纲要", "政府", "会议", "报告", "数字经济", "十五五", "五年"],
    "技术与产业": ["ai", "gpt", "llm", "agent", "算法", "模型", "智能", "机器人", "神经网络", "openclaw", "claw"],
    "方案与思考": ["研究", "论文", "实验", "技术", "框架", "学术", "突破", "esb", "架构"],
    "动态与文化": ["企业", "行业", "转型", "案例", "工厂", "供应链", "中小企业", "sme", "国企", "联投"],
    "default": ["湖北", "武汉", "数字", "data"],
}


def extract_images(md):
    if not md:
        return []
    md_imgs = re.findall(r'!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)', md)
    html_imgs = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', md)
    return md_imgs + html_imgs


def tech_score(url):
    try:
        r = requests.head(url, timeout=5, allow_redirects=True)
        if r.status_code != 200:
            return 0, f"HTTP {r.status_code}"
        size = int(r.headers.get("content-length", 0))
        if size < 20 * 1024:
            return 0, f"size {size}B < 20KB"
        # 1=small(20-50KB), 2=medium(50-150KB), 3=large(>=150KB)
        if size >= 150 * 1024:
            score = 3
        elif size >= 50 * 1024:
            score = 2
        else:
            score = 1
        return score, f"{size // 1024}KB"
    except Exception as e:
        return 0, str(e)[:50]


def topic_score(url, category):
    # Topic score: 2 if path contains category keyword, 1 otherwise.
    # Inline images sit under /uploads/source-images/<slug>/... so path keywords
    # rarely match category words. We award 1 by default for any image that
    # passed tech score, and bonus 1 if the article slug hints at the category.
    url_lower = url.lower()
    keywords = CATEGORY_KEYWORDS.get(category, CATEGORY_KEYWORDS["default"])
    bonus = 1 if any(kw.lower() in url_lower for kw in keywords) else 0
    return 1 + bonus


def evaluate(article):
    imgs = extract_images(article.get("content", ""))
    if not imgs:
        return {"id": article["id"], "title": article["title"][:40], "images": 0, "decision": "no-images"}
    cands = []
    for u in imgs:
        if u.startswith("/"):
            u = API + u
        ts, info = tech_score(u)
        tp = topic_score(u, article.get("category", "default"))
        cands.append({"url": u, "tech": ts, "topic": tp, "total": ts + tp, "info": info})
    cands.sort(key=lambda x: x["total"], reverse=True)
    best = cands[0]
    # Threshold: tech >= 1 (i.e. >=20KB) AND total >= 3.
    if best["tech"] >= 1 and best["total"] >= 3:
        return {"id": article["id"], "title": article["title"][:40], "images": len(imgs),
                "candidates": cands, "decision": "write", "chosen": best}
    return {"id": article["id"], "title": article["title"][:40], "images": len(imgs),
            "candidates": cands, "decision": "no-match", "best_score": best["total"]}


def main():
    import os
    USER = os.environ.get("ADMIN_USER", "admin")
    PWD = os.environ.get("ADMIN_PWD", "admin123")
    login = requests.post(f"{API}/api/auth/login", json={"username": USER, "password": PWD})
    if login.status_code != 200:
        print(f"login failed ({login.status_code}): {login.text}", file=sys.stderr)
        sys.exit(1)
    token = login.json().get("access_token") or login.json().get("token")
    headers = {"Authorization": f"Bearer {token}"}

    # Use admin endpoint which returns full content
    r = requests.get(f"{ADMIN_API}/articles?per_page=50", headers=headers)
    articles = r.json()["items"]
    print(f"共 {len(articles)} 篇文章", file=sys.stderr)

    report = []
    written = 0
    for a in articles:
        result = evaluate(a)
        report.append(result)
        if result["decision"] == "write":
            # Store relative path (strip the API base) so the value matches the
            # convention used by seeded articles ("/uploads/..." not full URL).
            chosen_url = result["chosen"]["url"]
            if chosen_url.startswith(API):
                chosen_url = chosen_url[len(API):]
            put = requests.put(f"{ADMIN_API}/articles/{a['id']}", headers=headers,
                              json={"cover_image": chosen_url})
            result["put_status"] = put.status_code
            result["written_url"] = chosen_url
            if put.status_code == 200:
                written += 1

    Path("docs/superpowers/reports").mkdir(parents=True, exist_ok=True)
    with open("docs/superpowers/reports/2026-06-29-cover-image-eval.md", "w", encoding="utf-8") as f:
        f.write("# Cover Image 评估报告\n\n")
        f.write(f"评估时间: 2026-06-29\n\n")
        f.write(f"总文章数: {len(articles)}, 写入封面: {written}\n\n")
        for r in report:
            f.write(f"## {r['title']} (#{r['id']})\n\n")
            f.write(f"- 图片数: {r['images']}, 决策: **{r['decision']}**\n")
            if "chosen" in r:
                c = r["chosen"]
                f.write(f"- 选用: `{c['url']}` (技术 {c['tech']} + 主题 {c['topic']} = {c['total']}, {c['info']})\n")
                f.write(f"- API 写入: {r.get('put_status', '?')}\n")
            elif "best_score" in r:
                f.write(f"- 最高分: {r['best_score']}（未达 6 分阈值）\n")
            f.write("\n")

    print(json.dumps({"written": written, "total": len(articles),
                      "wrote_ids": [r["id"] for r in report if r["decision"] == "write"]},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()