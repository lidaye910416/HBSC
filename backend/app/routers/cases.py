from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.case import Case
from ..schemas.case import CaseSchema, CaseListSchema

router = APIRouter(prefix="/api/cases", tags=["Cases"])

@router.get("", response_model=List[CaseListSchema])
def get_cases(db: Session = Depends(get_db)):
    cases = db.query(Case).order_by(Case.published_at.desc()).all()
    return [CaseListSchema.model_validate(c) for c in cases]

@router.get("/{slug}", response_model=CaseSchema)
def get_case(slug: str, db: Session = Depends(get_db)):
    case = db.query(Case).filter(Case.slug == slug).first()
    if not case:
        raise HTTPException(status_code=404, detail="案例未找到")
    return CaseSchema.model_validate(case)
