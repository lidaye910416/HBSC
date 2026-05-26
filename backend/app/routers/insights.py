from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from ..database import get_db
from ..models.insight import Insight
from ..schemas.insight import InsightSchema

router = APIRouter(prefix="/api/insights", tags=["Insights"])

@router.get("", response_model=dict)
def get_insights(
    category: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    query = db.query(Insight)
    if category:
        query = query.filter(Insight.category == category)
    
    total = query.count()
    insights = query.order_by(Insight.published_at.desc())\
                    .offset((page-1)*per_page).limit(per_page).all()
    
    return {
        "items": [InsightSchema.model_validate(i) for i in insights],
        "total": total,
        "page": page,
        "per_page": per_page
    }

@router.get("/{insight_id}", response_model=InsightSchema)
def get_insight(insight_id: int, db: Session = Depends(get_db)):
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="资讯未找到")
    return InsightSchema.model_validate(insight)
