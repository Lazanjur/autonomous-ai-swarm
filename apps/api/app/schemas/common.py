from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class HealthRead(BaseModel):
    status: str
    app: str
    models_configured: bool
    timestamp: datetime


class ReadinessRead(BaseModel):
    status: str
    app: str
    database: str
    models_configured: bool
    timestamp: datetime


class IdEnvelope(BaseModel):
    id: UUID
